import assert from 'node:assert/strict';
import {processDealJourneys} from '../lib/deal-journey-service.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {closingPayoutNote} from '../lib/closing-setup.ts';
import {titleEmailAddress} from '../lib/title-inbound-policy.ts';

// Actual service bodies with isolated database/provider boundaries. No live sends.
const env={VERCEL_ENV:'production',ICASH_LIVE_WORK_READY:'true',DOCUSEAL_MODE:'live'};
Object.assign(process.env,env,{RESEND_API_KEY:'fixture',RESEND_RECEIVING_WEBHOOK_SECRET:'fixture',ICASH_TITLE_FROM_EMAIL:'from@example.invalid',ICASH_TITLE_REPLY_EMAIL:'reply@example.invalid'});
const errors=[],originalError=console.error;
console.error=(...args)=>errors.push(args);
globalThis.fetch=async()=>{throw Error('NETWORK DISABLED');};
let cases=0;
try{
 const expectedTerms={assignee:'Fixture Buyer LLC',priceCents:9200000,assignmentFeeCents:1000000,assignmentDepositCents:200000,closingDate:'2026-12-04'};
 for(const snapshot of [expectedTerms,undefined,null,[],{}]){
  let state='ready',sends=0,texts=0;
  const result=await processDealJourneys({
   db:async(path,method,body)=>{
    if(path==='rpc/icash_due_journeys')return ['journey'];
    if(path==='rpc/icash_advance_journey')return null;
    if(path==='rpc/icash_claim_journey_assignment'){state='sending';return {id:'journey',accountId:'account',dealId:'deal',userId:'owner',customerEmail:'owner@example.invalid',signerName:'Buyer',email:'buyer@example.invalid',phone:'+12145550123',expectedTerms:snapshot};}
    if(method==='PATCH'){state=body.state;return [];}
    if(path.startsWith('icash_deal_journeys?'))return [{account_id:'account',deal_id:'deal',state}];
    if(path==='rpc/icash_journey_allowed')return false;
    if(path==='rpc/icash_claim_journey_message')return null;
    throw Error(path);
   },send:async input=>{sends++;assert.deepEqual(input.expectedTerms,expectedTerms,'Carry the exact claim snapshot into real signing validation');return {id:'envelope'};},
   text:async()=>{texts++;return {sent:true};},dispatch:async()=>{throw Error('No message claim');},title:async()=>{throw Error('No title permission');},
  },env);
  assert.equal(sends,snapshot===expectedTerms?1:0,'A missing/malformed snapshot cannot authorize a new assignment');
  assert.equal(texts,sends);assert.equal(result.failures,snapshot===expectedTerms?0:1);cases++;
 }

 // A no-op title result must not consume another property's one actual attempt.
 const noAttempt=['title_request_already_sent','title_request_already_held','verified_title_contact_required','title_automation_paused','title_configuration_required','live_work_not_ready'];
 const uncertain=['title_delivery_needs_reconciliation','unknown_status'];
 const prepared=['title_request_held','title_assignment_review_required','title_attachment_limit_review'];
 for(const first of [...noAttempt,...uncertain,...prepared,'title_request_sent','throw']){
  const titles=[];
  const result=await processDealJourneys({
   db:async(path,method,body)=>{
    if(path==='rpc/icash_due_journeys')return ['first','second'];
    if(path==='rpc/icash_advance_journey'||path==='rpc/icash_claim_journey_assignment'||path==='rpc/icash_claim_journey_message')return null;
    if(path==='rpc/icash_journey_allowed')return true;
    if(path.startsWith('icash_deal_journeys?'))return [{account_id:'account',deal_id:path.includes('id=eq.first')?'first':'second',state:'reserved'}];
    throw Error(path);
   },send:async()=>{throw Error('No assignment');},text:async()=>{throw Error('No assignment');},dispatch:async()=>{throw Error('No message');},
   title:async(a,d)=>{titles.push(d);if(first==='throw')throw Error('PRIVATE transport details');return {status:titles.length===1?first:'title_request_sent'};},
  },env);
  assert.deepEqual(titles,noAttempt.includes(first)?['first','second']:['first'],first);
  const failed=uncertain.includes(first)||first==='throw'||['title_assignment_review_required','title_attachment_limit_review','title_configuration_required','title_request_already_held','live_work_not_ready'].includes(first);
  assert.equal(result.failures,failed?1:0,first);cases++;
 }

 // A reply/customer action can cancel or finish the task while PDFs/provider I/O run.
 for(const point of ['pdf','provider'])for(const newerState of ['cancelled','dismissed','done','scheduled']){
  let email='issued',state='scheduled',sends=0;
  const db=async(path,method,data)=>{
   if(path==='rpc/icash_claim_title_update'){email='dispatching';return {requestId:'request',recipient:'closer@example.invalid',address:'Fixture'};}
   if(method==='PATCH'){
    const emailMatch=/email_state=eq\.([a-z_]+)/.exec(path),stateMatch=/(?:[?&])state=eq\.([a-z_]+)/.exec(path);
    if(emailMatch&&emailMatch[1]!==email||stateMatch&&stateMatch[1]!==state)return [];
    if(data.email_state)email=data.email_state;if(data.state)state=data.state;return [];
   }
   return [{id:'task',deal_id:'deal',state,email_state:email,payload:{type:'assignment',envelopeId:'signed'}}];
  };
  const {dispatchTitleUpdate}=await loadService('lib/title-update-service.ts',{db,closingPayoutNote,titleEmailAddress,completedSigningPdf:async()=>{if(point==='pdf'){state=newerState;throw Error('PRIVATE PDF details');}return new Uint8Array([1]).buffer;}});
  globalThis.fetch=async()=>{sends++;state=newerState;throw Error('PRIVATE provider details');};
  const result=await dispatchTitleUpdate('account','task');
  assert.equal(result.status,'title_followup_needs_reconciliation');
  assert.equal(email,'needs_review','Retain delivery uncertainty independently of task state');
  assert.equal(state,newerState==='scheduled'?'needs_review':newerState,`${point}: never resurrect ${newerState}`);
  await dispatchTitleUpdate('account','task');assert.equal(sends,point==='provider'?1:0,'Never replay uncertain delivery');cases++;
 }
 assert(!JSON.stringify(errors).includes('PRIVATE'));
}finally{console.error=originalError;}
console.log(`PASS ${cases} funnel handoff cases: frozen buyer terms, independent title progress, truthful failures and late cancellation preservation. Offline only.`);
