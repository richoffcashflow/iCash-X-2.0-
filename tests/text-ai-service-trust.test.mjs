process.env.ICASH_LIVE_WORK_READY='true'; // Ready-state provider fixtures only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {analyzeText,safeTextReplies} from '../lib/text-ai-policy.ts';
import {propertyQuestionAllowed} from '../lib/text-property-policy.ts';

// Run the actual service with local database/provider fakes. No emails, SMS or paid AI calls.
let party='seller',incoming='The house needs a roof.',action='ask_price',records=[],packages=0,dispatches=0,modelCalls=0,buyerReplyAllowed=false,sellerConversation=false,sellerReplyAllowed=true,viewingCoordination=false;
const db=async(path,method,body)=>{
 records.push({path,method,body});
 if(path==='rpc/icash_claim_text_ai')return {model:'fixture',context:{stage:'draft',sellerConversation,sellerViewingAvailability:viewingCoordination},messages:[{direction:'incoming',body:incoming}]};
 if(path.startsWith('icash_text_ai_jobs')&&method!=='PATCH')return [{thread_id:'thread'}];
 if(path.startsWith('icash_text_threads'))return party?[{deal_id:'deal',party}]:[];
 if(path.startsWith('icash_customer_identities'))return [{principal:'Fixture company'}];
 if(path==='rpc/icash_text_property_context')return null;
 if(path==='rpc/icash_save_text_ai'||method==='PATCH')return null;
 if(path==='rpc/icash_queue_seller_conversation_reply'){assert.deepEqual(Object.keys(body).sort(),['p_account','p_job']);return sellerReplyAllowed?'seller-conversation-message':null;}
 if(path==='rpc/icash_queue_ai_reply')return 'outgoing';
 if(path==='rpc/icash_queue_buyer_factual_reply'){assert.deepEqual(Object.keys(body).sort(),['p_account','p_job']);return buyerReplyAllowed?'server-factual-message':null;}
 throw Error('Unexpected database call '+path);
};
const analyze=async(input)=>analyzeText(input,'fixture',async(_url,options)=>{
 modelCalls++;
 const request=JSON.parse(options.body),data=JSON.parse(request.messages[1].content);
 assert.equal(data.party,party);
 assert.equal(data.context.principal,'Fixture company');
 assert.equal(data.context.offerAuthorized,false);
 if(viewingCoordination)assert.match(request.messages[0].content,/purchase agreement is signed/);
 if(party==='buyer'){
  assert.match(request.messages[0].content,/potential buyer, not a property seller/);
  assert.equal(data.context.property,null);
 }
 // Deliberately wrong buyer/refusal action: runtime validation must prevent an automatic seller reply.
 return Response.json({id:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify({action,reply:'Guaranteed sale. I already booked your callback.',summary:'Funds verified and all owners agreed.',facts:[]})}}]});
});
globalThis.__textTrustFixture={db,analyzeText:analyze,safeTextReplies,propertyQuestionAllowed,sendRequestedBuyerPackages:async()=>{packages++;return {accepted:1};},dispatchTextMessage:async()=>{dispatches++;return {status:'message_accepted'};}};
let source=ts.transpileModule(readFileSync(new URL('../lib/text-ai-service.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
source='const {db,analyzeText,safeTextReplies,propertyQuestionAllowed,sendRequestedBuyerPackages,dispatchTextMessage}=globalThis.__textTrustFixture;\n'+source;
const {processTextAi}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const priorKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture';
const reset=()=>{records=[];packages=0;dispatches=0;modelCalls=0;};
const saved=()=>records.find(r=>r.path==='rpc/icash_save_text_ai').body.p_analysis;
try{
 assert.equal((await processTextAi('account','job')).status,'message_accepted');
 assert.equal(dispatches,1);
 assert.equal(packages,0);
 assert.equal(saved().action,'ask_price');
 assert(saved().summary.includes(incoming));
 assert(!saved().summary.includes('Funds verified'));
 assert.equal(records.find(r=>r.path==='rpc/icash_queue_ai_reply').body.p_reply,safeTextReplies.ask_price);

 reset();party='buyer';incoming='Please email the buyer package.';
 assert.equal((await processTextAi('account','job')).status,'text_ai_drafted');
 assert.equal(saved().action,'review');
 assert.equal(dispatches,0);assert.equal(packages,1,'existing independently gated requested-package workflow remains available');
 assert(!records.some(r=>r.path==='rpc/icash_text_property_context'));
 assert(!records.some(r=>r.path==='rpc/icash_queue_ai_reply'));

 reset();buyerReplyAllowed=true;incoming='What is the buyer price?';
 assert.equal((await processTextAi('account','job')).status,'message_accepted');
 assert.equal(dispatches,1);assert.equal(saved().action,'review');
 assert(!records.some(r=>r.path==='rpc/icash_queue_ai_reply'));
 assert.equal(records.find(r=>r.path==='rpc/icash_queue_buyer_factual_reply').body.p_reply,undefined,'Model prose never enters buyer queue');

 for(const message of ['No thanks.','Stop contacting me.','Please call me tomorrow.','Can I talk with your manager?']){
  reset();incoming=message;
  await processTextAi('account','job');
  assert.equal(dispatches,0,message);assert.equal(packages,0,message);
  assert(!records.some(r=>r.path==='rpc/icash_queue_ai_reply'),message);
  assert(!records.some(r=>r.path==='rpc/icash_queue_buyer_factual_reply'),message);
 }

 reset();party='seller';incoming='Yes, I would consider selling.';action='ask_condition';
 assert.equal((await processTextAi('account','job')).status,'message_accepted');
 assert.equal(dispatches,1);

 sellerConversation=true;
 for(const [message,nextAction] of [['Who is this?','reply_identity'],['Can you call me?','ask_callback_details'],['How does this work?','explain_process'],['Can I send pictures?','ask_photos']]){
  reset();incoming=message;action=nextAction;
  assert.equal((await processTextAi('account','job')).status,'message_accepted');
  assert.equal(dispatches,1);
  assert(records.some(r=>r.path==='rpc/icash_queue_seller_conversation_reply'));
  assert(!records.some(r=>r.path==='rpc/icash_queue_ai_reply'),'New lane cannot fall back to old sender');
 }
 for(const message of ['Stop texting me.','I want a real person.']){
  reset();incoming=message;action='reply_identity';
  await processTextAi('account','job');assert.equal(dispatches,0);
  assert(!records.some(r=>r.path==='rpc/icash_queue_seller_conversation_reply'));
 }
 reset();incoming='How does this work?';action='explain_process';sellerReplyAllowed=false;
 assert.equal((await processTextAi('account','job')).status,'text_ai_drafted');
 assert.equal(dispatches,0);assert(!records.some(r=>r.path==='rpc/icash_queue_ai_reply'),'A blocked new lane never bypasses the DB through a legacy queue');
 reset();viewingCoordination=true;sellerReplyAllowed=true;incoming='Tomorrow 2 PM to 4 PM Central';action='review';
 assert.equal((await processTextAi('account','job')).status,'message_accepted');
 assert(records.some(r=>r.path==='rpc/icash_queue_seller_conversation_reply'));
 assert(!records.some(r=>r.path==='rpc/icash_queue_ai_reply'));
 assert.equal(saved().callRequested,false);
 viewingCoordination=false;sellerConversation=false;

 for(const missingOrOther of ['', 'title']){
  reset();party=missingOrOther;
  assert.equal((await processTextAi('account','job')).status,'text_ai_needs_review');
  assert.equal(modelCalls,0);assert.equal(dispatches,0);assert.equal(packages,0);
  assert(records.some(r=>r.method==='PATCH'&&r.body.state==='needs_review'));
 }
}finally{
 if(priorKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=priorKey;
 delete globalThis.__textTrustFixture;
}
console.log('Actual SMS service: seller qualification, verified buyer routing, grounded saved summaries, no seller questions to buyers, contact refusal and missing-party holds passed with fixtures.');
