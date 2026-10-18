import {instantLeadsEnabled} from '../lib/meta-instant-lead-service.ts';
import assert from 'node:assert/strict';
import {saveTextReceipt} from '../lib/text-receipt.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
const saved={...process.env};
try{
 Object.assign(process.env,{CONTIGUITY_API_KEY:'fixture',CONTIGUITY_WEBHOOK_SECRET:'fixture',META_INSTANT_LEADS_ENABLED:'true',VERCEL_ENV:'production'});
 for(const scenario of ['lost_commit_response','early_delivery_failure','persistent_database_failure','unknown_send']){
  let sends=0,receipts=0,patches=0,state='ready',provider=null;
  const db=async(path,method,body)=>{
   if(path==='rpc/icash_accept_text'){
    receipts++;assert.equal(body.p_provider,'receipt');
    if(scenario==='persistent_database_failure')throw Error('Database down');
    provider='receipt';state=scenario==='early_delivery_failure'?'needs_review':'delivered';
    if(scenario==='lost_commit_response'&&receipts===1)throw Error('Commit succeeded; response lost');return;
   }
   if(path.startsWith('icash_text_messages?')){
    if(method==='PATCH'){patches++;assert(path.includes('state=eq.dispatching'));state=body.state;provider=body.provider_id??provider;return [];}
    if(path.includes('state=eq.ready'))return state==='ready'?[{body:'Fixture',attachments:[],thread_id:'thread'}]:[];
    return [{state,provider_id:provider}];
   }
   if(path.startsWith('icash_text_threads?'))return [{sender:'+12025550100',recipient:'+12025550101'}];
   if(path.startsWith('icash_text_senders?'))return [{phone:'+12025550100'}];
   if(path.startsWith('icash_voice_configs?'))return [{enabled:false}];
   if(path.startsWith('icash_meta_lead_messages?'))return [];
   if(path==='rpc/icash_claim_text'){if(state!=='ready')return null;state='dispatching';return {};}
   throw Error(path);
  };
  const {dispatchTextMessage}=await loadService('lib/text-message-service.ts',{instantLeadsEnabled,db,saveTextReceipt,smsWorkEnabled:()=>true,liveWorkReady:()=>true,sameBusinessNumber:(a,b)=>a===b,textPayload:()=>{},sendContiguityText:async()=>{sends++;if(scenario==='unknown_send')throw Error('Ambiguous provider timeout');return {messageId:'receipt'};}});
  const result=await dispatchTextMessage('account','message');
  assert.equal(result.status,scenario==='lost_commit_response'?'message_accepted':'message_delivery_needs_review');
  assert.equal(sends,1);await dispatchTextMessage('account','message');assert.equal(sends,1,'A retry must never send again');
  assert.equal(receipts,['lost_commit_response','persistent_database_failure'].includes(scenario)?2:scenario==='unknown_send'?0:1);
  if(scenario==='persistent_database_failure'){assert.equal(provider,'receipt');assert.equal(patches,1);}
 }
 console.log('PASS real dispatch service: lost receipt response, early failed delivery, persistent DB failure and ambiguous provider timeout; one provider send per scenario.');
}finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
