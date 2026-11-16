import assert from 'node:assert/strict';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content}),a=content=>({role:'assistant',content}),o=content=>({role:'operator',content});
const old={...process.env};Object.assign(process.env,{ICASH_SUPPORT_AI_ENABLED:'true',OPENAI_API_KEY:'fictional',ICASH_SUPPORT_AI_MODEL:'fictional'});
let calls=0;const forbidden=async()=>{calls++;throw Error('Models forbidden');};
const history=[u('My research is missing and seller replies are not working.'),o('Both issues remain under review; the account was paused by the customer.'),u('Can my bot call sellers?'),a('Eligible automatic calls are supported; that does not prove current activity.')];
try{
 for(const kind of ['account','access']){
  const ctx={kind,handedOff:true,messages:[...history,u('So it can still talk to sellers, correct?')],evidence:[{key:'work',status:'attention',code:'paused',detail:'Paused',source:'fixture',observedAt:'2026-01-01T00:00:00Z'}]};
  const r=await replyToSupport(ctx,forbidden);assert.match(r.reply,/Standard includes.*seller calls/i);assert.match(r.reply,/VIP.*not.*required/i);assert.match(r.reply,/currently paused/);assert.equal(r.status,'open');assert.doesNotMatch(r.reply,/will start|will call|fixed|resume it|recorded call attempts/);
  const vip=await replyToSupport({...ctx,messages:[...history,u('Would VIP help? Can my bot still call sellers?')]},forbidden);assert.match(vip.reply,/upgrading.*does not.*repair/i);assert.equal(vip.status,'open');
  const longVip=await replyToSupport({...ctx,messages:[...history,u('Will VIP help? Because I am able to have my bot call, correct?')]},forbidden);assert.match(longVip.reply,/VIP is not required/);assert.equal(longVip.status,'open');
  const unknown=await replyToSupport({...ctx,evidence:[],messages:[u('Can the bot talk to sellers?')]},forbidden);assert.match(unknown.reply,/cannot confirm.*current/i);assert.doesNotMatch(unknown.reply,/currently paused|switched on/);
  const on=await replyToSupport({...ctx,evidence:[{key:'work',status:'ok',code:'not_paused',detail:'On',source:'fixture',observedAt:'2026-01-01T00:00:00Z'}]},forbidden);assert.doesNotMatch(on.reply,/currently paused|will start/);assert.match(on.reply,/Run.*not proof/i);
  for(const q of ['My bot cannot talk to sellers.','Can the bot talk to sellers? My payment failed.','Can it talk to sellers at midnight?','Can I talk to sellers myself?','Can the bot talk to buyers?','Can the bot talk to support?','Would VIP fix my failed calls?','That worked.'])assert.doesNotMatch(supportConversationFallback({...ctx,messages:[...history,u(q)]}).reply,/Standard includes eligible seller calls/);
  for(const boundary of [[u('Can the title service email my closer?'),a('That is a separate workflow.')],[o('The failed seller recording is the current issue.')],[u('My credits ran out.'),a('No new paid work can start.')]]){
   const r=supportConversationFallback({...ctx,messages:[...history,...boundary,u('So it can still talk to sellers, correct?')]});assert.doesNotMatch(r.reply,/Standard includes eligible seller calls/);
  }
 }
 assert.equal(calls,0);
}finally{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);}
console.log('Seller capability, VIP, current state and topic boundaries passed');
