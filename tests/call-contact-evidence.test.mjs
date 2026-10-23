// Offline parity and ingestion scenarios; no provider calls or paid simulations.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {callContactEvidence,hasHumanCallWords,automatedAnswerInstructions} from '../lib/call-contact-evidence.ts';
import {liveConversationResult,productionDealInstructions} from '../lib/deal-conversation.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const fixtures=[
 ['',false],['...',false],['…',false],['[Music]',false],['(silence)',false],['[inaudible]',false],
 ['At the tone, please record your message.',false],['Please leave your message for-',false],
 ["When you've finished recording, you may hang up or press one for more options.",false],
 ['Thanks. Please stay on the line.',false],['Please state your name and reason for calling.',false],
 ['Your call has been forwarded to the voicemail for the subscriber.',false],
 ['Are you still there? To review, re-record, or add to your message, press one.',false],
 ['Hello.',true],['Yes I own it, but I do not want to sell.',true],
 ['I got your voicemail. I am interested in selling.',true],['Do not call me or leave voicemail.',true],
 ['Please stop calling and leaving messages in my mailbox.',true],['Call me tomorrow at 2 PM Central.',true],
];
const db=await PGlite.create();
try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(read('config/seller-response-policy.sql'));
 await db.exec(read('config/seller-optout-base-verbs.sql'));
 // Run the exact shipped predicate, independent of unrelated schema fixtures.
 const migration=read('supabase/migrations/20261023174331_seller_call_contact_evidence.sql');
 await db.exec(migration.match(/create or replace function public\.icash_call_has_seller_response[\s\S]*?\$\$;/)[0]);
 for(const [message,expected] of fixtures){
  assert.equal(hasHumanCallWords(message),expected,message);
  const result={transcript:[{role:'user',message},{role:'user',message:'...'}]};
  assert.equal((await db.query('select icash_call_has_seller_response($1) value',[result])).rows[0].value,expected,message);
  const live=liveConversationResult({conversation_id:'fixture',agent_id:'fixture',status:'done',...result,analysis:{data_collection_results:{interested:{value:true},interest_quote:{value:message},human_requested:{value:!expected},callback_requested:{value:true},callback_confirmed:{value:true},callback_quote:{value:message},callback_at:{value:'2026-10-24T14:00:00-05:00'},callback_timezone:{value:'America/Chicago'}}}},{conversationId:'fixture',agentId:'fixture',party:'seller'},Date.parse('2026-10-23T18:00:00Z'));
  if(!expected){assert.equal(live.interested,false);assert.equal(live.humanRequested,false);assert.equal(live.callbackDueAt,null);assert.equal(live.callbackStatus,'not_requested');assert.equal(live.optedOut,false);}
  assert.deepEqual(live.transcript.map(t=>t.message),[message,'...'],'Original evidence is preserved');
 }
 assert.equal(callContactEvidence([{role:'user',message:'Please stay on the line.'},{role:'user',message:'Yes, this is my property.'}]),'human_response','A person answering after screening still counts');
 assert.equal(callContactEvidence([{role:'agent',message:'Hello'}]),'no_response');
 assert(productionDealInstructions.includes(automatedAnswerInstructions));
 assert.match(automatedAnswerInstructions,/end_call/);
 console.log(`Call contact evidence: ${fixtures.length} SQL/TS cases, preserved opt-outs/transcripts, false interest/callback/handoff guards and runtime call instructions passed.`);
}finally{await db.close();}
