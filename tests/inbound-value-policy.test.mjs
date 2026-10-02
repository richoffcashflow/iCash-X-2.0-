import assert from 'node:assert/strict';
import {decideReturningSeller as decide,decideCallProgress} from '../lib/inbound-value-policy.ts';
import {costCategories} from '../lib/cost-guard.ts';
const now=Date.now(),account='11111111-1111-4111-8111-111111111111',screening='22222222-2222-4222-8222-222222222222',deal='33333333-3333-4333-8333-333333333333',rate='44444444-4444-4444-8444-444444444444';
function candidate(){return {account_id:account,screening_id:screening,deal_id:deal,party:'seller',deal:{id:deal,account_id:account,screening_id:screening,stage:'draft',terms:{priceCents:9000000}},screening:{id:screening,account_id:account,state:'complete',completed_at:new Date(now).toISOString(),snapshot:{propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:100000,raw:{data:{dm_property_id:'prop_123',full_address:'Fixture only',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}}}},account:{id:account,bot_paused:false,daily_limit_cents:100},wallet:{account_id:account,balance_cents:100,reserved_cents:20},usage_24h_cents:30,budget_read_at:now,manual:false,suppressed:false,rate:{id:rate,operation:'incoming_call',enabled:true,charge_cents:50,verified_at:new Date(now-60000).toISOString(),expires_at:new Date(now+60000).toISOString(),voice_max_duration_seconds:60,costs_micros:Object.fromEntries(costCategories.map(k=>[k,100])),buffer_bps:1000}};}
function run(c=candidate(),extra={}){return decide({matches:[c],matchesComplete:true,verifiedIngressAccountId:account,now,maxSeconds:60,...extra});}
assert.equal(run().action,'reserve_customer_call');assert.equal(run().customerChargeAuthorized,false);assert.equal(run().storedFactsDisclosureAuthorized,false);assert.equal(run().outboundAuthorized,false);
assert.deepEqual(run().binding,{accountId:account,screeningId:screening,dealId:deal,rateId:rate});
assert.equal(run(undefined,{matches:[]}).action,'identify_without_customer_charge');
assert.equal(run(undefined,{matchesComplete:false}).action,'identify_without_customer_charge');
assert.equal(run(undefined,{matches:[candidate(),candidate()]}).reason,'ambiguous_property_or_account');
assert.equal(run(undefined,{verifiedIngressAccountId:null}).reason,'verified_called_number_account_required');
for(const change of [c=>c.account.bot_paused=true,c=>c.manual=true,c=>c.suppressed=true,c=>c.wallet.balance_cents=69,c=>c.account.daily_limit_cents=99,c=>c.budget_read_at=now-30001,c=>c.rate=null,c=>c.rate.operation='seller_call',c=>c.rate.costs_micros.twilio=null,c=>c.rate.expires_at=new Date(now-1).toISOString(),c=>c.rate.voice_max_duration_seconds=59]){const c=candidate();change(c);assert.equal(run(c).action,'reject_paid_call');}
for(const change of [c=>c.screening.snapshot.fetchedAt=new Date(now-86400001).toISOString(),c=>c.screening.completed_at=null,c=>c.screening.state='running',c=>c.screening.snapshot.raw.data.total_estimated_loan_balance=null,c=>delete c.screening.snapshot.sellerCostReserveCents,c=>c.screening.snapshot.propertyType='land',c=>c.screening.snapshot.raw.data.has_active_lien=true,c=>c.deal.terms.practice=true,c=>c.deal.stage='closed',c=>c.deal.account_id=deal]){const c=candidate();change(c);assert.equal(run(c).action,'identify_without_customer_charge');}
const bad=candidate();bad.screening.snapshot.raw.data.total_estimated_loan_balance=100000;assert.equal(run(bad).action,'reject_paid_call');assert.equal(run(bad).reason,'fresh_numbers_do_not_support_paid_qualification');
const signing=candidate();signing.envelope={account_id:account,deal_id:deal,kind:'purchase',state:'awaiting_counterparty',test_mode:false,provider_id:'fixture-provider-document',terms:structuredClone(signing.deal.terms)};assert.equal(run(signing).action,'reserve_customer_call');assert.equal(run(signing).priority,'signing_or_active_deal');
const changedTerms=structuredClone(signing);changedTerms.envelope.terms.priceCents=100;assert.equal(run(changedTerms).priority,'qualification');
const testEnvelope=structuredClone(signing);testEnvelope.envelope.test_mode=true;assert.equal(run(testEnvelope).priority,'qualification');
const badSigning=structuredClone(signing);badSigning.screening.snapshot.raw.data.total_estimated_loan_balance=100000;assert.equal(run(badSigning).action,'identify_without_customer_charge');
const staleSigning=structuredClone(signing);staleSigning.screening.snapshot.fetchedAt=new Date(now-86400001).toISOString();assert.equal(run(staleSigning).action,'identify_without_customer_charge');
const unfundedSigning=structuredClone(signing);unfundedSigning.wallet.balance_cents=0;assert.equal(run(unfundedSigning).action,'reject_paid_call');
for(const stage of ['under_contract','buyer_selected','title_open','closing']){const c=candidate();c.deal.stage=stage;assert.equal(run(c).priority,'signing_or_active_deal');}
const goodAndBad=[candidate(),bad];assert.equal(run(undefined,{matches:goodAndBad}).action,'identify_without_customer_charge','Do not filter bad/poor candidates before uniqueness');
const signals={elapsedSeconds:15,maxSeconds:60,callerAskedToStop:false,optedOut:false,explicitlyNotReady:false,legitimateQuestionPending:false,newPropertyOrTermsInformation:false,nextStepProgress:false,readinessClarificationGiven:false,repeatedOffTopicAfterRedirect:false,repeatingAnsweredQuestionWithoutNewIssue:false};
const progress=(extra={})=>decideCallProgress({...signals,...extra});
assert.equal(progress({legitimateQuestionPending:true}).action,'answer_briefly');
assert.equal(progress({legitimateQuestionPending:true,readinessClarificationGiven:true,repeatingAnsweredQuestionWithoutNewIssue:true}).action,'answer_briefly','Genuine new issue is not time wasting');
assert.equal(progress({newPropertyOrTermsInformation:true}).action,'continue');
assert.equal(progress({nextStepProgress:true}).action,'continue');
assert.equal(progress({repeatedOffTopicAfterRedirect:true}).action,'clarify_readiness');
assert.equal(progress({repeatedOffTopicAfterRedirect:true,readinessClarificationGiven:true}).action,'end');
assert.equal(progress({repeatingAnsweredQuestionWithoutNewIssue:true,readinessClarificationGiven:true}).action,'end');
for(const extra of [{optedOut:true},{callerAskedToStop:true},{explicitlyNotReady:true},{elapsedSeconds:55},{elapsedSeconds:-1}]){assert.equal(progress(extra).action,'end');assert.equal(progress(extra).outboundAuthorized,false);}
assert(!JSON.stringify(progress({repeatedOffTopicAfterRedirect:true,readinessClarificationGiven:true})).includes('callback'));
console.log('Inbound value policy: unique verified ingress, existing customer budget, fresh numbers, signing priority, ambiguity, legitimate questions, nonprogress cutoff and no outbound authority passed');
