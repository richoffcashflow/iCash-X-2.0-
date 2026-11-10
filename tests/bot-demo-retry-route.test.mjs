// Real HTTP handlers, validators and atomic SQL, with no provider/network work.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
import {botDemoSubmission,botDemoConsentVersion} from '../lib/bot-demo.ts';
import {sellerDuplicateKeyInput} from '../lib/seller-leads.ts';
import {sellerSubmissionStatus} from '../lib/seller-submission-status.ts';
import {optinCallNowVersion} from '../lib/optin-call-now.ts';
import {BotDemoRateLimitError} from '../lib/bot-demo-rate-limit.ts';
import {voiceReservationFailure} from '../lib/voice-budget-failure.ts';
import {account,owner,botDemoRetryFixture} from './helpers/bot-demo-retry-fixture.mjs';
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a);
const guestHash=value=>createHash('sha256').update(value).digest('hex');
let cookie,pendingCookie,authorized=true,originAllowed=true,lostResponse=false,unknownFailure=false,dbCalls=[],attemptCalls=[],callbacks=[],grants=[];
const dependencies={
 createHash,randomBytes,guestHash,botDemoSubmission,sellerDuplicateKeyInput,sellerSubmissionStatus,
 ownerInboundTarget:{ownerUserId:owner,accountId:account,ownerPhone:'+12142185280'},
 currentUser:async()=>authorized?{id:owner}:null,allowedOrigin:()=>originAllowed,
 cookies:async()=>({get:()=>cookie?{value:cookie}:undefined,set:(name,value,options)=>{assert.equal(name,'keypath_seller');assert.deepEqual(options,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:86400*30});pendingCookie=value;}}),
 validGuest:value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),
 limitRequest:async(req,scope,identifier,limit,seconds)=>{
  attemptCalls.push({scope,identifier,limit,seconds});
  const ip=req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()||'unknown';
  for(const key of [`${scope}:ip:${guestHash(ip)}`,`${scope}:id:${guestHash(identifier)}`]){
   if(!(await q('select icash_take_request($1,$2,$3) ok',[key,limit,seconds])).rows[0].ok)
    throw Object.assign(new Error('Too many attempts. Please wait and try again.'),{status:429,retryAfter:seconds});
  }
 },
 db:async(path,method,body)=>{
  dbCalls.push({path,body});
  if(path==='rpc/icash_submit_limited_bot_demo_intake'){
   if(unknownFailure==='untrusted429')throw Object.assign(new Error('PRIVATE DATABASE DIAGNOSTIC'),{status:429});
   if(unknownFailure)throw Error('Unknown database transport outcome');
   const values=Object.values(body),keys=Object.keys(body);
   let id;
   try{id=(await q('select icash_submit_limited_bot_demo_intake('+keys.map((name,i)=>name+'=> $'+(i+1)).join(',')+') id',values)).rows[0].id;}
   catch(error){throw await voiceReservationFailure(path,error.code==='PT429'?429:400,Response.json({code:error.code,message:error.message}));}
   if(lostResponse){lostResponse=false;throw Error('Lost committed response');}
   return id;
  }
  if(path.startsWith('icash_seller_intakes?id=eq.'))return (await q('select state from icash_seller_intakes where id=$1',[path.split('eq.')[1].split('&')[0]])).rows;
  if(path==='rpc/icash_request_optin_call_now'){grants.push(body);return true;}
  throw Error('Unexpected database operation: '+path);
 },
 after:callback=>callbacks.push(callback),
 processSellerIntake:()=>{throw Error('No provider work permitted');},processSellerResponses:()=>{throw Error('No provider work permitted');},
 dispatchTextMessage:()=>{throw Error('No sends permitted');},dispatchLiveVoice:()=>{throw Error('No calls permitted');},
};
globalThis.__demoRetryRoute=dependencies;
const source=ts.transpileModule(readFileSync(new URL('../app/api/demo/intake/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const route=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(dependencies).join(',')+'}=globalThis.__demoRetryRoute;\n'+source).toString('base64'));
delete globalThis.__demoRetryRoute;
const body={requestId:randomUUID(),name:'Demo Seller',address:'45 Fixture Lane, Dallas, TX 75201',phone:'+12145550123',consented:true,consentVersion:botDemoConsentVersion,contactTimezone:'America/Chicago',callNowVersion:optinCallNowVersion};
const request=(value=body,headers={})=>new Request('https://fixture.example/api/demo/intake',{method:'POST',headers:{'Content-Type':'application/json','x-vercel-forwarded-for':'203.0.113.7, 192.0.2.1',...headers},body:JSON.stringify(value)});
const snapshot=async()=>({leads:(await q('select * from icash_seller_intakes order by id')).rows,limits:(await q('select * from icash_request_limits order by bucket')).rows});
try{
 await pg.exec(botDemoRetryFixture());
 authorized=false;assert.equal((await route.GET()).status,200);assert.equal(pendingCookie,undefined);assert.equal((await route.POST(request())).status,403);authorized=true;
 assert.equal((await route.POST(request())).status,409);assert.equal(dbCalls.length,0);assert.equal(attemptCalls.length,0);assert.equal(pendingCookie,undefined,'POST never creates a replacement guest');
 assert.equal((await route.GET()).status,200);assert.match(pendingCookie,/^[a-f0-9]{64}$/);assert.equal(dbCalls.length,0,'readiness cannot create an intake');
 // Dropping the readiness response cannot permit a POST with unknown binding.
 pendingCookie=undefined;assert.equal((await route.POST(request())).status,409);assert.deepEqual(await snapshot(),{leads:[],limits:[]});
 await route.GET();cookie=pendingCookie;pendingCookie=undefined;
 await route.GET();assert.equal(pendingCookie,undefined,'existing guest identity survives refresh');
 originAllowed=false;assert.equal((await route.POST(request())).status,403);assert.equal(attemptCalls.length,0);originAllowed=true;
 assert.equal((await route.POST(request({...body,consented:false}))).status,400);assert.equal(attemptCalls.length,0);
 lostResponse=true;assert.equal((await route.POST(request())).status,503);assert.equal(callbacks.length,0);assert.equal(grants.length,0);
 const committed=(await snapshot()).leads[0];assert.equal(committed.guest_hash,guestHash(cookie));assert.equal(pendingCookie,undefined,'uncertain first POST does not own a Set-Cookie');
 for(let n=0;n<6;n++)assert.equal((await route.POST(request())).status,200);
 assert.equal((await snapshot()).leads.length,1);assert.equal((await q("select attempts from icash_request_limits where bucket like 'bot-demo:%' order by bucket")).rows.every(row=>row.attempts===1),true);
 assert(attemptCalls.every(row=>row.scope==='bot-demo-attempt'&&row.identifier===owner&&row.limit===60&&row.seconds===3600));
 assert(dbCalls.filter(row=>row.path==='rpc/icash_submit_limited_bot_demo_intake').every(row=>row.body.p_ip_hash===guestHash('203.0.113.7')),'only trusted Vercel proxy IP enters new-intent budget');
 assert.equal((await route.POST(request({...body,name:'Different Seller'}))).status,503,'changed same-key payload does not masquerade as accepted');
 for(let n=0;n<4;n++)assert.equal((await route.POST(request({...body,requestId:randomUUID()}))).status,200);
 const saved=await snapshot(),beforeCallbacks=callbacks.length,beforeGrants=grants.length;
 const denied=await route.POST(request({...body,requestId:randomUUID()}));assert.equal(denied.status,429);assert.equal(denied.headers.get('retry-after'),'3600');assert.equal((await denied.json()).error,'Too many demo attempts. Please wait before trying again.');
 assert.equal(callbacks.length,beforeCallbacks);assert.equal(grants.length,beforeGrants);assert.deepEqual((await snapshot()).leads,saved.leads,'rate refusal cannot persist an actionable intake');
 assert.equal((await route.POST(request())).status,200,'same-ID retry still succeeds after five new intents');
 const oldCookie=cookie;cookie='e'.repeat(64);assert.equal((await route.POST(request())).status,503);cookie=oldCookie;
 unknownFailure=true;assert.equal((await route.POST(request())).status,503);unknownFailure=false;
 unknownFailure='untrusted429';const privateFailure=await route.POST(request());assert.equal(privateFailure.status,429);assert.equal((await privateFailure.json()).error,'Too many demo attempts. Please wait before trying again.');unknownFailure=false;
 await q("update icash_request_limits set attempts=59 where bucket like 'bot-demo-attempt:%'");
 assert.equal((await route.POST(request())).status,200);const callsBefore=dbCalls.length;
 assert.equal((await route.POST(request())).status,429);assert.equal(dbCalls.length,callsBefore,'61st transport attempt cannot reach intake');
 const refusal={code:'PT429',message:'Demo submission limit reached'};
 assert(await voiceReservationFailure('rpc/icash_submit_limited_bot_demo_intake',429,Response.json(refusal)) instanceof BotDemoRateLimitError);
 for(const [path,status,payload] of [['rpc/other',429,refusal],['rpc/icash_submit_limited_bot_demo_intake',503,refusal],['rpc/icash_submit_limited_bot_demo_intake',429,{...refusal,code:'XX000'}],['rpc/icash_submit_limited_bot_demo_intake',429,{...refusal,message:'Other error'}]])
  assert(!(await voiceReservationFailure(path,status,Response.json(payload)) instanceof BotDemoRateLimitError));
 console.log('PASS demo HTTP: readiness cookie precedes POST, lost readiness/POST response safety, original validation, six exact retries,5-new/60-total caps, no post-denial work, exact429 versus unknown503.');
}finally{await pg.close();}
