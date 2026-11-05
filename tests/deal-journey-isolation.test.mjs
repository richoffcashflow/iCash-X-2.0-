import assert from 'node:assert/strict';
import {processDealJourneys} from '../lib/deal-journey-service.ts';
import {authorizeOutboundBilling} from '../lib/outbound-billing-service.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
globalThis.fetch=async()=>{throw Error('NETWORK DISABLED');};
const env={VERCEL_ENV:'production',ICASH_LIVE_WORK_READY:'true',DOCUSEAL_MODE:'live'};
const logs=[],originalError=console.error;console.error=(...args)=>logs.push(args);
function fixture({selectionFails=false,advanceFails=false,claimFails=false,duplicate=false,statuses=['throw','message_accepted'],assignment=false,lateState=null,titleDenied=false}={}){
 let claims=0,sends=0,texts=0,state='ready';const dispatched=[],titles=[],patches=[];
 const d={db:async(path,method,body)=>{
  if(path==='rpc/icash_due_journeys'){if(selectionFails)throw Error('PRIVATE database detail');return ['first','second'];}
  if(path==='rpc/icash_advance_journey'){if(advanceFails&&body.p_id==='first')throw Error('PRIVATE property detail');return null;}
  if(path==='rpc/icash_claim_journey_assignment'){
   if(!assignment||body.p_id!=='first'||state!=='ready')return null;state='sending';
   return {id:'first',accountId:'account',dealId:'deal',userId:'user',customerEmail:'user@example.invalid',signerName:'Buyer',email:'buyer@example.invalid',phone:'+12145550123',expectedTerms:{assignee:'Buyer',priceCents:9200000}};
  }
  if(path.startsWith('icash_deal_journeys?')&&method==='PATCH'){
   patches.push({path,body});
   const allowed=path.includes('state=in.(sending,signing)')?['sending','signing']:path.includes('state=eq.sending')?['sending']:null;
   if(!allowed||allowed.includes(state))state=body.state;return [];
  }
  if(path.startsWith('icash_deal_journeys?'))return [{account_id:'account',deal_id:path.includes('id=eq.first')?'first':'second',state:assignment?state:'reserved'}];
  if(path==='rpc/icash_journey_allowed')return !(titleDenied&&body.p_deal==='first');
  if(path==='rpc/icash_claim_journey_message'){
   claims++;if(claimFails)throw Error('PRIVATE uncertain claim detail');
   return claims<=2?{accountId:'account',messageId:duplicate?'message-1':`message-${claims}`}:null;
  }
  throw Error(path);
 },send:async()=>{sends++;if(lateState){state=lateState;throw Error('PRIVATE uncertain signing result');}return {id:'envelope'};},
 text:async()=>{texts++;return {sent:true};},
 dispatch:async(a,m)=>{dispatched.push(m);const status=statuses[dispatched.length-1];if(status==='throw')throw Error('PRIVATE uncertain provider result');return {status};},
 title:async(a,d)=>{titles.push(d);return {status:'title_request_already_sent'};}};
 return {d,stats:()=>({claims,sends,texts,state,dispatched,titles,patches})};
}
try{
 // A failed dispatch keeps its existing hold; the second fresh claim is independent.
 const f=fixture(),r=await processDealJourneys(f.d,env);
 assert.deepEqual(f.stats().dispatched,['message-1','message-2']);
 assert.equal(r.status,'journey_processing_needs_review');assert.equal(r.messages,1);assert.equal(r.messageAttempts,2);assert.equal(r.failures,1);
 for(const option of ['selectionFails','advanceFails']){
  const f=fixture({[option]:true,statuses:['message_accepted','message_accepted']}),r=await processDealJourneys(f.d,env);
  assert.equal(r.status,'journey_processing_needs_review');assert.equal(r.messages,2,option);assert.equal(f.stats().dispatched.length,2);
 }
 const claim=fixture({claimFails:true});assert.equal((await processDealJourneys(claim.d,env)).messages,0);assert.equal(claim.stats().claims,1,'Do not repeat an uncertain claim');
 const dupe=fixture({duplicate:true});await processDealJourneys(dupe.d,env);assert.deepEqual(dupe.stats().dispatched,['message-1'],'Never dispatch an uncertain duplicate');
 const held=fixture({statuses:['message_held','message_delivery_needs_review']}),heldResult=await processDealJourneys(held.d,env);
 assert.equal(heldResult.messages,0,'Held work is not completed work');assert.equal(heldResult.heldMessages,2);assert.equal(heldResult.failures,1);
 const denied=fixture({titleDenied:true,statuses:['message_accepted','message_delivered']});await processDealJourneys(denied.d,env);assert.deepEqual(denied.stats().titles,['second'],'A denied property cannot consume another eligible property’s title slot');
 for(const state of ['closed','cancelled','reserved','deposit_due']){
  const f=fixture({assignment:true,lateState:state,statuses:['message_accepted','message_accepted']});await processDealJourneys(f.d,env);
  assert.equal(f.stats().state,state,'Late provider failure cannot overwrite newer state: '+state);assert.equal(f.stats().sends,1);assert.equal(f.stats().texts,0);
 }
 assert(!JSON.stringify(logs).includes('PRIVATE'),'Only fixed diagnostic stage names are logged');
 // Exercise the deployed cron route using the real service and authentication.
 process.env.CRON_SECRET='offline-fixture-'.repeat(4);Object.assign(process.env,env);
 for(const ownerFails of [false,true]){
  const f=fixture({statuses:ownerFails?['message_accepted','message_accepted']:['throw','message_accepted']});
  let ownerCalls=0;
  const {GET}=await loadService('app/api/internal/journeys/route.ts',{
   db:f.d.db,authorizeOutboundBilling,processDealJourneys,
   sendForSignatures:f.d.send,textPendingContract:f.d.text,dispatchTextMessage:f.d.dispatch,coordinateTitleOpening:f.d.title,
   processOwnerBuyerDelivery:async()=>{ownerCalls++;if(ownerFails)throw Error('PRIVATE owner delivery detail');return {status:'owner_delivery_idle'};},
  });
  const url='https://offline.invalid/api/internal/journeys';
  assert.equal((await GET(new Request(url))).status,401);assert.equal(ownerCalls,0);
  const response=await GET(new Request(url,{headers:{authorization:`Bearer ${process.env.CRON_SECRET}`}}));
  assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
  const body=await response.json();assert.equal(body.messages,ownerFails?2:1);
  assert.deepEqual(f.stats().dispatched,['message-1','message-2']);
  assert.equal(body.ownerDelivery.status,ownerFails?'owner_delivery_needs_review':'owner_delivery_idle');
 }
}finally{console.error=originalError;}
console.log('PASS journey failure isolation, independent fresh claims, unknown-send protection, truthful completion counts, title fairness and late-state preservation. No network calls.');
