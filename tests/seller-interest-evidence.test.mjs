import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {sellerInterestQuote} from '../lib/seller-interest-evidence.ts';
import {acquisitionOpeners,liveConversationResult} from '../lib/deal-conversation.ts';
import {installInterestEvidence} from './helpers/interest-evidence-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pair=(question,answer)=>[{role:'agent',message:question},{role:'user',message:answer}];
const question='Would you be interested in selling your property?';
const cases=[
 ...Object.values(acquisitionOpeners).flatMap(opener=>[
  [pair(opener,'Yes'),'Yes'],[pair(opener,'Sure!'),'Sure!'],
  [pair(opener,'Yes, if you pay a million dollars.'),null],
  [pair(opener,'Yes, I own the property.'),null],
  [pair(opener,'Maybe, if the price is right.'),null],
  [pair(opener,'No'),null],
  [[...pair(opener,'Yes'),{role:'user',message:'Stop calling me.'}],null],
 ]),
 [pair('  WOULD YOU BE OPEN TO A CASH OFFER IF THE PRICE  AND\nTIMING WORKED FOR YOU?  ','Yes.'),'Yes.'],
 [pair('Would you be open to a cash offer if we paid a million dollars?','Yes'),null],
 [pair('Would you be open to a cash offer if the price and timing worked for you? Are you the owner?','Yes'),null],
 [pair('Are you the owner? Would you be open to a cash offer if the price and timing worked for you?','Yes'),null],
 [pair('Would you not be open to a cash offer if the price and timing worked for you?','Yes'),null],
 [pair('Would you be open to a cash offer if the price and timing worked for you','Yes'),null],
 [[...pair(acquisitionOpeners.flexible_timing,'Let me think'),{role:'user',message:'Yes'}],null],
 [pair(question,'Yes.'),'Yes.'],[pair('Are you open to a cash offer?','Sure!'),'Sure!'],
 [[{role:'user',message:'I’m interested in selling my house.'}],'I’m interested in selling my house.'],
 [[{role:'user',message:'I want to sell if you pay a million dollars.'}],null],
 [[{role:'user',message:'I am interested in selling my house, maybe next year.'}],null],
 [pair('Are you the owner of this property?','Yes'),null],
 [pair('Is this a good time to talk?','Yes'),null],
 [pair('Can I send you more information?','Yes'),null],
 [pair('Would you be interested in hearing a cash offer?','Yes'),null],
 [pair('Do you want to sell? Are you the owner?','Yes'),null],
 [pair('Would you be interested in not selling?','Yes'),null],
 [pair('Would you be interested in selling if we paid a million dollars?','Yes'),null],
 [pair(question,'Maybe, if the price is right.'),null],
 [pair(question,'My wife said "I am interested in selling".'),null],
 [pair(question,'I am not interested in selling.'),null],
 [pair(question,'Please leave a message after the beep.'),null],
 [pair(question,'[silence]'),null],
 [[...pair(question,'Yes'),...pair('May I confirm?','Stop calling me.')],null],
 [[...pair(question,'Yes'),...pair('May I confirm?','Actually I do not want to sell.')],null],
 [[...pair(question,'Let me think'),{role:'user',message:'Yes'}],null],
 [[{role:'user',message:'Yes'}],null],
 [[...pair(question,'Yes'),{role:'user',message:'No thanks'}],null],
];
const db=new PGlite();
try{
 await db.exec('create role anon;create role authenticated;create role service_role;create table icash_screening_jobs(id uuid);');
 await db.exec(read('config/seller-response-policy.sql'));await db.exec(read('config/seller-optout-base-verbs.sql'));
 await db.exec(read('supabase/migrations/20261023175907_seller_call_contact_evidence.sql').match(/create or replace function public\.icash_call_has_seller_response[\s\S]*?\$\$;/)[0]);
 await installInterestEvidence(db);
 for(const [transcript,expected] of cases){
  assert.equal(sellerInterestQuote(transcript),expected,JSON.stringify(transcript));
  for(const providerInterested of [false,true]){
   const providerQuote=transcript.find(t=>t.role==='user')?.message??null;
   const raw={transcript,interested:providerInterested,interestQuote:providerQuote};
   const sql=(await db.query('select icash_seller_interest_quote($1) quote,icash_call_selling_interest($1) interested',[raw])).rows[0];
   assert.equal(sql.quote,expected);assert.equal(sql.interested,!!expected,'Historical provider flags must not bypass source evidence');
   const source={conversation_id:'fixture',agent_id:'fixture',status:'done',transcript,analysis:{data_collection_results:{interested:{value:providerInterested},interest_quote:{value:providerQuote}}}};
   const original=structuredClone(source);
   const live=liveConversationResult(source,{conversationId:'fixture',agentId:'fixture',party:'seller'});
   assert.equal(live.interested,!!expected,JSON.stringify(transcript));assert.equal(live.interestQuote,expected);assert.deepEqual(live.transcript.map(t=>t.message),transcript.map(t=>t.message));
   assert.deepEqual(source,original,'Source receipts, provider analysis and transcript are unchanged');
   if(!providerInterested)assert.equal(liveConversationResult(source,{conversationId:'fixture',agentId:'fixture',party:'buyer'}).interested,false,'Seller fallback cannot label buyers');
  }
 }
 const buyer={conversation_id:'fixture',agent_id:'fixture',status:'done',transcript:pair('Are you interested in purchasing this property?','Yes'),analysis:{data_collection_results:{interested:{value:true},interest_quote:{value:'Yes'}}}};
 assert.equal(liveConversationResult(buyer,{conversationId:'fixture',agentId:'fixture',party:'buyer'}).interested,true,'Existing buyer source quote behavior is unchanged');
 for(const role of ['anon','authenticated'])assert.equal((await db.query(`select has_function_privilege('${role}','icash_seller_interest_quote(jsonb)','execute') allowed`)).rows[0].allowed,false);
 console.log(`Seller interest: ${cases.length} source cases with true/false provider flags, reviewed-opener SQL/TS parity, original receipts, negative/ambiguous/automated safeguards and unchanged buyer classification passed.`);
}finally{await db.close();}
