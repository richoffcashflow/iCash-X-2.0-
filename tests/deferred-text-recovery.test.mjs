import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';

// Exercise the actual selector consumer and dispatch function. Only transport,
// persistence and original admission are replaced with offline fixtures.
class InventoryHeld extends Error {}
const sender='+14155550100';
const item=(id,mode='held',claimKind='automatic')=>({accountId:'account-'+id,messageId:id,claimKind,mode});
async function run(items,{enabled=true,selectionError=false,voiceVerificationFailure=false,inboundUnavailable=false,receiptReview=false}={}){
 let current,index=0;
 const seen={selections:0,claims:[],transports:[],receipts:[],reviews:[]};
 const api=await loadService('lib/text-message-service.ts',{
  instantLeadsEnabled:()=>true,smsWorkEnabled:()=>enabled,liveWorkReady:()=>!inboundUnavailable,
  elevenRequest:async()=>{throw Error('Number verification unavailable');},
  sameBusinessNumber:(a,b)=>a===b,textPayload:()=>({}),SellerInventoryUnavailableError:InventoryHeld,
  db:async(path,method,body)=>{
   if(path==='rpc/icash_next_sender_volume_retry'){
    seen.selections++;if(selectionError)throw Error('selection unavailable');
    current=items[index++];return current?{accountId:current.accountId,messageId:current.messageId,claimKind:current.claimKind}:null;
   }
   if(path.startsWith('icash_text_messages?')){
    if(method==='PATCH'){seen.reviews.push(current.messageId);return [];}
    return [{body:'Offline fixture',attachments:[],thread_id:'thread-'+current.messageId}];
   }
   if(path.startsWith('icash_sms_inbound_invitations?'))return [{id:'invitation',reply_id:'reply'}];
   if(path==='rpc/icash_review_sms_campaign_reply')return null;
   if(path.startsWith('icash_text_threads?'))return [{sender,recipient:'+12025550100',sender_pool_assigned:!voiceVerificationFailure}];
   if(path.startsWith('icash_text_senders?'))return current.mode==='disabled'?[]:[{phone:sender}];
   if(path.startsWith('icash_voice_configs?'))return voiceVerificationFailure?[{enabled:true,phone_number_id:'fixture-number'}]:[];
   if(path.startsWith('icash_meta_lead_messages?'))return current.claimKind==='meta'&&current.mode!=='changed-kind'?[{message_id:current.messageId}]:[];
   if(path.startsWith('rpc/icash_')&&path.includes('claim')){
    seen.claims.push({id:current.messageId,path,body});
    if(current.mode==='claim-error')throw Error('claim outcome unknown');
    if(current.mode==='inventory')throw new InventoryHeld();
    if(current.mode==='held')return null;
    return {from:sender,to:'+12025550100',message:'Offline fixture'};
   }
   throw Error('Unexpected database path '+path);
  },
  sendContiguityText:async()=>{
   seen.transports.push(current.messageId);
   if(current.mode==='provider-error')throw Error('transport outcome unknown');
   return {messageId:'provider-'+current.messageId};
  },
  saveTextReceipt:async(_db,account,message,provider)=>{
   seen.receipts.push({account,message,provider});
   if(current.mode==='receipt-error')throw Error('receipt outcome unknown');
   return {status:receiptReview?'message_delivery_needs_review':'message_accepted'};
  },
 });
 try{return {result:await api.retryVolumeDeferredText(),seen};}
 catch(error){return {error,seen};}
}

const old={...process.env};
try{
 Object.assign(process.env,{CONTIGUITY_API_KEY:'offline-fixture',CONTIGUITY_WEBHOOK_SECRET:'offline-fixture'});
 let r=await run([item('stale'),item('valid','send'),item('later','send')]);
 assert.equal(r.result.status,'message_accepted','A known pre-send hold must not consume the whole recovery pass');
 assert.deepEqual(r.seen.claims.map(x=>x.id),['stale','valid']);
 assert.deepEqual(r.seen.transports,['valid'],'Stop after the first provider attempt');
 assert.equal(r.seen.selections,2);
 r=await run([item('stale'),item('disabled','disabled'),item('inventory','inventory'),item('fourth','send'),item('later','send')]);
 assert.equal(r.result.status,'message_accepted');assert.equal(r.seen.selections,4);assert.deepEqual(r.seen.transports,['fourth']);
 for(const mode of ['disabled','inventory','changed-kind']){
  r=await run([item('held',mode,mode==='changed-kind'?'meta':'automatic'),item('valid','send')]);
  assert.equal(r.result.status,'message_accepted',mode);
  assert.deepEqual(r.seen.transports,['valid']);
 }
 for(const mode of ['provider-error','receipt-error']){
  r=await run([item('held'),item('attempt',mode),item('later','send')]);
  assert.equal(r.result.status,'message_delivery_needs_review');
  assert.deepEqual(r.seen.transports,['attempt']);assert.deepEqual(r.seen.reviews,['attempt']);
  assert.equal(r.seen.selections,2,'An uncertain outcome never continues to another provider attempt');
 }
 r=await run([item('unknown','claim-error'),item('later','send')]);
 assert.match(r.error.message,/claim outcome unknown/);assert.equal(r.seen.selections,1);assert.deepEqual(r.seen.transports,[]);
 r=await run([item('held')],{selectionError:true});assert.match(r.error.message,/selection unavailable/);
 r=await run(Array.from({length:8},(_,i)=>item('held-'+i)));
 assert.equal(r.result.status,'message_held');assert.equal(r.seen.selections,4);assert.equal(r.seen.claims.length,4);assert.deepEqual(r.seen.transports,[]);
 r=await run([item('same'),item('same'),item('later','send')]);
 assert.equal(r.result.status,'message_held');assert.equal(r.seen.selections,2);assert.equal(r.seen.claims.length,1);assert.deepEqual(r.seen.transports,[]);
 for(const kind of ['manual','meta']){
  r=await run([item('held'),item(kind,'send',kind)]);
  assert.equal(r.result.status,'message_accepted');
  assert.equal(r.seen.claims.at(-1).path,kind==='manual'?'rpc/icash_claim_customer_text':'rpc/icash_meta_claim_text');
 }
 r=await run([item('invalid','send','invalid')]);assert.match(r.error.message,/Invalid deferred text binding/);assert.deepEqual(r.seen.transports,[]);
 r=await run([item('disabled','send'),item('later','send')],{enabled:false});assert.equal(r.result.status,'live_work_not_ready');assert.equal(r.seen.selections,1);
 for(const [option,status] of [['voiceVerificationFailure','business_number_verification_required'],['inboundUnavailable','inbound_invitation_not_ready'],['receiptReview','message_delivery_needs_review']]){
  r=await run([item('first','send'),item('later','send')],{[option]:true});
  assert.equal(r.result.status,status);assert.equal(r.seen.selections,1);
  assert.deepEqual(r.seen.transports,option==='receiptReview'?['first']:[]);
 }
 delete process.env.CONTIGUITY_API_KEY;
 r=await run([item('configuration','send'),item('later','send')]);
 assert.equal(r.result.status,'messaging_configuration_required');assert.equal(r.seen.selections,1);assert.deepEqual(r.seen.transports,[]);
 process.env.CONTIGUITY_API_KEY='offline-fixture';
 r=await run([]);assert.equal(r.result.status,'idle');assert.equal(r.seen.selections,1);
 r=await run([item('held')]);assert.equal(r.result.status,'message_held');assert.equal(r.seen.selections,2);
 console.log('PASS bounded deferred text recovery, original claim paths, pre-send holds, repeated bindings and unknown provider outcomes');
}finally{
 Object.assign(process.env,old);for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];
}
