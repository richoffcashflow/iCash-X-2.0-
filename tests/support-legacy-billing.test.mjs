import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content}),a=content=>({role:'assistant',content}),o=content=>({role:'operator',content});
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let calls=0;const deny=async()=>{calls++;throw Error('No model calls');};
const initial='The old iCash X 1.0 software is still attempting to charge me. I already use 2.0.';
for(const kind of ['account','access'])for(const handedOff of [false,true])for(const messages of [[u(initial)],[u(initial),a('Send migration proof.'),u('I already signed up for 2.0.')],[u(initial),a('Which version?'),u('It is coming from 1.0, before I signed up for 2.0.')],[u(initial),a('Migration guidance.'),u('I already signed up for 2.0.'),a('Which screen?'),u('The old 1.0 screen shows a system error.'),a('Migration guidance.'),u('Accessing 2.0 is not the issue.'),a('Which charge?'),u('It is coming from 1.0, before I signed up for 2.0.')]]){
 const r=await replyToSupport({kind,handedOff,messages},deny);assert.match(r.reply,/retirement does not establish/i);assert.match(r.reply,/billing review/i);assert.equal(r.status,'open');assert.equal(r.managementReview,true);assert.doesNotMatch(r.reply,/two calendar months|charges.*do not apply/);
}
for(const messages of [[u('How much is the 1.0 migration offer?')],[u('If 1.0 charges me later what happens?')],[u('1.0 never charged me.')],[u('1.0 will charge me next month.')],[u('1.0 is not attempting to charge me.')],[u(initial),u('I already signed up for 2.0. Where is the course?')],[u(initial),u('Where is the course?')],[u(initial),o('The original charge was checked; follow verified recovery.'),u('I already signed up for 2.0.')]]){
 const r=await replyToSupport({kind:'access',allowAI:false,messages},deny);assert.doesNotMatch(r.reply,/retirement does not establish/i);
}
assert.equal(calls,0);console.log('PASS legacy billing versus migration, account/guest, handoff, hypothetical, negation, topic/operator boundaries');

await import('./legacy-billing-actual-shape.test.mjs');
await import('./legacy-billing-review-probes.test.mjs');
