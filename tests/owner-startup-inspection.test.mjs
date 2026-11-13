import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectOwnerStartup,ownerStartupDiagnosticKey} from '../scripts/inspect-owner-startup-20261113.mjs';
import {sha,recordingBaseUrl} from '../lib/required-call-recording.ts';
const now=Date.parse('2026-11-13T05:00:00Z'),ac='AC'+'a'.repeat(32),nonce='f'.repeat(64);
const row={id:'c3314569-a134-4fa0-b0e7-a83ed83e0280',account_id:'48dfb798-8c1a-404f-88c0-c396cc067062',call_sid:'CA263fbbaa9e0c902454d37f345554c3e5',provider_account_sid:ac,from_phone:'+12125550101',to_phone:'+12125550102',state:'failed',nonce_hash:sha(nonce),start_claimed_at:null,recording_authorized_at:'2026-11-13T03:16:54Z',conversation_id:null};
const env={VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'main',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'synthetic-database-secret',TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'synthetic-twilio-token-only'};
function fixture({prior=false,patch={},callPatch={},eventPatch={}}={}){
 const calls=[];let saved;
 const fetcher=async(raw,init)=>{
  const u=new URL(raw);calls.push({host:u.host,path:u.pathname,method:init.method});
  assert.equal(init.redirect,'error');let value;
  if(u.hostname==='fixture.supabase.co'){
   if(init.method==='POST'){assert.equal(u.pathname,'/rest/v1/icash_integration_checks');assert.equal(init.headers.Prefer,'resolution=ignore-duplicates');saved=JSON.parse(init.body);return new Response(null,{status:201});}
   assert.equal(init.method,'GET');
   if(u.pathname.endsWith('/icash_integration_checks'))value=prior?[{provider:ownerStartupDiagnosticKey}]:[];
   else {assert.equal(u.searchParams.get('account_id'),'eq.'+row.account_id);assert.equal(u.searchParams.get('id'),'eq.'+row.id);value=[{...row,...patch}];}
  }else{
   assert.equal(u.hostname,'api.twilio.com');assert.equal(init.method,'GET');assert.equal(init.body,undefined);
   if(u.pathname.endsWith('/'+row.call_sid+'.json'))value={sid:row.call_sid,account_sid:ac,from:row.from_phone,to:row.to_phone,direction:'outbound-api',status:'completed',end_time:'2026-11-13T03:16:55Z',...callPatch};
   else if(u.pathname.endsWith('/Events.json'))value={page:0,page_size:100,next_page_uri:null,events:[{request:{method:'POST',url:recordingBaseUrl+'/connect?id='+row.id+'&nonce='+nonce,parameters:{account_sid:ac,call_sid:row.call_sid}},response:{response_code:200,request_duration:12040,response_body:'<Response><Hangup/></Response>',...eventPatch}}]};
   else {assert(u.pathname.endsWith('/Notifications.json'));value={next_page_uri:null,notifications:[{account_sid:ac,call_sid:row.call_sid,error_code:'11205',message:'secret provider details'}]};}
  }
  return Response.json(value);
 };
 return {fetcher,calls,get saved(){return saved;}};
}
const f=fixture();assert.equal(await inspectOwnerStartup(env,f.fetcher,now),'saved');assert.equal(f.saved.provider,ownerStartupDiagnosticKey);assert.equal(f.saved.result.events[0].requestDurationMs,12040);assert.deepEqual(f.saved.result.notifications.errorCodes,[11205]);assert.equal(f.saved.result.callsPlaced,0);assert.equal(f.saved.result.messagesSent,0);
for(const secret of [nonce,env.TWILIO_AUTH_TOKEN,env.SUPABASE_SECRET_KEY,row.to_phone,'secret provider details'])assert(!JSON.stringify(f.saved).includes(secret));
assert.equal(f.calls.filter(x=>x.method==='POST').length,1);assert.equal(f.calls.filter(x=>x.host==='api.twilio.com').length,3);
for(const patch of [{VERCEL_ENV:'preview'},{VERCEL_GIT_COMMIT_REF:'feature'},{VERCEL_GIT_COMMIT_SHA:''}]){const g=fixture();assert.equal(await inspectOwnerStartup({...env,...patch},g.fetcher,now),'skipped');assert.equal(g.calls.length,0);}
const expired=fixture();assert.equal(await inspectOwnerStartup(env,expired.fetcher,Date.parse('2026-11-16T00:00:00Z')),'skipped');assert.equal(expired.calls.length,0);
const prior=fixture({prior:true});assert.equal(await inspectOwnerStartup(env,prior.fetcher,now),'already_saved');assert.equal(prior.calls.length,1);
for(const patch of [{account_id:'wrong'},{call_sid:'wrong'},{state:'recording'},{start_claimed_at:row.recording_authorized_at},{conversation_id:'conv_other'}]){const g=fixture({patch});assert.equal(await inspectOwnerStartup(env,g.fetcher,now),'binding_unavailable');assert.equal(g.calls.length,2);assert.equal(g.saved,undefined);}
const foreign=fixture({callPatch:{to:'+12125550999'}});assert.equal(await inspectOwnerStartup(env,foreign.fetcher,now),'carrier_binding_mismatch');assert.equal(foreign.saved,undefined);
console.log('PASS exact failed-call inspection: production/main/expiry and canonical identity gates, GET-only provider reads, immutable private timing receipt, no credential or phone disclosure, no replay.');
const deployment=JSON.parse(readFileSync('vercel.json','utf8'));
assert(deployment.buildCommand.length<=256,'Hosting build command stays within its schema limit');
assert(deployment.buildCommand.includes('scripts/check-telephony-connection.mjs'));
assert(readFileSync('scripts/check-telephony-connection.mjs','utf8').includes("await import('./inspect-owner-startup-20261113.mjs')"));
