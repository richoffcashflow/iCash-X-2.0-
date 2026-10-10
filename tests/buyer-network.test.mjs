import assert from 'node:assert/strict';
import {z} from 'zod';
import * as policy from '../lib/buyer-network.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No provider calls in buyer network tests');};
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let user={id:id(1),email:'fixture@example.invalid',email_confirmed_at:new Date().toISOString()},vip=true,calls=[],sent=[],targets=Array.from({length:5},(_,n)=>({id:id(10+n)})),configured=true;
const profile={name:'Fixture Buyer',zips:['75201','75201'],propertyTypes:['house'],maxPriceCents:10000000,maxRepairsCents:1000000,dailyEmails:3,accepted:true,consentVersion:policy.networkConsentVersion};
assert.deepEqual(policy.networkProfileSchema.parse(profile).zips,['75201']);
for(const patch of [{accepted:false},{consentVersion:'old'},{zips:['7520']},{maxPriceCents:-1},{maxRepairsCents:1.5},{dailyEmails:4},{propertyTypes:[]},{accountId:id(2)}])assert.equal(policy.networkProfileSchema.safeParse({...profile,...patch}).success,false);
const mocks={...policy,z,NextResponse:{json:(body,options={})=>({body,status:options.status??200})},currentUser:async()=>user,workAccount:async()=>{if(!user)throw Error('SIGN_IN_REQUIRED');return {userId:user.id,accountId:id(2)};},limitRequest:async()=>{},db:async(path,method,body)=>{
 calls.push({path,method,body});
 if(path==='rpc/icash_vip_active')return vip;
 if(path==='rpc/icash_network_workspace')return {vip:true,matches:0};
 if(path==='rpc/icash_network_profile')return null;
 if(path==='rpc/icash_network_inbox')return [];
 if(path==='rpc/icash_network_save_buyer'||path==='rpc/icash_network_save_settings'||path==='rpc/icash_network_respond'||path==='rpc/icash_network_pause')return null;
 if(path==='rpc/icash_network_match_deal')return 5;
 if(path==='rpc/icash_network_email_targets')return targets;
 if(path==='rpc/icash_network_queue_email')return body.p_match;
 if(path.startsWith('icash_deal_files?'))return [];
 throw Error('Unexpected DB '+path);
},dealEmailConfigured:()=>configured,dispatchDealEmail:async(account,match)=>{sent.push({account,match});return {status:'email_accepted'};}};
const req=(path,body,method='POST',origin='https://fixture.invalid')=>new Request('https://fixture.invalid'+path,{method,headers:{origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
try{
 const buyer=await loadService('app/api/buyer-network/route.ts',mocks),workspace=await loadService('app/api/work/buyer-network/route.ts',mocks),service=await loadService('lib/buyer-network-service.ts',mocks);
 let r=await buyer.POST(req('/api/buyer-network',profile));assert.equal(r.status,200);assert.equal(calls.at(-1).body.p_user,id(1));
 calls=[];r=await buyer.POST(req('/api/buyer-network',{...profile,userId:id(99)}));assert.equal(r.status,400);assert.equal(calls.length,0);
 r=await buyer.POST(req('/api/buyer-network',profile,'POST','https://other.invalid'));assert.equal(r.status,403);assert.equal(calls.length,0);
 user=null;r=await buyer.GET();assert.deepEqual(r.body,{signedIn:false});r=await buyer.POST(req('/api/buyer-network',profile));assert.equal(r.status,401);
 user={id:id(1),email:'fixture@example.invalid'};vip=false;calls=[];r=await workspace.GET(req('/api/work/buyer-network',undefined,'GET'));assert.equal(r.status,403);assert.equal(calls.length,1);
 vip=true;calls=[];r=await workspace.GET(req('/api/work/buyer-network?dealId='+id(99),undefined,'GET'));assert.equal(r.status,404);assert(!calls.some(c=>c.path==='rpc/icash_network_workspace'));
 calls=[];r=await workspace.POST(req('/api/work/buyer-network',{enabled:true,mailingAddress:'123 Fixture St, Dallas TX 75201',accountId:id(99)}));assert.equal(r.status,400);assert.equal(calls.length,0);
 r=await buyer.PATCH(req('/api/buyer-network',{matchId:id(10),state:'interested'},'PATCH'));assert.equal(r.status,200);assert.equal(calls.at(-1).body.p_user,id(1));
 process.env.ICASH_LIVE_WORK_READY='false';calls=[];await service.processBuyerNetwork(id(2),id(3));assert.equal(calls.length,0);assert.equal(sent.length,0);
 process.env.ICASH_LIVE_WORK_READY='true';vip=false;await service.processBuyerNetwork(id(2),id(3));assert.equal(sent.length,0);assert.equal(calls.length,1);
 vip=true;calls=[];let result=await service.processBuyerNetwork(id(2),id(3));assert.equal(sent.length,3,'Bounded even if a faulty RPC returns extra rows');assert.equal(result.canContinue,true);assert(calls.every(c=>!c.path.includes('voice')&&!c.path.includes('text')));
 sent=[];targets=[];result=await service.processBuyerNetwork(id(2),id(3));assert.equal(result.canContinue,false);assert.equal(sent.length,0);
 configured=false;await service.processBuyerNetwork(id(2),id(3));assert.equal(sent.length,0);
 // Free buyer verification has no funding or membership side effects and uses bounded OTP requests.
 const authCalls=[],sessions=[];process.env.ICASH_AUTH_EMAIL_READY='true';
 const auth=await loadService('app/api/buyer-network/auth/route.ts',{...mocks,authRequest:async(path,body)=>{authCalls.push({path,body});return {user:{id:id(1),email_confirmed_at:new Date().toISOString()},access_token:'fixture',refresh_token:'fixture',expires_in:3600};},saveSession:async(s)=>sessions.push(s),limitRequest:async(_req,scope,_email,limit,seconds)=>{assert.match(scope,/^network-/);assert(limit<=8);assert(seconds>=600);}});
 r=await auth.POST(req('/api/buyer-network/auth',{action:'send',email:'buyer@example.invalid'}));assert.equal(r.status,200);assert.deepEqual(authCalls[0],{path:'otp',body:{email:'buyer@example.invalid',create_user:true}});
 r=await auth.POST(req('/api/buyer-network/auth',{action:'verify',email:'buyer@example.invalid',code:'123456'}));assert.equal(r.status,200);assert.equal(sessions.length,1);
 const unsubscribe=await loadService('app/buyers/unsubscribe/[token]/route.ts',mocks),params={params:Promise.resolve({token:'a'.repeat(32)})};
 calls=[];await unsubscribe.GET(req('/buyers/unsubscribe/'+ 'a'.repeat(32),undefined,'GET'),params);assert.equal(calls.length,0,'Email link scanners cannot unsubscribe buyers');
 await unsubscribe.POST(req('/buyers/unsubscribe/'+ 'a'.repeat(32),{}),params);assert.deepEqual(calls.at(-1).body,{p_user:null,p_token:'a'.repeat(32)});
 // The real dispatcher carries one-click headers only for a trusted network URL.
 process.env.RESEND_API_KEY='fixture-not-a-key';process.env.RESEND_RECEIVING_WEBHOOK_SECRET='fixture';process.env.ICASH_TITLE_REPLY_EMAIL='reply@example.invalid';
 const payloads=[];globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');payloads.push(JSON.parse(options.body));return new Response(JSON.stringify({id:id(30)}),{status:200});};
 const delivery=await loadService('lib/deal-email-service.ts',{customerEmailDomains:()=>true,customerEmailIdentity:()=>({from:'Fixture <send@example.invalid>',replyTo:'reply@example.invalid'}),titleEmailAddress:v=>v??'send@example.invalid',emailFromName:v=>v,db:async(path,method)=>path==='rpc/icash_claim_deal_email'?{id:id(30),to:'buyer@example.invalid',subject:'Fixture package',text:'Requested fixture package',principal:'Fixture',unsubscribeUrl:'https://homeoffernetwork.com/buyers/unsubscribe/'+'a'.repeat(32)}:method==='PATCH'?null:[{state:'ready'}]});
 assert.equal((await delivery.dispatchDealEmail(id(2),id(30))).status,'email_accepted');assert.equal(payloads[0].headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');assert.equal(payloads[0].headers['List-Unsubscribe'],'<https://homeoffernetwork.com/buyers/unsubscribe/'+'a'.repeat(32)+'>');
 console.log('PASS buyer-network routes and service: verified identity, strict inputs, no tenant injection, VIP gate, private deal check, no paid tests, bounded email-only dispatch and free enrollment.');
}finally{globalThis.fetch=originalFetch;}
