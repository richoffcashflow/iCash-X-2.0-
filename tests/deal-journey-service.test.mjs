import assert from 'node:assert/strict';
import {processDealJourneys} from '../lib/deal-journey-service.ts';
globalThis.fetch=async()=>{throw Error('NETWORK DISABLED');};
const env={VERCEL_ENV:'production',ICASH_LIVE_WORK_READY:'true',DOCUSEAL_MODE:'live'};
function fixture(fail=false){
 let state='ready',sends=0,texts=0,messages=0,titles=0;
 const calls=[];
 const d={db:async(path,method,body)=>{
  calls.push(path);
  if(path==='rpc/icash_due_journeys')return ['fixture'];
  if(path==='rpc/icash_advance_journey')return null;
  if(path==='rpc/icash_claim_journey_assignment'){if(state!=='ready')return null;state='sending';return {id:'fixture',accountId:'account',dealId:'deal',userId:'owner',customerEmail:'owner@example.invalid',signerName:'Buyer',email:'buyer@example.invalid',phone:'+12145550123'};}
  if(path.startsWith('icash_deal_journeys?')&&method==='PATCH'){state=body.state;return [];}
  if(path.startsWith('icash_deal_journeys?'))return [{account_id:'account',deal_id:'deal',state}];
  if(path==='rpc/icash_journey_allowed')return true;
  if(path==='rpc/icash_claim_journey_message')return messages<1?{accountId:'account',messageId:'message'}:null;
  throw Error(path);
 },send:async input=>{sends++;assert.equal(input.kind,'assignment');assert.equal(input.phoneLinkOnly,true);assert(!Object.hasOwn(input,'autoSignature'));if(fail)throw Error('Unknown provider outcome');return {id:'envelope'};},
 text:async()=>{texts++;return {sent:true};},dispatch:async()=>{messages++;return {status:'message_accepted'};},title:async()=>{titles++;return {status:'title_request_already_sent'};}};
 return {d,calls,stats:()=>({state,sends,texts,messages,titles})};
}
const off=fixture();assert.equal((await processDealJourneys(off.d,{...env,VERCEL_ENV:'preview'})).status,'journey_held');assert.equal(off.calls.length,0);
assert.equal((await processDealJourneys(off.d,{...env,DOCUSEAL_MODE:'test'})).status,'journey_held');assert.equal(off.calls.length,0);
const good=fixture();await processDealJourneys(good.d,env);await processDealJourneys(good.d,env);assert.equal(good.stats().sends,1);assert.equal(good.stats().texts,1);assert.equal(good.stats().messages,1);assert.equal(good.stats().state,'signing');
const unknown=fixture(true);await processDealJourneys(unknown.d,env);await processDealJourneys(unknown.d,env);assert.equal(unknown.stats().sends,1);assert.equal(unknown.stats().texts,0);assert.equal(unknown.stats().state,'needs_review');
console.log('PASS journey transport: preview/test disabled, assignment once, no owner auto-sign, bounded texts, uncertain sends not retried. Zero network calls.');
