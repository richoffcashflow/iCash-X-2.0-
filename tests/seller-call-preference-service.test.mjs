import assert from 'node:assert/strict';
import {processSellerTextOffer} from '../lib/seller-text-offer-service.ts';
import {sellerCallInvitation} from '../lib/seller-call-preference.ts';
globalThis.fetch=async()=>{throw Error('NO NETWORK: service dependency fixtures only');};
let sequence=0,checks=0;
const incoming=body=>({id:String(++sequence),direction:'incoming',state:'received',providerId:null,body});
const outgoing=(body,action)=>({id:String(++sequence),direction:'outgoing',state:'delivered',providerId:'fixture-'+sequence,body,action});
const messages=[outgoing('Do you own this property?'),incoming('Yes'),outgoing('Are you looking to sell?'),incoming('Yes'),outgoing(sellerCallInvitation,'invite_call'),incoming('Text only for now'),outgoing('What has you thinking about selling?','qualify_situation'),incoming('I am moving'),incoming('This is hard to explain by text')];
const source=messages.at(-1);
const context={accountId:'fixture-account',jobId:'fixture-job',threadId:'fixture-thread',sourceId:source.id,dealId:'fixture-deal',screeningId:'fixture-screen',phone:'+12125550123',ownerUserId:'fixture-owner',ownerEmail:'fixture@example.invalid',principal:'Fixture Homes',address:'123 Example Road',snapshot:{},terms:{},offerState:null,offerVersion:0,messages,fingerprint:'fixture-source',callInvitationAllowed:true,voicePermissionCurrent:true,oneCallAllowed:true};
async function run(options={}){
 const {enabled=true,conversation=null,extra={},save={messageId:'fixture-text'}}=options;
 const capable=Object.hasOwn(options,'capable')?options.capable:true;
 let saved,dispatches=0;const reads=[];
 const result=await processSellerTextOffer({...context,...extra},{
  db:async(path,method,args)=>{
   reads.push(path);
   if(path==='rpc/icash_seller_prior_call_context')return [];
   if(path==='rpc/icash_outreach_voice_current'){
    assert.deepEqual(args,{p_account:context.accountId});
    if(enabled==='error')throw Error('account voice read failed');return enabled;
   }
   if(path==='rpc/icash_seller_conversation_context'){
    assert.deepEqual(args,{p_account:context.accountId,p_thread:context.threadId});return conversation;
   }
   if(path==='rpc/icash_seller_call_invitation_capable'){
    assert.deepEqual(args,{p_account:context.accountId,p_thread:context.threadId,p_message:context.sourceId});
    if(capable==='error')throw Error('capability unavailable or migration not installed');return capable;
   }
   // Global voice is intentionally false: a preference question must not call
   // this global predicate, mutate it, or interpret invitation capability as dial permission.
   if(path==='rpc/icash_seller_voice_permission_current')return false;
   assert.equal(path,'rpc/icash_save_seller_text_offer','No consent changes, call queue or provider operations');
   saved=args;return save;
  },
  dispatch:async(account,id)=>{assert.equal(account,context.accountId);assert.equal(id,'fixture-text');dispatches++;return {status:'fixture-message-delivered'};},
  send:async()=>{throw Error('No agreement expected');},text:async()=>{throw Error('No agreement text expected');},now:()=>Date.parse('2026-11-09T16:00:00Z'),
 });
 assert.equal(saved.p_fingerprint,context.fingerprint);
 assert.equal(saved.p_job,context.jobId);assert.equal(saved.p_version,0);
 assert.equal(reads.includes('rpc/icash_seller_voice_permission_current'),false);
 assert.equal(reads.includes('rpc/icash_seller_conversation_context'),false,'The legacy intake-only context is not the operational source authority');
 assert.equal(reads.some(path=>path.startsWith('icash_contact_permissions?')),false,'Operational threads need not have an intake permission row');
 return {plan:saved.p_plan,result,dispatches,reads};
}
const permitted=await run();
assert.equal(permitted.plan.action,'invite_call');assert.equal(permitted.plan.body,sellerCallInvitation);assert.equal(permitted.dispatches,1);checks++;
for(const capable of [false,null,undefined,'true',1,{}, {allowed:true},'error']){
 const r=await run({capable});
 assert.equal(r.plan.action,'qualify_condition',String(capable));assert.equal(r.dispatches,1,'Keep supported SMS work moving');checks++;
}
for(const enabled of [false,null,'true','error']){
 const r=await run({enabled});assert.equal(r.plan.action,'qualify_condition');assert.equal(r.reads.includes('rpc/icash_seller_call_invitation_capable'),false);checks++;
}
for(const conversation of [null,{}, {sellerConversation:'true'}]){
 // Ordinary operational draft deals have no legacy sellerConversation context.
 // Only the new complete source capability can authorize a preference question.
 const r=await run({conversation,capable:true});assert.equal(r.plan.action,'invite_call');assert.equal(r.reads.includes('rpc/icash_seller_call_invitation_capable'),true);checks++;
}
const legacyOnly=await run({conversation:{sellerConversation:true},capable:false});
assert.equal(legacyOnly.plan.action,'qualify_condition','Legacy context/caller flags cannot substitute for missing source capability');checks++;
const forged=await run({capable:false,extra:{callInvitationAllowed:true,channelNeedDirectQuote:true,newMaterialProgress:true,callInvitationCapable:true,history:[{transcript:[{role:'user',message:'I am moving'}]}]}});
assert.equal(forged.plan.action,'qualify_condition');checks++;
const changed=await run({save:null});assert.equal(changed.result.status,'text_ai_context_changed');assert.equal(changed.dispatches,0,'Source race prevents sending the stale invitation');checks++;
// No useful candidate means no capability lookup or unnecessary work.
const preferenceOnly=[...messages.slice(0,6),{...source,body:'Text only'}];
const text=await run({extra:{messages:preferenceOnly}});assert.equal(text.plan.action,'qualify_situation');assert.equal(text.reads.includes('rpc/icash_seller_call_invitation_capable'),false);checks++;
const requestPrice=[...messages.slice(0,-1),{...source,body:'How much?'}];
const price=await run({extra:{messages:requestPrice}});assert.equal(price.plan.action,'qualify_condition');assert.match(price.plan.body,/An offer depends/);assert.equal(price.reads.includes('rpc/icash_seller_call_invitation_capable'),false);checks++;
const noProgress=[...messages.slice(0,6),source];
const injectedHistory=await run({extra:{messages:noProgress,history:[{transcript:[{role:'user',message:'I am moving'}]}]}});assert.equal(injectedHistory.plan.action,'qualify_situation');assert.equal(injectedHistory.reads.includes('rpc/icash_seller_call_invitation_capable'),false);checks++;
console.log(`PASS ${checks} seller preference service checks: thread/source capability, global voice unchanged, missing/malformed/disabled reads, caller flags ignored, source race and answer-first SMS.`);
