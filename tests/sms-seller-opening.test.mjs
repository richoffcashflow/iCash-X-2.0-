import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sellerConversationGuide} from '../lib/seller-outreach.ts';
import {analyzeText,textConversationInstructions} from '../lib/text-ai-policy.ts';
for(const phrase of ['Is this the owner of [saved property address]?', 'Wait for ownership confirmation', 'Would you be interested in selling your property for all cash?', 'real prior conversation history', 'without repeating answered questions or inventing a prior interaction'])assert(sellerConversationGuide.includes(phrase),phrase);
assert(textConversationInstructions('seller').includes('merely confirms ownership is not selling interest'));
const outgoing='Hi, I am the AI assistant for Fixture Company. Is this the owner of 123 Main Street? Reply STOP to opt out.';
const provider=async()=>Response.json({id:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'ask_price',reply:'What price?',summary:'Seller wants to sell.',facts:[]})}}]});
for(const answer of ['Yes','Yes I am the owner','No','Yes but I am not the owner','Who are you?']){
 const {analysis}=await analyzeText({model:'fixture',party:'seller',context:{},messages:[{direction:'outgoing',body:outgoing},{direction:'incoming',body:answer}]},'fixture',provider);
 assert.equal(analysis.action,'review',answer+' must not enter model-driven qualification');
}
const {analysis}=await analyzeText({model:'fixture',party:'seller',context:{},messages:[{direction:'outgoing',body:outgoing},{direction:'incoming',body:'Can I talk to a real person?'}]},'fixture',provider);
assert.equal(analysis.action,'handoff');
const sql=readFileSync(new URL('../config/sms-seller-opening.sql',import.meta.url),'utf8');
for(const invariant of ['enable row level security','security invoker',"permission_until<=now()",'icash_claim_text_before_owner_question(p_account,p_message,p_sender)',"opening.owner_reply_id=p_reply",'icash_sms_thread_review_current(t.account_id,t.id,true)','length(message_body)>160'])assert(sql.includes(invariant),invariant);
console.log('SMS seller opening prompt and runtime guards passed. Owner confirmation cannot become selling interest through model output. SQL sequence is covered by the isolated PGlite suite.');
