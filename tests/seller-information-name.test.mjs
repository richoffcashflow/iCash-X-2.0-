import assert from 'node:assert/strict';
import {sellerIdentityInterruption,sellerInformationQuestion,sellerPropertyAnswer} from '../lib/seller-answer-evidence.ts';
import {sellerAgreementIdentityEvidence} from '../lib/seller-agreement-identity.ts';
import {sellerDialogueState} from '../lib/seller-offer-qualification.ts';
import {planSellerTextOffer} from '../lib/seller-text-offer.ts';
import {processSellerTextOffer} from '../lib/seller-text-offer-service.ts';

globalThis.fetch=async()=>{throw Error('Offline seller identity replay only');};
const now=Date.parse('2026-11-17T06:00:00Z');
const agent=message=>({role:'agent',message}),user=message=>({role:'user',message});
let id=0;
const incoming=body=>({id:'in-'+(++id),direction:'incoming',state:'received',body,providerId:null});
const outgoing=(body,action,extra={})=>({id:'out-'+(++id),direction:'outgoing',state:'delivered',providerId:'fixture-receipt',body,action,...extra});
const nameQuestion='What is your full legal name for the purchase agreement?';
const qualified=[
 ['Are you the owner of this property?','Yes'],['Are you looking to sell?','Yes'],
 ['What has you thinking about selling?','I am moving'],['What repairs does it need?','It needs paint'],
 ['Is anyone living there?','It is vacant'],['When would you like to sell?','Next month'],
 ['Is it listed with a real estate agent?','No'],
].flatMap(([question,answer])=>[outgoing(question,'qualification'),incoming(answer)]);
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:'45 Fixture Road',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:20000,estimated_equity_percentage:90}}};
const state={textThreadId:'fixture-thread',acceptedPriceCents:9000000,quotedPriceCents:9000000,closing:{date:'2027-01-15',inspection:'yes'}};
const base={accountId:'fixture-account',jobId:'fixture-job',threadId:'fixture-thread',dealId:'fixture-deal',screeningId:'fixture-screen',phone:'+15550000001',ownerUserId:'fixture-owner',ownerEmail:'fixture@example.invalid',principal:'Fixture Buyer',address:'45 Fixture Road',snapshot,terms:{seller:'',buyer:'Fixture Buyer',address:'45 Fixture Road',legalDescription:'Lot 1, Fixture Subdivision',state:'TX',priceCents:9000000,priceSource:'proposed'},offerState:state,offerVersion:3,fingerprint:'fixture-source',conversionEnabled:true};
const context=messages=>({...base,messages,sourceId:messages.at(-1).id});
const cases=[
 ['how does this work','process'],['How will it work','process'],['what happens next','process'],
 ['who pays closing costs','costs'],['Who pays the closing costs','costs'],['any fees','costs'],
 ['what about fees','costs'],['are there any fees','costs'],['what are the fees','costs'],
];
for(const [body,kind] of cases){
 for(const text of [body,body+'?',body+'.',body.toUpperCase(),body.replaceAll(' ','  ')]){
  assert.equal(sellerInformationQuestion(text),kind);
  assert(sellerIdentityInterruption(text),'the missing question mark cannot make a name: '+text);
  assert.equal(sellerAgreementIdentityEvidence({transcript:[agent(nameQuestion),user(text)]},text).legalNameConfirmed,false,'voice cannot verify the question as the name');
  const prior=[agent(nameQuestion),user('Jane Seller'),agent(nameQuestion),user(text)];
  assert.equal(sellerAgreementIdentityEvidence({transcript:prior},'Jane Seller').legalNameConfirmed,true,'keep an earlier real name');
  assert.equal(sellerAgreementIdentityEvidence({transcript:[...prior,user('Actually, I am June Buyer.')]},'Jane Seller').legalNameConfirmed,false,'a later genuine correction still invalidates the old name');
  for(const fact of ['condition','occupancy','timing','situation'])assert.equal(sellerPropertyAnswer(fact,text),false,'an informational question does not answer '+fact);
  const c=context([...qualified,outgoing(nameQuestion,'legal_name'),incoming(text)]),before=structuredClone(c);
  const plan=planSellerTextOffer(c,now);
  assert.equal(plan.action,'explain_'+kind);assert.equal(plan.kind,'message');
  assert.equal(plan.state.closing.legalName,undefined,'do not save the question as the legal name');
  assert.equal(plan.state.acceptedPriceCents,state.acceptedPriceCents);assert.equal(plan.state.closing.date,state.closing.date);assert.equal(plan.state.closing.inspection,'yes');
  assert.deepEqual(c,before,'retain all original source messages');
  const retained=planSellerTextOffer({...c,offerState:{...state,closing:{...state.closing,legalName:'Jane Seller'}}},now);
  assert.equal(retained.state.closing.legalName,'Jane Seller','do not erase an already saved name');
  const remembered=planSellerTextOffer({...c,history:[{transcript:prior}]},now);
  assert.equal(remembered.state.closing.legalName,'Jane Seller','call-memory projection must preserve the real answer');
 }
 // The actual service saves the supported informational reply without a false
 // name; a changed original context cannot dispatch, and no agreement is sent.
 const c=context([...qualified,outgoing(nameQuestion,'legal_name'),incoming(body)]);
 for(const current of [true,false]){
  let saved,dispatches=0;
  const result=await processSellerTextOffer(c,{
   now:()=>now,db:async(path,method,payload)=>{
    if(path==='rpc/icash_seller_memory_context')return null;
    if(path==='rpc/icash_seller_prior_call_context')return [];
    assert.equal(path,'rpc/icash_save_seller_text_offer');saved=payload;
    return current?{messageId:'fixture-message'}:null;
   },dispatch:async(account,message)=>{assert.equal(account,c.accountId);assert.equal(message,'fixture-message');dispatches++;return {status:'fixture-dispatched'};},
   send:async()=>{throw Error('Question is not agreement authority');},text:async()=>{throw Error('Question is not agreement delivery authority');},
  });
  assert.equal(saved.p_plan.action,'explain_'+kind);assert.equal(saved.p_plan.state.closing.legalName,undefined);
  assert.equal(saved.p_account,c.accountId);assert.equal(saved.p_job,c.jobId);assert.equal(saved.p_fingerprint,c.fingerprint);assert.equal(saved.p_version,c.offerVersion);
  assert.equal(dispatches,current?1:0);assert.equal(result.status,current?'fixture-dispatched':'text_ai_context_changed');
 }
 const explained=planSellerTextOffer(c,now);
 const resumed=context([...c.messages,outgoing(explained.body,explained.action),incoming('Okay')]);
 const next=planSellerTextOffer({...resumed,offerState:explained.state},now);
 assert.equal(next.action,'legal_name','resume only the missing name after explaining');assert.equal(next.state.closing.legalName,undefined);assert.notEqual(next.kind,'agreement');
 const named=context([...resumed.messages,outgoing(next.body,next.action),incoming('Jane Seller')]);
 const genuine=planSellerTextOffer({...named,offerState:next.state},now);
 assert.equal(genuine.action,'owners');assert.equal(genuine.state.closing.legalName,'Jane Seller');assert.equal(genuine.state.acceptedPriceCents,state.acceptedPriceCents);
}
const missingTiming=sellerDialogueState({transcript:[agent('When would you like to sell?'),user('what happens next')]},[],'sms');
assert(!missingTiming.facts.timing,'next in a process question is not a selling timeline');
for(const name of ['May I Help','May Price','Will Work','Anne Fees','Howell Price','James Next','Who Pays Closing Costs']){
 const answer=name==='Who Pays Closing Costs'?'My full legal name is '+name:name;
 assert.equal(sellerIdentityInterruption(answer),false,'do not reject genuine names by isolated question words');
 const c=context([...qualified,outgoing(nameQuestion,'legal_name'),incoming(answer)]);
 const plan=planSellerTextOffer(c,now);assert.equal(plan.action,'owners');assert.equal(plan.state.closing.legalName,name);
 assert.equal(sellerAgreementIdentityEvidence({transcript:[agent(nameQuestion),user(answer)]},name).legalNameConfirmed,true);
}
for(const body of ['Why this price','How is the offer calculated','Why is the offer so low?'])assert.equal(planSellerTextOffer(context([incoming(body)]),now).action,'explain_cash_price','retain real price explanations');
for(const body of ['Who pays closing costs? My wife is also an owner.','What happens next? STOP.','The buyer asked how does this work','How does this work if I change the price','My name is Jane Seller. How does this work'])assert.equal(sellerInformationQuestion(body),null,'mixed/reported sources must not become pure informational answers');
for(const body of ['STOP. Who pays closing costs','Not interested. What happens next'])assert.equal(planSellerTextOffer(context([incoming(body)]),now).kind,'review','refusal wins');
console.log('PASS seller informational-name repair: punctuation-free cost/process questions are answered without false identity/property evidence; prior real name/price/date, follow-up qualification, actual save/dispatch boundary and genuine names preserved. No providers.');
