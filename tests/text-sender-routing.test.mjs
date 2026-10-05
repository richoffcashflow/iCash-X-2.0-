import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {sameBusinessNumber} from '../lib/number-continuity.ts';
const before={...process.env};
try{
 Object.assign(process.env,{CONTIGUITY_FROM:'+12125550100',CONTIGUITY_API_KEY:'SIMULATION',CONTIGUITY_WEBHOOK_SECRET:'SIMULATION'});
 let enabled=true,voiceNumber='+12125550199',voiceEnabled=false,sends=0,claims=0;
 const from='+12125550199',to='+12125550123';
 const db=async(path,method,body)=>{
  if(path.startsWith('icash_text_messages?'))return [{body:'Synthetic only',attachments:[],thread_id:'thread'}];
  if(path.startsWith('icash_text_threads?'))return [{sender:from,recipient:to}];
  if(path.startsWith('icash_text_senders?')){assert(path.includes(encodeURIComponent(from)));return enabled?[{phone:from}]:[];}
  if(path.startsWith('icash_voice_configs?'))return [{enabled:voiceEnabled,phone_number_id:'verified-id'}];
  if(path==='rpc/icash_claim_text'){claims++;assert.equal(body.p_sender,from);return {from,to,message:'Synthetic only',attachments:[]};}
  if(path==='rpc/icash_accept_text')return;
  throw Error(path);
 };
 const {dispatchTextMessage}=await loadService('lib/text-message-service.ts',{db,smsWorkEnabled:()=>true,liveWorkReady:()=>true,sameBusinessNumber,textPayload:()=>{},elevenRequest:async()=>({phone_number:voiceNumber}),sendContiguityText:async job=>{sends++;assert.equal(job.from,from);assert.equal(job.to,to);return {messageId:'SIMULATION receipt'};}});
 assert.equal((await dispatchTextMessage('owned','message')).status,'message_accepted');assert.equal(sends,1,'uses separately configured thread sender, not global default');
 enabled=false;assert.equal((await dispatchTextMessage('owned','message')).status,'business_number_mismatch');assert.equal(claims,1);
 enabled=true;voiceEnabled=true;voiceNumber='+12125550198';assert.equal((await dispatchTextMessage('owned','message')).status,'business_number_mismatch');assert.equal(claims,1);
 voiceNumber=from;assert.equal((await dispatchTextMessage('owned','message')).status,'message_accepted');assert.equal(sends,2);
 console.log('PASS sender routing: stable enabled thread number, no global fallback, disabled sender hold and verified voice/SMS continuity. Mock providers only.');
}finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);}
