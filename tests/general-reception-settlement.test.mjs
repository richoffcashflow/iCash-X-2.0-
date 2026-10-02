import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {receptionTarget, receptionProfiles} from '../lib/general-reception.ts';
import {receptionCostAttestation, settleReviewedReception} from '../lib/general-reception-settlement.ts';
import {reconcileReception} from '../lib/general-reception-reconcile.ts';
const profile=receptionProfiles.owner_quick_test;
const accountSid='AC'+'a'.repeat(32),callSid='CA'+'b'.repeat(32),nonce='c'.repeat(64),from='+15555550199';
const env={TWILIO_ACCOUNT_SID:accountSid,TWILIO_AUTH_TOKEN:'test-token-not-real-123456789',ELEVENLABS_API_KEY:'test-only'};
const receipt={receipt_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',account_id:receptionTarget.accountId,call_sid:callSid,operation_key:'reception:'+callSid,receipt_nonce:nonce,config_hash:'d'.repeat(64),agent_id:receptionTarget.agentId,branch_id:'agtbrch_test',reviewed_version_id:'agtvrsn_test',call_profile:'owner_quick_test',rate_id:profile.rateId,max_duration_seconds:60,customer_charge_cap_cents:65,reserved_at:'2026-10-02T19:51:05.000Z',caller_hash:createHmac('sha256',env.TWILIO_AUTH_TOKEN).update('reception-caller-v1\0'+from).digest('hex')};
const costs={twilioUsdMicros:8500,elevenLabsUsdMicros:29000,twilioReceiptHash:'e'.repeat(64),elevenLabsReceiptHash:'f'.repeat(64)};
const attestation=receptionCostAttestation(receipt,'conv_test',30,costs);
assert.equal(attestation.binding.receiptId,receipt.receipt_id);assert.equal(attestation.binding.receiptNonce,nonce);assert.equal(attestation.binding.customerChargeCapCents,65);assert.equal(attestation.providers.twilio.amountMicros,8500);
for(const key of ['twilioUsdMicros','elevenLabsUsdMicros'])for(const v of [undefined,null,-1,1.2,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,'0'])assert.equal(receptionCostAttestation(receipt,'conv_test',30,{...costs,[key]:v}),null);
assert.equal(receptionCostAttestation({...receipt,customer_charge_cap_cents:66},'conv_test',30,costs),null);
assert.equal(receptionCostAttestation(receipt,'conv_test',63,costs),null);
const signal=AbortSignal.timeout(10000),success={settled:true,chargedCents:14,costBasis:'verified',providerMarginVerified:true};
const run=async(result,c=costs)=>{const calls=[];const value=await settleReviewedReception(receipt,'conv_test',30,c,{rpc:async(name,args)=>{calls.push({name,args});if(result instanceof Error)throw result;return result;}},signal);return {value,calls};};
const happy=await run(success);assert.equal(happy.value.settled,true);assert.equal(happy.value.allInCostVerified,true);assert.deepEqual(happy.calls,[{name:'icash_settle_general_reception',args:{p_operation:receipt.operation_key,p_attestation:attestation}}]);
const unknown=await run(success,{...costs,twilioUsdMicros:null});assert.equal(unknown.calls.length,0);assert.equal(unknown.value.settled,false);
assert.equal((await run({settled:false,reason:'cost_review_required'})).value.settlementReason,'cost_review_required');
assert.equal((await run({settled:false,reason:'secret-not-allowed'})).value.settlementReason,'settlement_held');
assert.equal((await run(new Error('private-token'))).value.settled,null);
for(const result of [{...success,chargedCents:66},{...success,chargedCents:-1},{...success,costBasis:'unknown'}])assert.equal((await run(result)).value.settlementReason,'settlement_status_unconfirmed');
const estimated=await run({...success,costBasis:'estimated'});assert.equal(estimated.value.allInCostVerified,false);assert.equal(estimated.value.providerMarginVerified,false);
async function fixture(result=success,change=()=>{}){
 const conversation={conversation_id:'conv_test',agent_id:receipt.agent_id,branch_id:receipt.branch_id,version_id:receipt.reviewed_version_id,user_id:'icash-reception:'+nonce,status:'done',conversation_initiation_client_data:{user_id:'icash-reception:'+nonce,branch_id:receipt.branch_id,dynamic_variables:{icash_reception_lane:'general-v1',icash_reception_call_sid:callSid,icash_reception_receipt_nonce:nonce}},metadata:{cost_fiat:0.029,call_duration_secs:30,phone_call:{call_sid:callSid}},transcript:[]};
 const carrier={sid:callSid,account_sid:accountSid,to:receptionTarget.calledNumber,from,direction:'inbound',status:'completed',date_created:'2026-10-02T19:51:00.000Z',price:'-0.0085',price_unit:'USD'};
 change({conversation,carrier});const calls=[];
 const answer=await reconcileReception(env,{rpc:async(name,args)=>{calls.push({name,args});if(name==='icash_latest_general_reception_receipt')return receipt;if(name==='icash_get_general_reception_settlement')return null;if(name==='icash_finish_general_reception')return {...receipt,state:'completed',conversation_id:'conv_test'};if(name==='icash_settle_general_reception'){if(result instanceof Error)throw result;return result;}throw Error(name);},fetcher:async url=>Response.json(url.includes('/conversations?')?{has_more:false,conversations:[{conversation_id:'conv_test'}]}:url.includes('api.twilio.com')?carrier:conversation)});
 return {answer,calls};
}
const integrated=await fixture();assert.equal(integrated.answer.settled,true);assert.equal(integrated.answer.chargedCents,14);assert.equal(integrated.answer.providerMarginVerified,true);assert.deepEqual(integrated.calls.map(x=>x.name),['icash_latest_general_reception_receipt','icash_get_general_reception_settlement','icash_finish_general_reception','icash_settle_general_reception']);
const unresolved=await fixture({settled:false,reason:'cost_review_required'});assert.equal(unresolved.answer.settled,false);assert.match(unresolved.answer.message,/did not settle/);
const ambiguous=await fixture(new Error('network failure'));assert.equal(ambiguous.answer.settled,null);assert.match(ambiguous.answer.message,/unconfirmed/);assert(!ambiguous.answer.message.includes('remains held'));
const missing=await fixture(success,s=>delete s.conversation.metadata.cost_fiat);assert.equal(missing.answer.settled,false);assert(!missing.calls.some(x=>x.name==='icash_settle_general_reception'));
const foreign=await fixture(success,s=>s.conversation.branch_id='agtbrch_foreign');assert.equal(foreign.answer.status,'held');assert.equal(foreign.calls.length,2);
for(const secret of [nonce,callSid,from,env.TWILIO_AUTH_TOKEN,env.ELEVENLABS_API_KEY])assert(!JSON.stringify(integrated.answer).includes(secret));
console.log('Reception settlement: receipt-bound full pipeline, unknown costs held, no client price/approval, sanitized results and ambiguous writes not claimed passed');

const recoveredCalls=[];const recovered=await reconcileReception(env,{rpc:async(name)=>{recoveredCalls.push(name);return name==='icash_latest_general_reception_receipt'?receipt:success;},fetcher:async()=>{throw Error('Must not refetch a settled receipt');}});assert.equal(recovered.settled,true);assert.equal(recovered.chargedCents,14);assert.equal(recoveredCalls.length,2);assert.match(recovered.message,/previously reviewed/);

for(const result of [null,{},[],{settled:null},{settled:'true'}])assert.equal((await run(result)).value.settled,null);
// Execute the actual UI handler, without rendering or making network requests.
const {readFileSync}=await import('node:fs');
const ui=readFileSync(new URL('../app/owner-reception/reception-setup.tsx',import.meta.url),'utf8');
const handler=ui.slice(ui.indexOf(' async function reconcile()'),ui.indexOf(' async function inspectCarrier()'));
async function uiText(data){let output;const action=new Function('fetch','running','setBusy','setReceipt','setCallerRestriction','return '+handler.trim())(async()=>Response.json(data),{current:false},()=>{},v=>{output=v;},()=>{});await action();return output;}
const baseCosts={currency:'USD',twilioUsdMicros:8500,elevenLabsUsdMicros:29000};
const successText=await uiText({...success,message:'Settlement verified.',costEvidence:baseCosts});assert.match(successText,/Confirmed customer charge: \$0.14/);assert(!successText.includes('remains held'));
const unknownText=await uiText({settled:null,message:'Settlement status is unconfirmed.',costEvidence:baseCosts});assert.match(unknownText,/unconfirmed/);assert(!unknownText.includes('remains held'));assert(!unknownText.includes('Confirmed customer charge'));
assert.match(await uiText({...success,costBasis:'estimated',costEvidence:baseCosts}),/Some reviewed costs are estimates/);

assert(ui.includes('Check receipt and settle approved usage'));assert(ui.includes('this action can charge the reviewed usage within its original cap'));

const recoveredWithoutProviders=await reconcileReception({}, {rpc:async(name)=>name==='icash_latest_general_reception_receipt'?receipt:success,fetcher:async()=>{throw Error('No provider access for recorded settlement');}});assert.equal(recoveredWithoutProviders.settled,true);

const preciseIntegrated=await fixture(success,s=>s.conversation.metadata.cost_fiat=0.029000000000000005);assert.equal(preciseIntegrated.answer.settled,true);assert.equal(preciseIntegrated.calls.find(x=>x.name==='icash_settle_general_reception').args.p_attestation.providers.elevenlabs.amountMicros,29000);
const pendingCarrier=await fixture(success,s=>{s.carrier.price=null;s.conversation.metadata.cost_fiat=0.029000000000000005;});assert.equal(pendingCarrier.answer.settled,false);assert(!pendingCarrier.calls.some(x=>x.name==='icash_settle_general_reception'));
