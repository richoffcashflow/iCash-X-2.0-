// Exact production predecessor + source scenarios. No calls, SMS or paid tests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {callContactEvidence} from '../lib/call-contact-evidence.ts';
import {liveConversationResult} from '../lib/deal-conversation.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const user=message=>({role:'user',message});
const machine='Please leave a message and call me back.';
const db=await PGlite.create();
const patch=read('config/seller-voicemail-no-review.sql');
const boundary=read('config/seller-voicemail-live-reply-boundary.sql');
assert.equal(boundary,read('supabase/migrations/20261114170550_seller_voicemail_live_reply_boundary.sql'));
assert.equal(patch,read('supabase/migrations/20261114170419_seller_voicemail_no_review.sql'));
const reason=async(turns,review=false)=>(await db.query('select public.icash_seller_gap_reason($1,$2) value',[turns,review])).rows[0].value;
try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(read('config/seller-response-policy.sql'));
 await db.exec(read('config/seller-optout-base-verbs.sql'));
 const helpers=read('config/seller-conversation-continuation.sql');
 for(const name of ['identity_question','conversation_human'])await db.exec(helpers.match(new RegExp('create function public.icash_seller_'+name+'[\\s\\S]*?\\$\\$;'))[0]);
 await db.exec(read('tests/fixtures/seller-voicemail-before.sql'));
 await db.exec(`revoke all on function icash_call_has_seller_response(jsonb),icash_seller_gap_reason(jsonb,boolean) from public,anon,authenticated;
 grant execute on function icash_call_has_seller_response(jsonb),icash_seller_gap_reason(jsonb,boolean) to service_role;
 create table icash_live_conversations(id int,account_id int,screening_id int,party text default 'seller',state text default 'complete',operation_key text default 'voice:fixture',completed_at timestamptz default now(),result jsonb);
 create table icash_seller_gaps(id int,source text default 'call',source_id int,account_id int default 1,screening_id int default 1,reason text default 'callback',state text default 'needs_review',review_reason text,outgoing_id int,resolved_by int,resolved_at timestamptz,resolution text,created_at timestamptz default now(),updated_at timestamptz default now(),quote text);`);
 assert.equal(await reason([user(machine)]),'callback','reproduce mailbox callback becoming customer review');
 for(let id=1;id<=9;id++){
  const words=id===2?'Call me tomorrow at 2 PM Central.':machine;
  await db.query('insert into icash_live_conversations(id,account_id,screening_id,result) values($1,1,1,$2)',[id,{transcript:[user(words)]}]);
  await db.query('insert into icash_seller_gaps(id,source_id,quote,created_at,updated_at) values($1,$1,$2,now(),now())',[id,words]);
 }
 await db.exec(`update icash_seller_gaps set updated_at=created_at+interval '1 second' where id=3;
 update icash_seller_gaps set review_reason='manual_review' where id=4;
 update icash_seller_gaps set outgoing_id=40 where id=5;
 update icash_seller_gaps set account_id=2 where id=6;
 update icash_seller_gaps set screening_id=2 where id=7;
 update icash_live_conversations set state='processing' where id=8;
 update icash_seller_gaps set quote='A different source' where id=9;`);
 const security=()=>db.query("select proname,prosecdef,provolatile,proconfig,proacl::text from pg_proc where proname in ('icash_call_has_seller_response','icash_seller_gap_reason') order by proname");
 const beforeSecurity=(await security()).rows;
 await db.exec('begin;'+patch+'commit;');
 await db.exec('begin;'+boundary+'commit;');
 assert.deepEqual((await security()).rows,beforeSecurity,'preserve access, search path and volatility');
 const closed=(await db.query("select id from icash_seller_gaps where state='resolved' order by id")).rows;
 assert.deepEqual(closed,[{id:1}],'only untouched, exact source-bound machine callback is retired');
 assert.equal((await db.query('select result from icash_live_conversations where id=1')).rows[0].result.transcript[0].message,machine,'original evidence is immutable');
 const machines=[
  [machine], ["Leave your name and number, and I'll call you back."],
  ["Leave your name and message, and I'll get back to you as soon as possible."],
  ["I'll see if this person is available.",'Thanks. Please stay on the line.','This person is not available.'],
  ['... voice will try to connect you.'], ['One, to connect your call.','Please press one to connect your call.'],
  ['¿Esta persona está disponible?','Gracias. Permanece en la línea.','music playing','Esta persona no está disponible.'],
 ];
 for(const words of machines){
  const transcript=words.map(user);
  assert.equal(callContactEvidence(transcript),'automated_answer',words.join(' / '));
  assert.equal(await reason(transcript),'no_response',words.join(' / '));
  assert.equal((await db.query('select icash_call_has_seller_response($1) value',[{transcript}])).rows[0].value,false);
  const result=liveConversationResult({conversation_id:'fixture',agent_id:'fixture',status:'done',transcript,analysis:{data_collection_results:{human_requested:{value:true},callback_requested:{value:true},interested:{value:true}}}},{conversationId:'fixture',agentId:'fixture',party:'seller'});
  assert.equal(result.humanRequested,false);assert.equal(result.interested,false);assert.equal(result.callbackStatus,'not_requested');
  assert.match(result.nextAction,/No seller response/);assert(!/review/i.test(result.nextAction));
  assert.deepEqual(result.transcript.map(({role,message})=>({role,message})),transcript);
 }
 for(const [words,expected] of [
  [[machine,'Call me tomorrow at 2 PM Central.'],'callback'],
  [[machine,'Stop calling me.'],'contact_stop'],
  [[machine,'I want to speak to a real person.'],'human'],
  [[machine,'Yes, I own it.'],null],
  [['I got your voicemail. Call me tomorrow.'],'callback'],
  [['Stay on the line while I talk to my wife about selling.'],'owners'],
  [['Esta persona no está disponible, pero yo soy el dueño.'],null],
 ]){assert.equal(callContactEvidence(words.map(user)),'human_response');assert.equal(await reason(words.map(user)),expected);}
 assert.equal(await reason([user('Call me tomorrow.')],true),'callback','SMS review callback remains intact');
 assert.equal(await reason([user('Hello.')],true),'unanswered');
 assert.equal(await reason([user('music playing')]),'no_response');
 await assert.rejects(db.exec('begin;'+patch),/Voicemail classification predecessor changed/);
 await db.exec('rollback');
 assert.deepEqual((await db.query("select id from icash_seller_gaps where state='resolved'")).rows,[{id:1}]);
 console.log('PASS machine-only calls never become seller review; SQL/TS parity, real responses, scoped cleanup and migration security/drift guards.');
}finally{await db.close();}
