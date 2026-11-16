import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content});
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let calls=0;const noModel=async()=>{calls++;throw Error('Forbidden');};
for(const kind of ['account','access'])for(const q of ['So I am just waiting on you to find a deal','Am I just waiting for the bot to find a deal?']){
 const evidence=[{key:'work',code:'not_paused',status:'ok'},{key:'readiness',code:'readiness_blocked',status:'attention'}];
 const r=await replyToSupport({kind,messages:[u(q)],evidence},noModel);
 assert.match(r.reply,/not.*(?:proof|guarantee)/i);assert.equal(r.status,'open');assert.doesNotMatch(r.reply,/will keep searching|keep it running/i);
 if(kind==='account'){assert.match(r.reply,/needs review/i);assert.equal(r.managementReview,true);}
 else assert.doesNotMatch(r.reply,/Your.*check|Your bot is/);
 const ack=await replyToSupport({kind,handedOff:true,messages:[u(q),{role:'assistant',content:r.reply},u('Thanks')]},noModel);assert.equal(ack.status,'open');
}
for(const q of ['I am not waiting for the bot to find a deal','Am I waiting for the seller to sign?','So I am just waiting on you to find a deal. I paid twice.','Where is the course?']){
 const r=await replyToSupport({kind:'account',allowAI:false,messages:[u(q)]},noModel);assert.doesNotMatch(r.reply,/Run setting is not proof/);
}
assert.equal(calls,0);
for(const evidence of [[],[{key:'work',code:'paused',status:'attention'}]]){
 const r=await askWaiting(evidence);assert.equal(r.status,'open');
 assert.match(r.reply,evidence.length?/Your bot is paused/:/do not confirm current progress/);
}
async function askWaiting(evidence){return replyToSupport({kind:'account',messages:[{role:'operator',content:'Earlier results remain unconfirmed.'},u('So I am waiting for my bot to find a deal?')],evidence},noModel);}
const changed=await replyToSupport({kind:'account',allowAI:false,messages:[u('Am I waiting for the bot to find a deal?'),{role:'operator',content:'A payment needs review.'},u('Where is the course?')]},noModel);assert.doesNotMatch(changed.reply,/Run setting is not proof/);
assert.equal(calls,0);
