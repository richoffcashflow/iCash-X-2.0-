import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
import {supportCustomVoiceReply} from '../lib/support-custom-voice.ts';
import {supportProductConflict} from '../lib/support-product-conflicts.ts';
import {supportQualityReport} from '../lib/support-quality.ts';

const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const vip={key:'vip',code:'vip_active',status:'ok',detail:'VIP features are active.',source:'offline',observedAt:'2026-11-08T02:00:00Z'};
const context=(messages,extra={})=>({kind:'account',messages,evidence:[vip],...extra});
const priorEnv={...process.env};let requests=0,checks=0;
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='offline-only';process.env.ICASH_SUPPORT_AI_MODEL='offline-only';
const model=async()=>{requests++;throw Error('Known voice support must not call a model');};
const ask=async(messages,extra={})=>{checks++;return replyToSupport(context(messages,extra),model);};
try{
 const reported=user("hey I can't play the custom voice recording can");
 const falseReply=assistant("The custom voice recording playback is not supported in iCash X 2.0. You won't be able to play it there.");
 const first=await ask([reported]);
 assert.match(first.reply,/Customize bot → Custom voice → Play my cloned voice/);
 assert.match(first.reply,/no work credits/);assert.equal(first.status,'open');assert.equal(first.managementReview,true);
 assert.doesNotMatch(first.reply,/not supported|purchase|add money|Course|readiness/);
 const quality=user("can you confirm it doesn't sound off and scaring sellers away or if should just change back to the original");
 const second=await ask([reported,falseReply,quality]);
 assert.match(second.reply,/earlier reply was incorrect/i);assert.match(second.reply,/can’t assess/);
 assert.match(second.reply,/Use standard voice/);assert.match(second.reply,/still needs troubleshooting/);
 assert.equal(second.status,'open');assert.equal(second.managementReview,true);
 const third=await ask([reported,falseReply,quality,assistant('What feedback have sellers given you?'),user('no feedback from sellers that why im concerned')]);
 assert.match(third.reply,/No seller feedback does not prove/);assert.equal(third.status,'open');assert.equal(third.managementReview,true);
 assert.doesNotMatch(third.reply,/likely not scaring|keep using it unless|working correctly/);
 assert.deepEqual(supportConversationFallback(context([reported,falseReply,quality])),second);
 for(const q of ['How do I listen to my cloned voice?','Where can I play the custom voice recording?','Can I hear my voice preview with no credits?']){
  const r=await ask([user(q)]);assert.match(r.reply,/Play my cloned voice/);assert.equal(r.status,'resolved');
 }
 for(const q of ['I don’t see Play my cloned voice','It says Could not load your voice preview','No sound','It just won’t play']){
  const r=await ask([reported,assistant(first.reply),user(q)]);assert.equal(r.status,'open');assert.equal(r.managementReview,true);
  if(q!=='It just won’t play')assert.doesNotMatch(r.reply,/What happens when/,'Do not ask for an already supplied failure detail');
 }
 const inactive=await ask([reported],{evidence:[{...vip,code:'vip_inactive'}]});assert.match(inactive.reply,/VIP is not active/);assert.match(inactive.reply,/don’t purchase it again/);assert.equal(inactive.status,'open');
 const unknown=await ask([reported],{evidence:[{...vip,status:'unknown',code:undefined}]});assert.doesNotMatch(unknown.reply,/VIP is not active/);
 const standalone=await ask([user('Does my custom voice sound bad?')]);assert.match(standalone.reply,/can’t assess/);assert.doesNotMatch(standalone.reply,/still needs troubleshooting/);assert.equal(standalone.managementReview,undefined);
 const switchBack=await ask([reported,assistant(first.reply),user('Should I switch back to standard?')]);assert.match(switchBack.reply,/Use standard voice/);assert.equal(switchBack.status,'open');
 // Topic changes, guest access, ordinary recorded calls and voice selection keep their existing paths.
 for(const q of ['How do I change the bot to a female voice?','I can’t hear the seller on my browser call','Where is the course?','How do I access a call recording?','Cancel my subscription','How do I change my sign-in email?','I have no seller feedback about my offer']){
  assert.equal(supportCustomVoiceReply(context([reported,falseReply,user(q)])),null,q);
 }
 assert.equal(supportCustomVoiceReply(context([reported],{kind:'access'})),null);
 assert.equal(supportCustomVoiceReply(context([reported,user('Where is the course?'),user('No sound')])),null,'Do not restore a stale voice topic after a course question');
 const fixed=await ask([reported,assistant(first.reply),user('It worked, I can hear it now.')]);assert.equal(fixed.status,'resolved');
 assert.equal(supportProductConflict(falseReply.content,reported.content),true);
 assert.equal(supportProductConflict('Since you have no feedback, the custom voice is likely not scaring sellers away.',quality.content),true);
 for(const safe of ['Custom voice playback is supported.','Custom voice playback is not supported for Standard accounts.','Your custom voice preview failed and needs review.','Your custom voice is not ready yet.','I can’t assess voice quality from chat. No seller feedback does not prove it sounds good or bad.'])assert.equal(supportProductConflict(safe,quality.content),false,safe);
 const flagged=supportQualityReport([{id:'offline-case',kind:'account',subject:'voice preview',status:'open',updated_at:'2026-11-08T02:00:00Z',messages:[{...reported,created_at:'2026-11-08T02:00:00Z'},{...falseReply,created_at:'2026-11-08T02:00:01Z'}]}],new Date('2026-11-08T02:01:00Z'));
 assert.ok(flagged.cases[0].flags.some(flag=>flag.code==='mismatch'));
 const ui=readFileSync(new URL('../components/vip-custom-voice.tsx',import.meta.url),'utf8');
 for(const label of ['Play my cloned voice','Use standard voice'])assert.ok(ui.includes(label));
 assert.equal(requests,0);
}finally{process.env=priorEnv;}
console.log(`PASS ${checks} custom voice support replays, honest quality answers, missing-control failures and topic boundaries; no provider requests.`);
