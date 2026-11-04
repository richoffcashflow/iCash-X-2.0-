// Offline provider fixtures only. No credentials or real network requests.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {outboundCarrierInput} from '../lib/outbound-carrier-usage.ts';
import {settleBoundVoiceUsage} from '../lib/voice-usage-service.ts';
import {costCategories} from '../lib/cost-guard.ts';

const account='11111111-1111-4111-8111-111111111111';
const job='22222222-2222-4222-8222-222222222222';
const ac='AC'+'a'.repeat(32),ca='CA'+'b'.repeat(32),to='+19075551234',from='+12125551234';
const terminal='2020-01-02T00:01:01.000Z';
const binding={operation_key:'voice:'+job,conversation_id:'conv_terminalfixture',agent_id:'agent_fixture',contact_key:createHash('sha256').update(to).digest('hex'),created_at:'2020-01-02T00:00:00Z'};
const rule={kind:'outbound_carrier_estimate',evidenceRef:'offline reviewed carrier fixture',snapshotId:'offline_terminal_fixture',accountId:account,agentId:binding.agent_id,twilioAccountSid:ac,from,reviewedAt:'2020-01-01',validFrom:'2020-01-01',validUntil:'9999-12-31',voice:{microsPerMinute:0,rounding:'up',minimumMinutes:0},stream:{microsPerMinute:6000,rounding:'exact',minimumMinutes:0,assumption:'Offline reviewed carrier-duration proxy for stream usage'},source:{kind:'twilio_pricing_api',allowedCountries:['US'],maxMicrosPerMinute:100000,policyVersion:'offline_original_carrier_policy',maxPricingLagSeconds:86400}};
const policyHash=createHash('sha256').update(JSON.stringify(rule)).digest('hex');
const env={TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'offline-only-token',ELEVENLABS_API_KEY:'offline-only-key'};
const version='required-audio-30d-speech-v1:terminal-fixture';
const policy={enabled:true,version,rateId:'offline-rate',operation:'seller_call',reviewedAt:'2020-01-01',validFrom:'2020-01-01',validUntil:'9999-12-31',evidenceRef:'offline original voice policy',components:Object.fromEntries(costCategories.filter(k=>k!=='elevenlabs').map(k=>[k,k==='twilio'?rule:k==='other'?{kind:'recording_addon_estimate',policyVersion:'required-audio-30d-speech-v1',evidenceRef:'offline original recording policy'}:{kind:'fixed_estimate',amountMicros:0,evidenceRef:'offline original allocation'}]))};

let el,call,country,jobRow,recording,stored,reads,writes,settlements,ai,insertWinner,settlementAllowed;
function reset(){
 el={conversation_id:binding.conversation_id,agent_id:binding.agent_id,status:'done',metadata:{phone_call:{call_sid:ca}}};
 call={sid:ca,account_sid:ac,to,from,direction:'outbound-api',status:'completed',duration:'61',end_time:terminal,price:'-0.01234000',price_unit:'USD'};
 country={phone_number:to,valid:true,country_code:'US'};
 jobRow={provider_call_sid:ca,conversation_id:binding.conversation_id,state:'dispatched'};
 recording={state:'available',rate_id:policy.rateId,recording_sid:'RE'+'c'.repeat(32),call_sid:ca,conversation_id:binding.conversation_id,entry_policy:'direct_recorded_v1',recording_authorized_at:binding.created_at,start_claimed_at:binding.created_at,provider_started_at:binding.created_at,ended_at:'2020-01-02T00:00:30Z',duration_seconds:30,pricing_policy:{version:'required-audio-30d-speech-v1'},provider_recording_price_micros:2500};
 stored=[];reads=[];writes=[];settlements=[];ai=[{amount:'0.01',units:'USD'}];insertWinner=null;settlementAllowed=true;
}
const tariffSnapshot=()=>({policyHash,accountSid:ac,callSid:ca,conversationId:binding.conversation_id,agentId:binding.agent_id,destinationHash:binding.contact_key,from,isoCountry:'US',unit:'USD',microsPerMinute:94500,fetchedAt:'2020-01-02T01:01:01.000Z',source:'twilio_pricing_api'});
const db=async(path,method,body)=>{
 if(path.startsWith('icash_voice_jobs?')){
  assert.equal(method,undefined);assert(path.includes('id=eq.'+job));assert(path.includes('account_id=eq.'+account));return [jobRow];
 }
 if(path.startsWith('icash_outbound_price_snapshots?')){assert(path.includes('account_id=eq.'+account));assert(path.includes('operation_key=eq.'+encodeURIComponent(binding.operation_key)));return structuredClone(stored);}
 if(path==='rpc/icash_record_outbound_price_snapshot'){
  assert.equal(method,'POST');assert.equal(body.p_account,account);assert.equal(body.p_operation,binding.operation_key);writes.push(structuredClone(body));
  if(!stored.length)stored=[{snapshot:structuredClone(insertWinner??body.p_snapshot)}];return null;
 }
 if(path.startsWith('icash_live_conversations?')){assert(path.includes('account_id=eq.'+account));return [{...binding,state:'complete',completed_at:terminal,result:{durationSeconds:15}}];}
 if(path.startsWith('icash_operation_spend?'))return [{rate_id:policy.rateId,state:'dispatched'}];
 if(path.startsWith('icash_operation_rates?'))return [{operation:'seller_call',version}];
 if(path.startsWith('icash_cost_observations?'))return ai;
 if(path.startsWith('icash_call_recordings?'))return [recording];
 if(path==='rpc/icash_settle_voice_usage'){assert.equal(method,'POST');settlements.push(structuredClone(body));return settlementAllowed;}
 throw Error('Unexpected offline database request: '+path);
};
const fetcher=async(url,init)=>{
 reads.push(url);assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.credentials,'omit');assert(init.signal);
 if(url===`https://api.elevenlabs.io/v1/convai/conversations/${binding.conversation_id}`){assert.equal(init.headers['xi-api-key'],env.ELEVENLABS_API_KEY);return Response.json(el);}
 assert.equal(init.headers.Authorization,'Basic '+Buffer.from(ac+':'+env.TWILIO_AUTH_TOKEN).toString('base64'));
 if(url===`https://api.twilio.com/2010-04-01/Accounts/${ac}/Calls/${ca}.json`)return Response.json(call);
 if(url===`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(to)}`){assert.equal(new URL(url).search,'','No paid Lookup Fields packages');return Response.json(country);}
 throw Error('Unexpected provider request; current tariffs are forbidden: '+url);
};
const collect=(r=rule,b=binding,a=account)=>outboundCarrierInput(db,a,b,r,env,fetcher);
const settle=()=>settleBoundVoiceUsage(db,account,'offline-call',[policy],{env,fetcher});

// Runtime diagnostics identify the rejected evidence boundary without exposing
// credentials, account/call/phone identifiers or untrusted provider content.
const originalWarn=console.warn,diagnostics=[];
try{
 console.warn=(...args)=>diagnostics.push(args);
 reset();el.metadata.phone_call.call_sid='private-provider-value';
 assert.deepEqual(await settle(),{status:'held',reason:'cost_evidence_incomplete'});
 assert.deepEqual(diagnostics,[['outbound_carrier_evidence_held',{stage:'conversation_receipt'}],['voice_cost_evidence_held',{stage:'twilio',reason:'cost_evidence_incomplete'}]]);
 assert.equal(settlements.length,0);assert.equal(writes.length,0);
 const printed=JSON.stringify(diagnostics);
 for(const secret of [account,ca,to,from,env.ELEVENLABS_API_KEY,env.TWILIO_AUTH_TOKEN,'private-provider-value'])assert.equal(printed.includes(secret),false);
 console.warn=()=>{throw Error('logging unavailable');};
 reset();jobRow.state='dispatching';
 assert.deepEqual(await settle(),{status:'held',reason:'cost_evidence_incomplete'});
 assert.equal(settlements.length,0);assert.equal(writes.length,0);
}finally{console.warn=originalWarn;}

reset();const recovered=await collect();
assert.equal(recovered.kind,'fixed_estimate');assert.equal(recovered.amountMicros,18440,'12,340 actual connectivity + 6,100 original stream estimate');
assert.match(recovered.evidenceRef,/connectivity 12340 micros verified/);assert.match(recovered.evidenceRef,/stream 6000\/minute exact/);
assert.equal(stored[0].snapshot.source,'twilio_call_receipt');assert.equal(stored[0].snapshot.connectivityMicros,12340);assert.equal(stored[0].snapshot.durationSeconds,61);assert.equal(stored[0].snapshot.terminalAt,terminal);
assert.equal(writes.length,1);assert.equal(reads.length,3);assert(reads.every(url=>!url.startsWith('https://pricing.twilio.com/')));
const receipt=structuredClone(stored);
assert.deepEqual(await collect(),recovered);assert.deepEqual(stored,receipt);assert.equal(writes.length,1);assert.equal(reads.filter(url=>url.includes('lookups.twilio.com')).length,1);

// A previously saved tariff wins even after expiry, and never becomes a receipt.
reset();stored=[{snapshot:tariffSnapshot()}];const old=structuredClone(stored);call.price='-0.000001';
assert.equal((await collect()).amountMicros,195100);assert.deepEqual(stored,old);assert.equal(writes.length,0);assert.equal(reads.length,2);
// An in-flight tariff writer also wins. The collector must reread, not use its proposed value.
reset();insertWinner=tariffSnapshot();assert.equal((await collect()).amountMicros,195100);assert.equal(stored[0].snapshot.source,'twilio_pricing_api');assert.equal(writes.length,1);
reset();insertWinner={...tariffSnapshot(),callSid:'CA'+'d'.repeat(32)};await assert.rejects(collect());assert.equal(stored[0].snapshot.callSid,insertWinner.callSid);assert.equal(writes.length,1);

// Strict actual USD evidence and original per-minute ceiling, with no invented zero.
for(const [price,unit] of [[null,'USD'],[undefined,'USD'],['0.01','USD'],['-0.01','EUR'],['-0.0000001','USD'],['-Infinity','USD'],['-0.200001','USD'],[-0.01,'USD']]){
 reset();call.price=price;call.price_unit=unit;await assert.rejects(collect());assert.equal(writes.length,0);assert.equal(reads.length,2);
}
reset();call.price='0.000000';assert.equal((await collect()).amountMicros,6100,'Explicit zero connectivity retains stream cost');
reset();call.duration='0';call.price='-0.001';await assert.rejects(collect());assert.equal(writes.length,0);
for(const mutate of [()=>country.country_code='CA',()=>country.phone_number='+12125559999',()=>country.valid=false,()=>delete country.country_code]){
 reset();mutate();await assert.rejects(collect());assert.equal(writes.length,0);
}

// Binding failures cannot create a historical receipt.
for(const mutate of [()=>el.agent_id='other',()=>el.conversation_id='other',()=>el.metadata.phone_call.call_sid='CA'+'d'.repeat(32),()=>call.sid='CA'+'d'.repeat(32),()=>call.account_sid='AC'+'d'.repeat(32),()=>call.to='+12125559999',()=>call.from='+12125559999',()=>call.direction='inbound',()=>call.status='in-progress',()=>jobRow.conversation_id='other',()=>jobRow.state='dispatching',()=>jobRow.provider_call_sid=null]){
 reset();mutate();await assert.rejects(collect());assert.equal(writes.length,0);
}
reset();await assert.rejects(collect({...rule,accountId:'another-account'}));assert.equal(reads.length,0);assert.equal(writes.length,0);
reset();await assert.rejects(collect(rule,binding,'another-account'));assert.equal(reads.length,0);assert.equal(writes.length,0);

// First receipt remains immutable if any later canonical amount/binding contradicts it.
for(const mutate of [p=>p.policyHash='other',p=>p.accountSid='AC'+'d'.repeat(32),p=>p.callSid='CA'+'d'.repeat(32),p=>p.conversationId='other',p=>p.agentId='other',p=>p.destinationHash='other',p=>p.from='+12125559999',p=>p.unit='EUR',p=>p.isoCountry='CA',p=>p.connectivityMicros=12341,p=>p.durationSeconds=62,p=>p.terminalAt='2020-01-02T00:01:02.000Z',p=>p.source='unrecognized',p=>p.fetchedAt='2020-01-02T01:01:01.000Z']){
 reset();await collect();mutate(stored[0].snapshot);const before=structuredClone(stored);await assert.rejects(collect());assert.deepEqual(stored,before);assert.equal(writes.length,1);
}
reset();await collect();const prior=structuredClone(stored);call.price='-0.012350';await assert.rejects(collect());assert.deepEqual(stored,prior);assert.equal(writes.length,1);

// Complete original 16-category settlement includes independent recording/storage cost.
reset();assert.deepEqual(await settle(),{status:'settled',costBasis:'estimated'});assert.equal(settlements.length,1);
let components=settlements[0].p_components;assert.equal(Object.keys(components).length,16);assert.equal(components.twilio.amountMicros,18440);assert.equal(components.twilio.basis,'estimated');assert.equal(components.elevenlabs.amountMicros,10000);assert.equal(components.elevenlabs.basis,'verified');assert.equal(components.llm.amountMicros,0);assert.equal(components.other.amountMicros,3036,'Recorded connectivity price never replaces recording/storage costs');

// Independent carrier collection is allowed, but missing inclusive AI USD never settles.
reset();ai=[];assert.deepEqual(await settle(),{status:'held',reason:'provider_receipt_missing'});assert.equal(writes.length,1);assert.equal(settlements.length,0);
const savedWithoutAi=structuredClone(stored);ai=[{amount:'0.01',units:'USD'}];assert.deepEqual(await settle(),{status:'settled',costBasis:'estimated'});assert.equal(writes.length,1);assert.equal(settlements.length,1);assert.deepEqual(stored,savedWithoutAi);assert.equal(reads.filter(url=>url.includes('lookups.twilio.com')).length,1);
reset();ai=[];el.status='failed';el.metadata.call_duration_secs=0;el.metadata.error={reason:'[quota_exceeded] offline fixture'};el.transcript=[];el.has_user_audio=false;el.has_response_audio=false;
assert.deepEqual(await settle(),{status:'held',reason:'provider_receipt_missing'});assert.equal(writes.length,0);assert.equal(settlements.length,0,'Historical quota failure is never treated as free AI');
for(const mutate of [()=>call.price=null,()=>country.country_code='CA',()=>recording.recording_sid=null,()=>recording.rate_id='another-rate']){
 reset();mutate();assert.equal((await settle()).status,'held');assert.equal(settlements.length,0);
}
reset();settlementAllowed=false;assert.deepEqual(await settle(),{status:'held',reason:'ledger_review_required'});assert.equal(settlements.length,1,'Original ledger retains final charge-cap authority');
console.log('PASS: old canonical terminal USD receipts, immutable tariffs/first-writer races, strict country/identity/price binding, independent missing-AI collection, all 16 original cost categories and unchanged ledger authority');
