import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {outboundCarrierInput} from '../lib/outbound-carrier-usage.ts';
const ac='AC'+'a'.repeat(32),ca='CA'+'b'.repeat(32),job='12345678-1234-1234-1234-123456789abc';
const binding={operation_key:'voice:'+job,conversation_id:'conv_fixture',agent_id:'agent_fixture',contact_key:createHash('sha256').update('+19075551234').digest('hex'),created_at:'2026-10-02'};
// Synthetic unit prices only; these fixtures are never deployment configuration.
const rule={kind:'outbound_carrier_estimate',evidenceRef:'fixture reviewed evidence',snapshotId:'fixture_snapshot_v1',accountId:'account',agentId:'agent_fixture',twilioAccountSid:ac,from:'+12125551234',destination:'+19075551234',reviewedAt:'2026-10-01',validFrom:'2026-10-01',validUntil:'2026-10-07',voice:{microsPerMinute:100000,rounding:'up',minimumMinutes:0},stream:{microsPerMinute:6000,rounding:'exact',minimumMinutes:0,assumption:'Stream uses carrier seconds as explicitly reviewed conservative estimate'},source:{kind:'reviewed_destination_allowlist',documentUrl:'https://example.com/fixture',reviewer:'fixture reviewer'}};
const env={TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'test-only-token',ELEVENLABS_API_KEY:'test-only-key'};
let el,call,jobRow,seen;
function reset(){el={conversation_id:'conv_fixture',agent_id:'agent_fixture',status:'done',metadata:{phone_call:{call_sid:ca}}};call={sid:ca,account_sid:ac,to:rule.destination,from:rule.from,direction:'outbound-api',status:'completed',duration:'61',end_time:new Date(Date.now()-1000).toUTCString(),price:null};jobRow={provider_call_sid:ca,conversation_id:'conv_fixture',state:'dispatched'};seen=[];}
const db=async(path,method)=>{assert.equal(method,undefined);assert(path.includes('account_id=eq.account'));assert(path.includes('id=eq.'+job));return [jobRow];};
const fetcher=async(url,init)=>{seen.push(url);assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert(init.signal);if(url.startsWith('https://api.elevenlabs.io/')){assert.equal(init.headers['xi-api-key'],env.ELEVENLABS_API_KEY);return Response.json(el);}assert.equal(url,`https://api.twilio.com/2010-04-01/Accounts/${ac}/Calls/${ca}.json`);assert(init.headers.Authorization.startsWith('Basic '));return Response.json(call);};
reset();const result=await outboundCarrierInput(db,'account',binding,rule,env,fetcher);assert.equal(result.kind,'fixed_estimate');assert.equal(result.amountMicros,206100);assert(result.evidenceRef.includes('actual carrier seconds:61'));assert(result.evidenceRef.includes('sha256:'));assert.equal(seen.length,2);
// Null or later-populated Call.price never invents a receipt or changes snapshot result.
call.price='-0.123';assert.deepEqual(await outboundCarrierInput(db,'account',binding,rule,env,fetcher),result);
for(const mutate of [()=>el.agent_id='other',()=>el.conversation_id='other',()=>el.metadata.phone_call.call_sid='CA'+'c'.repeat(32),()=>el.status='processing',()=>delete el.metadata.phone_call,()=>call.account_sid='AC'+'d'.repeat(32),()=>call.sid='CA'+'e'.repeat(32),()=>call.to='+12125559999',()=>call.from='+12125559999',()=>call.direction='inbound',()=>call.status='in-progress',()=>call.duration=null,()=>call.duration=61,()=>call.duration='-1',()=>call.duration='1.5',()=>call.end_time=null,()=>jobRow.conversation_id='other',()=>jobRow.provider_call_sid=null,()=>jobRow.state='dispatching']){reset();mutate();await assert.rejects(outboundCarrierInput(db,'account',binding,rule,env,fetcher));}
for(const mutate of [r=>r.destination='+1*',r=>r.accountId='other',r=>r.agentId='other',r=>r.twilioAccountSid='AC'+'f'.repeat(32),r=>r.reviewedAt='2026-10-03',r=>r.validUntil='2026-10-01',r=>r.source.kind='model',r=>r.stream.assumption='',r=>r.voice.microsPerMinute=-1,r=>r.voice.rounding='exact']){reset();const r=structuredClone(rule);mutate(r);await assert.rejects(outboundCarrierInput(db,'account',binding,r,env,fetcher));assert.equal(seen.length,0);}
reset();await assert.rejects(outboundCarrierInput(db,'account',{...binding,contact_key:'other'},rule,env,fetcher));assert.equal(seen.length,0);
reset();await assert.rejects(outboundCarrierInput(db,'account',binding,rule,{},fetcher));assert.equal(seen.length,0);
reset();await assert.rejects(outboundCarrierInput(db,'account',binding,rule,env,async()=>Response.json({},{status:503})));
reset();await assert.rejects(outboundCarrierInput(db,'account',binding,rule,env,async()=>new Response('x'.repeat(262145))));
console.log('PASS: exact outbound account/agent/contact/job/EL SID/carrier binding, actual duration, null price, reviewed destination snapshots, hostile evidence, bounded reads');
// Scalable exact-number API path: immutable machine-created snapshots under one reviewed policy.
const apiRule=structuredClone(rule);delete apiRule.destination;apiRule.source={kind:'twilio_pricing_api',allowedCountries:['US'],maxMicrosPerMinute:100000,policyVersion:'fixture-api-policy-v1',maxPricingLagSeconds:86400};
let stored=[],pricing,priceReads=0,snapshotWrites=0;
const apiDb=async(path,method,body)=>{
 if(path.startsWith('icash_outbound_price_snapshots'))return stored;
 if(path==='rpc/icash_record_outbound_price_snapshot'){assert.equal(body.p_operation,binding.operation_key);assert.equal(body.p_account,'account');snapshotWrites++;if(!stored.length)stored=[{snapshot:body.p_snapshot}];return null;}
 return db(path,method,body);
};
const apiFetch=async(url,init)=>{
 if(url.startsWith('https://pricing.twilio.com/')){priceReads++;assert.equal(url,`https://pricing.twilio.com/v2/Voice/Numbers/${encodeURIComponent(call.to)}?OriginationNumber=${encodeURIComponent(call.from)}`);assert.equal(init.method,'GET');assert(init.headers.Authorization);return Response.json(pricing);}
 return fetcher(url,init);
};
function apiReset(){reset();stored=[];priceReads=0;snapshotWrites=0;pricing={destination_number:call.to,origination_number:call.from,price_unit:'USD',iso_country:'US',outbound_call_prices:[{current_price:'0.094500',origination_prefixes:['ALL']}]};}
apiReset();const apiResult=await outboundCarrierInput(apiDb,'account',binding,apiRule,env,apiFetch);assert.equal(apiResult.amountMicros,195100);assert.equal(snapshotWrites,1);assert.equal(priceReads,1);assert(apiResult.evidenceRef.includes('immutable Twilio Pricing API snapshot'));
pricing.outbound_call_prices[0].current_price='0.099';assert.deepEqual(await outboundCarrierInput(apiDb,'account',binding,apiRule,env,apiFetch),apiResult);assert.equal(priceReads,1);assert.equal(snapshotWrites,1);
for(const mutate of [()=>pricing.destination_number='+12125559999',()=>pricing.origination_number='+12125559999',()=>pricing.price_unit='EUR',()=>pricing.iso_country='CA',()=>pricing.outbound_call_prices=[],()=>pricing.outbound_call_prices.push(pricing.outbound_call_prices[0]),()=>pricing.outbound_call_prices[0].current_price=null,()=>pricing.outbound_call_prices[0].current_price='0.100001',()=>pricing.outbound_call_prices[0].current_price='-0.01',()=>pricing.outbound_call_prices[0].origination_prefixes=['44']]){apiReset();mutate();await assert.rejects(outboundCarrierInput(apiDb,'account',binding,apiRule,env,apiFetch));assert.equal(snapshotWrites,0);}
apiReset();await outboundCarrierInput(apiDb,'account',binding,apiRule,env,apiFetch);stored[0].snapshot.callSid='other';await assert.rejects(outboundCarrierInput(apiDb,'account',binding,apiRule,env,apiFetch));assert.equal(priceReads,1);
console.log('PASS: exact-number authenticated Pricing API with origin, USD/country/rate cap, immutable retries, fail-closed unsupported/ambiguous tariffs');
const {settleBoundVoiceUsage}=await import('../lib/voice-usage-service.ts');
const {costCategories}=await import('../lib/cost-guard.ts');
const policy={enabled:true,version:'fixture-policy-v1',rateId:'rate',operation:'seller_call',reviewedAt:'2026-10-01',validFrom:'2026-10-01',validUntil:'2026-10-07',evidenceRef:'fixture reviewed policy',components:Object.fromEntries(costCategories.filter(k=>k!=='elevenlabs').map(k=>[k,k==='twilio'?apiRule:{kind:'fixed_estimate',amountMicros:0,evidenceRef:'fixture allocation evidence'}]))};
let settlement=[];
const integrationDb=async(path,method,body)=>{
 if(path.startsWith('icash_live_conversations'))return [{...binding,state:'complete',completed_at:'2026-10-02',result:{durationSeconds:1}}];
 if(path.startsWith('icash_operation_spend'))return [{rate_id:'rate',state:'dispatched'}];
 if(path.startsWith('icash_operation_rates'))return [{operation:'seller_call'}];
 if(path.startsWith('icash_cost_observations'))return [{amount:'0.01',units:'USD'}];
 if(path==='rpc/icash_settle_voice_usage'){settlement.push(body);return true;}
 return apiDb(path,method,body);
};
apiReset();const settled=await settleBoundVoiceUsage(integrationDb,'account','call',[policy],{env,fetcher:apiFetch});assert.deepEqual(settled,{status:'settled',costBasis:'estimated'});assert.equal(Object.keys(settlement[0].p_components).length,16);assert.equal(settlement[0].p_components.twilio.amountMicros,195100);assert.equal(settlement[0].p_components.twilio.basis,'estimated');assert.equal(settlement[0].p_components.elevenlabs.amountMicros,10000);assert.equal(settlement[0].p_components.llm.amountMicros,0);
apiReset();settlement=[];call.to='+12125559999';assert.equal((await settleBoundVoiceUsage(integrationDb,'account','call',[policy],{env,fetcher:apiFetch})).status,'held');assert.equal(settlement.length,0);
apiReset();settlement=[];assert.equal((await settleBoundVoiceUsage(integrationDb,'account','call',[{...policy,enabled:false}],{env,fetcher:apiFetch})).status,'held');assert.equal(seen.length,0);assert.equal(settlement.length,0);
console.log('PASS: integrated 16-category estimated settlement, actual carrier versus shorter agent duration, inclusive EL receipt, disabled policy, zero ledger writes on binding mismatch');
for(const mutate of [()=>call.duration=null,()=>call.status='in-progress',()=>pricing.outbound_call_prices[0].current_price=null]){apiReset();settlement=[];mutate();const held=await settleBoundVoiceUsage(integrationDb,'account','call',[policy],{env,fetcher:apiFetch});assert.equal(held.reason,'carrier_usage_unavailable');assert.equal(settlement.length,0);}
apiReset();settlement=[];assert.equal((await settleBoundVoiceUsage(integrationDb,'account','call',[policy],{env,fetcher:async()=>Response.json({},{status:503})})).reason,'carrier_usage_unavailable');assert.equal(settlement.length,0);
apiReset();call.to='+12125559999';assert.equal((await settleBoundVoiceUsage(integrationDb,'account','call',[policy],{env,fetcher:apiFetch})).reason,'cost_evidence_incomplete');
console.log('PASS: transient carrier/pricing unavailability is retryable; identity/tariff-policy violations remain fail-closed review holds');

apiReset();const shared=structuredClone(apiRule);delete shared.accountId;shared.accountScope='operation_owner';assert.equal((await outboundCarrierInput(apiDb,'account',binding,shared,env,apiFetch)).kind,'fixed_estimate');
apiReset();call.end_time=new Date(Date.now()-86401000).toUTCString();await assert.rejects(outboundCarrierInput(apiDb,'account',binding,apiRule,env,apiFetch));assert.equal(priceReads,0);
console.log('PASS: explicit operation-owner shared policy scope; no current pricing lookup outside approved terminal-time window');

// Slow Pricing API response must never freeze evidence outside policy window.
apiReset();const shortWindow=structuredClone(apiRule);shortWindow.source.maxPricingLagSeconds=1;
const realNow=Date.now;const terminal=new Date().toISOString();call.end_time=terminal;
Date.now=()=>Date.parse(terminal);let beforeWrites=snapshotWrites;
try{
 await assert.rejects(outboundCarrierInput(apiDb,'account',binding,shortWindow,env,async(url,options)=>{
  if(url.startsWith('https://pricing.twilio.com/'))await new Promise(resolve=>setTimeout(resolve,1100));
  return apiFetch(url,options);
 }));
 assert.equal(snapshotWrites,beforeWrites);assert.equal(stored.length,0);
}finally{Date.now=realNow;}
console.log('PASS: request crossing pricing lag boundary inserts no immutable snapshot');
