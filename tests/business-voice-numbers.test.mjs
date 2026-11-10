import assert from 'node:assert/strict';
import {voiceOnlyBusinessPhones,novemberBusinessPhones} from '../lib/business-phone-policy.ts';
import {businessVoiceProviders,inspectBusinessPhone,connectBusinessPhone,selectBusinessCaller,secondaryCallingReady,primaryBusinessPhone as first,secondaryBusinessPhone as second,businessVoiceIngress as ingress} from '../lib/business-voice-numbers.ts';
const ac='AC'+'a'.repeat(32),pn='PN'+'b'.repeat(32);
const env={CONTIGUITY_API_KEY:'test-only-contiguity',TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'test-only-carrier-token',VERCEL_ENV:'production'};
let target=second;
let f,verified,lease,route,requests,writes;
function reset(){f={enabled:false,to:null,status:'active',estimated_completion:null};verified=false;lease=true;route=true;requests=[];writes=[];}
const fetcher=async(url,init)=>{
 requests.push({url,method:init.method,body:init.body});assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
 if(url.endsWith('/numbers/leased'))return Response.json({data:{numbers:[{number:{e164:target},lease_status:lease?'active':'expired',capabilities:{channels:['sms']}}]}});
 if(url.includes('OutgoingCallerIds.json'))return Response.json({outgoing_caller_ids:verified?[{sid:pn,account_sid:ac,phone_number:target}]:[],next_page_uri:null});
 if(url.includes('IncomingPhoneNumbers.json'))return Response.json({incoming_phone_numbers:[{sid:pn,account_sid:ac,phone_number:ingress,capabilities:{voice:true},voice_url:route?'https://www.geticashx.com/api/reception/inbound':'https://example.com/wrong',voice_method:'POST'}],next_page_uri:null});
 assert(url.includes(encodeURIComponent(target)));assert(!url.includes(encodeURIComponent(first)));
 if(url.endsWith('/enable')){assert.equal(init.method,'POST');assert.deepEqual(JSON.parse(init.body),{to:ingress});f={enabled:true,to:ingress,status:'active',estimated_completion:null};}
 else assert.equal(init.method,'GET');
 return Response.json({object:'response',data:{number:target,call_forwarding:f}});
};
const db=async(path,method,body)=>{writes.push({path,method,body});return null;};
reset();const before=await inspectBusinessPhone(env,fetcher);assert.equal(before.incoming,false);assert.equal(before.callerIdVerified,false);assert(requests.every(r=>r.method==='GET'));
const incoming=await connectBusinessPhone(db,env,fetcher);assert.equal(incoming.incoming,true);assert.equal(incoming.callerIdVerified,false);assert.equal(writes.at(-1).body.p_enabled,false);assert.equal(requests.filter(r=>r.method==='POST').length,1);
verified=true;await connectBusinessPhone(db,env,fetcher);assert.equal(writes.at(-1).body.p_enabled,true);assert.equal(writes.at(-1).body.p_caller_id_sid,pn);assert.equal(requests.filter(r=>r.method==='POST').length,1,'Already forwarded numbers are not rewritten');
for(const mutate of [()=>lease=false,()=>route=false,()=>f={enabled:true,to:first,status:'active',estimated_completion:null}]){reset();mutate();await assert.rejects(connectBusinessPhone(db,env,fetcher));assert.equal(requests.filter(r=>r.method==='POST').length,0);assert.equal(writes.length,0);}
reset();await assert.rejects(connectBusinessPhone(db,{...env,VERCEL_ENV:'preview'},fetcher));assert.equal(requests.length,0);
reset();verified=true;f={enabled:true,to:ingress,status:'active',estimated_completion:null};const readyDb=async()=>[{provider_account_sid:ac,caller_id_sid:pn,forwarding_ready:true,outbound_enabled:true}];assert.equal(await secondaryCallingReady(readyDb,env,fetcher),true);verified=false;assert.equal(await secondaryCallingReady(readyDb,env,fetcher),false);verified=true;lease=false;assert.equal(await secondaryCallingReady(readyDb,env,fetcher),false);
assert.equal(selectBusinessCaller(first,[]),first);assert.equal(selectBusinessCaller(first,[{sender:first}]),first);assert.equal(selectBusinessCaller(first,[{sender:second,sender_pool_assigned:true}]),second);
for(const threads of [[{sender:second}],[{sender:first},{sender:second,sender_pool_assigned:true}],[{sender:'+12125550101',sender_pool_assigned:true}]])assert.throws(()=>selectBusinessCaller(first,threads));
reset();await assert.rejects(businessVoiceProviders(env,async()=>Response.json({outgoing_caller_ids:[{account_sid:ac,phone_number:target,sid:pn}],next_page_uri:'/next'})).callerId());
console.log('PASS business voice: exact lease/account/caller ID, idempotent forwarding, preview isolation, conversation continuity, provider revocation, and no calls or messages sent');

target='+17208134296';reset();verified=true;
const added=await connectBusinessPhone(db,env,fetcher,target);assert.equal(added.phone,target);assert.equal(added.incoming,true);assert.equal(writes.at(-1).body.p_phone,target);assert.equal(writes.at(-1).body.p_enabled,true);
assert.equal(await secondaryCallingReady(readyDb,env,fetcher,target),true);f.enabled=false;assert.equal(await secondaryCallingReady(readyDb,env,fetcher,target),false,'Forwarding revocation prevents further calls');
assert.equal(selectBusinessCaller(first,[{sender:target,sender_pool_assigned:true}]),target);
assert.throws(()=>selectBusinessCaller(first,[{sender:target}]));
reset();assert.throws(()=>businessVoiceProviders(env,fetcher,'+12125550199'));assert.equal(requests.length,0);
reset();await assert.rejects(inspectBusinessPhone(env,async(url,init)=>{const response=await fetcher(url,init);if(url.includes('call_forwarding')){const data=await response.json();data.data.number=second;return Response.json(data);}return response;},target));

for(const phone of [...voiceOnlyBusinessPhones,...novemberBusinessPhones]){
 target=phone;reset();
 const connected=await connectBusinessPhone(db,env,fetcher,phone);
 assert.equal(connected.phone,phone);assert.equal(connected.incoming,true);assert.equal(connected.callerIdVerified,false);
 assert.deepEqual(writes.at(-1).body,{p_phone:phone,p_account_sid:ac,p_caller_id_sid:null,p_forwarding:true,p_enabled:false});
 assert.equal(await secondaryCallingReady(readyDb,env,fetcher,phone),false,'Missing caller ID always blocks outgoing calls');
 verified=true;await connectBusinessPhone(db,env,fetcher,phone);
 assert.equal(writes.at(-1).body.p_caller_id_sid,pn);assert.equal(writes.at(-1).body.p_enabled,true,'Verified caller ID and active forwarding enable outgoing');
 assert.equal(await secondaryCallingReady(readyDb,env,fetcher,phone),true,'Verified active number is ready for outgoing calls');verified=false;assert.equal(await secondaryCallingReady(readyDb,env,fetcher,phone),false,'Caller ID revocation blocks further calls');verified=true;f.enabled=false;assert.equal(await secondaryCallingReady(readyDb,env,fetcher,phone),false,'Forwarding revocation blocks further calls');
 reset();f={enabled:true,to:ingress,status:'queued',estimated_completion:null};
 const pending=await connectBusinessPhone(db,env,fetcher,phone);
 assert.equal(pending.incoming,false);assert.equal(pending.incomingPending,true);
 assert.equal(writes.at(-1).body.p_forwarding,false);assert.equal(writes.at(-1).body.p_enabled,false);
 assert.equal(requests.filter(r=>r.method==='POST').length,0,'Queued forwarding is never enabled twice');
 reset();f={enabled:true,to:first,status:'active',estimated_completion:null};
 await assert.rejects(connectBusinessPhone(db,env,fetcher,phone));assert.equal(writes.length,0);assert(requests.every(r=>r.method==='GET'));
}
console.log('PASS both new business numbers: verified outbound only, provider revocation, exact forwarding, queued idempotency and existing-destination protection.');

// Recover an uncertain update only from fresh, exact provider reads. None of
// these fixtures place a call, send a message, or retry the configuration POST.
target='+15055072937';
for(const outcome of ['active','queued','disabled','different destination','expired lease','wrong ingress','unreadable check']){
 reset();
 const uncertain=async(url,init)=>{
  if(url.endsWith('/enable')){
   await fetcher(url,init);
   if(outcome==='queued')f.status='queued';
   if(outcome==='disabled')f.enabled=false;
   if(outcome==='different destination')f.to=first;
   if(outcome==='expired lease')lease=false;
   if(outcome==='wrong ingress')route=false;
   throw new TypeError('private transport detail '+env.CONTIGUITY_API_KEY);
  }
  if(outcome==='unreadable check'&&f.enabled&&url.endsWith('/call_forwarding'))return Response.json({private:env.TWILIO_AUTH_TOKEN});
  return fetcher(url,init);
 };
 if(outcome==='active'||outcome==='queued'){
  const recovered=await connectBusinessPhone(db,env,uncertain,target);
  assert.equal(recovered.incoming,outcome==='active');assert.equal(recovered.incomingPending,outcome==='queued');
  assert.equal(writes.length,1);assert.equal(writes[0].body.p_forwarding,outcome==='active');assert.equal(writes[0].body.p_enabled,false);
 }else{
  await assert.rejects(connectBusinessPhone(db,env,uncertain,target),e=>e.message.startsWith('Contiguity call routing')&&!e.message.includes('private')&&!e.message.includes(env.CONTIGUITY_API_KEY)&&!e.message.includes(env.TWILIO_AUTH_TOKEN));
  assert.equal(writes.length,0,'Unconfirmed routing never changes saved readiness');
 }
 assert.equal(requests.filter(r=>r.method==='POST').length,1,'Recovery performs no second configuration mutation');
}
for(const response of [()=>new Response('{bad-json',{headers:{'Content-Type':'application/json'}}),()=>Response.json({object:'response',data:{number:target,call_forwarding:{...f,estimated_completion:'not-a-number'}}})]){
 reset();
 const malformed=async(url,init)=>{const r=await fetcher(url,init);return url.endsWith('/enable')?response():r;};
 assert.equal((await connectBusinessPhone(db,env,malformed,target)).incoming,true,'Fresh active confirmation recovers malformed update receipts');
 assert.equal(writes.length,1);assert.equal(requests.filter(r=>r.method==='POST').length,1);
}
reset();
await assert.rejects(connectBusinessPhone(db,env,async(url,init)=>{
 if(url.endsWith('/enable')){requests.push({url,method:init.method});return Response.json({object:'response',data:{number:target,call_forwarding:{...f,estimated_completion:'private '+env.CONTIGUITY_API_KEY}}});}
 return fetcher(url,init);
},target),/Contiguity call routing update returned an invalid estimated_completion response/);
assert.equal(writes.length,0);
console.log('PASS connection recovery: one update, exact fresh readback, queued holds, malformed/lost responses, redacted errors and no false readiness.');

// Reproduce carrier setup that exceeds the former eight-second read deadline.
// The provider only applies the update if its request remains connected.
reset();
const slowSetup=async(url,init)=>{
 if(url.endsWith('/enable'))await new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);reject(init.signal.reason);};
  const timer=setTimeout(()=>{init.signal.removeEventListener('abort',abort);resolve();},9000);
  if(init.signal.aborted)abort();else init.signal.addEventListener('abort',abort,{once:true});
 });
 return fetcher(url,init);
};
assert.equal((await connectBusinessPhone(db,env,slowSetup,target)).incoming,true);
assert.equal(writes.length,1);assert.equal(writes[0].body.p_forwarding,true);
assert.equal(requests.filter(r=>r.method==='POST').length,1);
console.log('PASS slow forwarding setup: finishes beyond eight seconds, verifies the result and saves once without a second POST.');
