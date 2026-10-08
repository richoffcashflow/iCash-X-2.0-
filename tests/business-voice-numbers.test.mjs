import assert from 'node:assert/strict';
import {businessVoiceProviders,inspectBusinessPhone,connectBusinessPhone,selectBusinessCaller,secondaryCallingReady,primaryBusinessPhone as first,secondaryBusinessPhone as second,businessVoiceIngress as ingress} from '../lib/business-voice-numbers.ts';
const ac='AC'+'a'.repeat(32),pn='PN'+'b'.repeat(32);
const env={CONTIGUITY_API_KEY:'test-only-contiguity',TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'test-only-carrier-token',VERCEL_ENV:'production'};
let f,verified,lease,route,requests,writes;
function reset(){f={enabled:false,to:null,status:'active',estimated_completion:null};verified=false;lease=true;route=true;requests=[];writes=[];}
const fetcher=async(url,init)=>{
 requests.push({url,method:init.method,body:init.body});assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
 if(url.endsWith('/numbers/leased'))return Response.json({data:{numbers:[{number:{e164:second},lease_status:lease?'active':'expired',capabilities:{channels:['sms']}}]}});
 if(url.includes('OutgoingCallerIds.json'))return Response.json({outgoing_caller_ids:verified?[{sid:pn,account_sid:ac,phone_number:second}]:[],next_page_uri:null});
 if(url.includes('IncomingPhoneNumbers.json'))return Response.json({incoming_phone_numbers:[{sid:pn,account_sid:ac,phone_number:ingress,capabilities:{voice:true},voice_url:route?'https://www.geticashx.com/api/reception/inbound':'https://example.com/wrong',voice_method:'POST'}],next_page_uri:null});
 assert(url.includes(encodeURIComponent(second)));assert(!url.includes(encodeURIComponent(first)));
 if(url.endsWith('/enable')){assert.equal(init.method,'POST');assert.deepEqual(JSON.parse(init.body),{to:ingress});f={enabled:true,to:ingress,status:'active',estimated_completion:null};}
 else assert.equal(init.method,'GET');
 return Response.json({object:'response',data:{number:second,call_forwarding:f}});
};
const db=async(path,method,body)=>{writes.push({path,method,body});return null;};
reset();const before=await inspectBusinessPhone(env,fetcher);assert.equal(before.incoming,false);assert.equal(before.callerIdVerified,false);assert(requests.every(r=>r.method==='GET'));
const incoming=await connectBusinessPhone(db,env,fetcher);assert.equal(incoming.incoming,true);assert.equal(incoming.callerIdVerified,false);assert.equal(writes.at(-1).body.p_enabled,false);assert.equal(requests.filter(r=>r.method==='POST').length,1);
verified=true;await connectBusinessPhone(db,env,fetcher);assert.equal(writes.at(-1).body.p_enabled,true);assert.equal(writes.at(-1).body.p_caller_id_sid,pn);assert.equal(requests.filter(r=>r.method==='POST').length,1,'Already forwarded numbers are not rewritten');
for(const mutate of [()=>lease=false,()=>route=false,()=>f={enabled:true,to:first,status:'active',estimated_completion:null}]){reset();mutate();await assert.rejects(connectBusinessPhone(db,env,fetcher));assert.equal(requests.filter(r=>r.method==='POST').length,0);assert.equal(writes.length,0);}
reset();await assert.rejects(connectBusinessPhone(db,{...env,VERCEL_ENV:'preview'},fetcher));assert.equal(requests.length,0);
reset();verified=true;const readyDb=async()=>[{provider_account_sid:ac,caller_id_sid:pn,forwarding_ready:true,outbound_enabled:true}];assert.equal(await secondaryCallingReady(readyDb,env,fetcher),true);verified=false;assert.equal(await secondaryCallingReady(readyDb,env,fetcher),false);verified=true;lease=false;assert.equal(await secondaryCallingReady(readyDb,env,fetcher),false);
assert.equal(selectBusinessCaller(first,[]),first);assert.equal(selectBusinessCaller(first,[{sender:first}]),first);assert.equal(selectBusinessCaller(first,[{sender:second,sender_pool_assigned:true}]),second);
for(const threads of [[{sender:second}],[{sender:first},{sender:second,sender_pool_assigned:true}],[{sender:'+12125550101',sender_pool_assigned:true}]])assert.throws(()=>selectBusinessCaller(first,threads));
reset();await assert.rejects(businessVoiceProviders(env,async()=>Response.json({outgoing_caller_ids:[{account_sid:ac,phone_number:second,sid:pn}],next_page_uri:'/next'})).callerId());
console.log('PASS business voice: exact lease/account/caller ID, idempotent forwarding, preview isolation, conversation continuity, provider revocation, and no calls or messages sent');
