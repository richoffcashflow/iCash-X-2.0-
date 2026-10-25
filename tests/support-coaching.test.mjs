import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifySupportCoaching,supportCoachingReferral,supportVipUpgradeUrl} from '../lib/support-coaching.ts';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content});
const vip=active=>[{key:'vip',source:'icash_vip_features_active',status:'ok',code:active?'vip_active':'vip_inactive',detail:'Verified fixture',observedAt:new Date().toISOString()}];
const context=(question,evidence=[])=>({kind:'account',messages:[user(question)],evidence});
for(const question of ['Can you help me with this deal?','What do you think about this deal?','What would you offer?','How does wholesaling work?','Analyze this deal for me','Is this a good deal?','What should I offer on this house?','How much should I pay for this property?','How do I wholesale a house?','Help me negotiate with the seller','Should I accept this offer?','I need real estate coaching']){
 assert.equal(classifySupportCoaching(question).kind,'coaching',question);
 for(const active of [true,false]){
  let calls=0;const result=await replyToSupport(context(question,vip(active)),async()=>{calls++;throw Error('No coaching model calls');});
  assert.equal(calls,0);assert.equal(result.status,'open');assert.match(result.reply,/not deal analysis or coaching/);assert.equal(result.reply.includes(supportVipUpgradeUrl),!active);assert.doesNotMatch(result.reply,/\$|guarantee|resolved|closed/);
 }
}
for(const question of ['How much should I pay to upgrade VIP?','How much should I pay per month?','How much credit should I add?','Cancel my subscription','My payment is missing','Deal analysis doesn’t load','My deal analysis never opens','Deal analysis keeps spinning','My deal analysis is unavailable','My deal analysis is not loading','Ask AI will not analyze this deal','What offer did my bot send?','What is the offer price shown on this lead?','How do I analyze this deal in the app?','Where do I view my offers?','The deal analysis feature is broken','Ask AI cannot analyze this deal','I cannot sign in','I was charged twice','My bot is not calling','How do I use Ask AI?','How do I download a contract?','Can I target a specific city?','My VIP upgrade payment failed','I need a human','Why did my offer fail to send?']){
 assert.equal(classifySupportCoaching(question).kind,'support',question);
 const result=supportConversationFallback(context(question,vip(false)));assert(!result.reply.includes(supportVipUpgradeUrl),question);
}
for(const question of ['Analyze this deal and help with my payment','My bot is not calling, what should I offer?','My bot is not calling. What should I offer on this house?','What should I offer and my bot is not working','How do I wholesale a house? Also where do I view my calls?','I was charged twice; analyze this deal']){
 const routed=classifySupportCoaching(question);assert.equal(routed.kind,'mixed',question);assert.doesNotMatch(routed.technicalQuestion,/what should i offer|how do i wholesale|analyze this deal/i);
 const result=supportConversationFallback(context(question,vip(false)));assert.equal(result.status,'open');assert.match(result.reply,/Review the VIP upgrade/);assert(result.reply.split('\n\n').length>=2);
}
for(const claim of ['I have VIP','I paid for VIP yesterday','VIP is active on my account'])assert.doesNotMatch(supportCoachingReferral(vip(false),claim+'. Analyze this deal',true),/upgrade=vip/);
const unknown=supportCoachingReferral([], 'Analyze this deal',true);assert.match(unknown,/If you already have VIP/);
assert.match(supportCoachingReferral(vip(false),'I am already VIP. Analyze this deal',true),/not recognized/);
assert.doesNotMatch(supportCoachingReferral(vip(false),'I am already VIP. Analyze this deal',true),/upgrade=vip/);
assert.match(supportCoachingReferral(vip(true),'Analyze this deal',false),/If you already have VIP/,'Guests cannot use account entitlement evidence');
assert.match(supportCoachingReferral([{...vip(false)[0],status:'unknown'}],'Analyze this deal',true),/If you already have VIP/);
const guest=await replyToSupport({kind:'access',messages:[user('Analyze this deal')],allowAI:false});assert.match(guest.reply,/If you already have VIP/);assert.equal(guest.status,'open');
const earlier={...context('Analyze this deal',vip(true)),messages:[user('I cannot sign in'),{role:'assistant',content:'Still checking.'},user('Analyze this deal')]};
assert.equal((await replyToSupport(earlier)).status,'open');
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let prompt='';await replyToSupport(context('My photo download has a problem'),async(_url,options)=>{prompt=JSON.parse(options.body).messages[0].content;throw Error('Offline');});
assert.match(prompt,/not deal analysis, offer-price recommendations/);
for(const key of ['ICASH_SUPPORT_AI_ENABLED','OPENAI_API_KEY','ICASH_SUPPORT_AI_MODEL'])delete process.env[key];
const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');assert.match(page,/get\('upgrade'\).*'vip'/);
const work=readFileSync(new URL('../lib/work-account.ts',import.meta.url),'utf8');assert.match(work,/rpc\/icash_vip_features_active/);
const diagnostic=readFileSync(new URL('../lib/support-diagnostics.ts',import.meta.url),'utf8');assert.match(diagnostic,/typeof active!=='boolean'/);
console.log('Coaching boundary, technical/mixed requests, VIP/unknown entitlement, open issues and shared prompt passed.');
