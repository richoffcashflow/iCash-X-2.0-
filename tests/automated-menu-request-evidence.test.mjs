import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {isAutomatedCallMenu} from '../lib/automated-call-menu.ts';
import {callContactEvidence} from '../lib/call-contact-evidence.ts';
import {sellerCallDisposition,sellerResponseDisposition} from '../lib/seller-response-policy.ts';
import {liveConversationResult} from '../lib/deal-conversation.ts';
import {isConfirmedVoicemail} from '../lib/call-display-evidence.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const user=message=>({role:'user',message});
const menu="If you would like to speak with a representative, press one. If you would like to hang up, press two. If you would like to be placed on Fixture Leads' do not call list, press three.";
const patch=read('config/automated-menu-request-evidence.sql');
assert.equal(patch,read('supabase/migrations/20261114172512_automated_menu_request_evidence.sql'));
const db=await PGlite.create();
const q=(sql,args=[])=>db.query(sql,args);
const evidence=async(words,review=false)=>(await q('select icash_call_has_seller_response($1) human,icash_seller_call_disposition($1) disposition,icash_seller_gap_reason($2,$3) reason',[{transcript:words.map(user)},words.map(user),review])).rows[0];
try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(read('config/seller-response-policy.sql'));
 await db.exec(read('config/seller-optout-base-verbs.sql'));
 await db.exec(read('tests/fixtures/automated-menu-helpers.sql'));
 await db.exec(read('tests/fixtures/automated-menu-before.sql'));
 assert.deepEqual(await evidence([menu]),{human:true,disposition:'opt_out',reason:'contact_stop'},'reproduce menu DNC label becoming a seller action');
 await db.exec(`revoke all on function icash_call_has_seller_response(jsonb),icash_seller_call_disposition(jsonb),icash_seller_gap_reason(jsonb,boolean) from public,anon,authenticated;
 grant execute on function icash_call_has_seller_response(jsonb),icash_seller_call_disposition(jsonb),icash_seller_gap_reason(jsonb,boolean) to service_role;
 create table icash_screening_jobs(id int,account_id int,state text);
 insert into icash_screening_jobs values(1,1,'complete'),(7,1,'archived');
 create table icash_live_conversations(id int,account_id int default 1,screening_id int default 1,party text default 'seller',state text default 'complete',operation_key text default 'voice:fixture',completed_at timestamptz default now()-interval '30 days',result jsonb);
 create table icash_seller_gaps(id int,source text default 'call',source_id int,account_id int default 1,screening_id int default 1,reason text default 'callback',state text default 'needs_review',review_reason text,outgoing_id int,resolved_by int,resolved_at timestamptz,resolution text,created_at timestamptz default now()-interval '30 days',updated_at timestamptz default now()-interval '30 days',quote text);
 create table icash_property_controls(id int,manual boolean);insert into icash_property_controls values(1,true);
 create table icash_handoffs(id int,conversation_id int,account_id int default 1,screening_id int default 1,party text default 'seller',reason text default 'Requested a person',state text default 'open',assigned_to text default 'Account owner',due_at timestamptz,created_at timestamptz,updated_at timestamptz,resolution text,resolved_at timestamptz,closing_setup_id int,text_attention_id int,portal_journey_id int);`);
 for(let id=1;id<=10;id++){
  const message=id===2?'Call me tomorrow at 2 PM Central.':'Please leave a message and call me back.';
  await q('insert into icash_live_conversations(id,result) values($1,$2)',[id,{transcript:[user(message)]}]);
  await q("insert into icash_seller_gaps(id,source_id,quote,created_at,updated_at) values($1,$1,$2,now()-interval '30 days',now()-interval '30 days')",[id,message]);
 }
 await db.exec(`update icash_seller_gaps set updated_at=created_at+interval '1 second' where id=3;
 update icash_seller_gaps set outgoing_id=40 where id=4;
 update icash_seller_gaps set review_reason='manual_review' where id=5;
 update icash_seller_gaps set account_id=2 where id=6;
 update icash_seller_gaps set screening_id=7 where id=7;update icash_live_conversations set screening_id=7 where id=7;
 update icash_seller_gaps set quote='Another source' where id=8;
 update icash_seller_gaps set resolved_by=30 where id=9;
 update icash_live_conversations set state='waiting' where id=10;`);
 for(let id=21;id<=33;id++){
  const transcript=id===26?[user(menu),user('Let me speak to a real person.')]:id===31?[]:id===32?[user(menu+' Stop calling me.')]:[user(menu)];
  await q('insert into icash_live_conversations(id,result) values($1,$2)',[id,{transcript,humanRequested:true}]);
  await q("insert into icash_handoffs(id,conversation_id,created_at,updated_at,due_at) select id,id,completed_at,completed_at,completed_at+interval '2 hours' from icash_live_conversations where id=$1",[id]);
 }
 await db.exec(`update icash_handoffs set updated_at=created_at+interval '1 second' where id=22;
 update icash_handoffs set assigned_to='Assigned colleague' where id=23;
 update icash_handoffs set text_attention_id=50 where id=24;
 update icash_handoffs set due_at=created_at+interval '3 hours' where id=25;
 update icash_handoffs set account_id=2 where id=27;
 update icash_handoffs set screening_id=2 where id=28;
 update icash_handoffs set resolution='An operator note' where id=29;
 update icash_live_conversations set state='waiting' where id=30;
 update icash_handoffs set reason='Specific operator request' where id=33;`);
 const security=async()=>(await q("select proname,prosecdef,provolatile,proconfig,proacl::text from pg_proc where proname in ('icash_call_has_seller_response','icash_seller_call_disposition','icash_seller_gap_reason') order by proname")).rows;
 const before=await security();
 await db.exec('begin;'+patch+'commit;');
 assert.deepEqual(await security(),before,'existing permissions and invocation policies preserved');
 for(const message of [menu,menu.replace('one','1').replace('two','2').replace('three','3'),menu.toUpperCase(),menu.replaceAll('. ','.\n')]){
  assert.equal(isAutomatedCallMenu(message),true);
  assert.equal(isConfirmedVoicemail([user(message)]),true,'history shows an automated answer, not a seller request');
  assert.equal(callContactEvidence([user(message)]),'automated_answer');
  assert.equal(sellerCallDisposition([user(message)]),null);
  assert.deepEqual(await evidence([message]),{human:false,disposition:null,reason:'no_response'});
  const result=liveConversationResult({conversation_id:'conv_fixture',agent_id:'agent_fixture',status:'done',transcript:[user(message)],analysis:{data_collection_results:{human_requested:{value:true},human_quote:{value:message},callback_requested:{value:true},interested:{value:true},opted_out:{value:true}}}},{conversationId:'conv_fixture',agentId:'agent_fixture',party:'seller'});
  assert.equal(result.humanRequested,false);assert.equal(result.optedOut,false);assert.equal(result.interested,false);assert.equal(result.callbackStatus,'not_requested');
  assert.equal(result.transcript[0].message,message);
 }
 for(const stop of ['Stop calling me.','Do not call me again.','Remove me from your list.'])for(const words of [[menu,stop],[menu+' '+stop],[stop+' '+menu]]){
  assert.equal(callContactEvidence(words.map(user)),'human_response');
  assert.equal(isConfirmedVoicemail(words.map(user)),false,'a real stop request stays visible');
  assert.equal(sellerCallDisposition(words.map(user)),'opt_out');
  assert.deepEqual(await evidence(words),{human:true,disposition:'opt_out',reason:'contact_stop'});
 }
 for(const [reply,disposition,reason] of [['Yes, I own the property.',null,null],['Let me speak to a real person.',null,'human'],['Call me tomorrow.',null,'callback']]){
  assert.deepEqual(await evidence([menu,reply]),{human:true,disposition,reason});
  assert.equal(callContactEvidence([user(menu),user(reply)]),'human_response');
  assert.equal(isConfirmedVoicemail([user(menu),user(reply)]),false,'a person answering after screening stays visible');
 }
 assert.equal(isAutomatedCallMenu('I want to be placed on your do not call list.'),false);
 assert.equal(sellerResponseDisposition(menu),'opt_out','SMS parsing is deliberately unchanged');
 assert.equal((await evidence([menu],true)).reason,'contact_stop','SMS review does not reuse voice-only exemption');
 assert.deepEqual((await q("select id from icash_seller_gaps where state='resolved'")).rows,[{id:1}],'only exact-source untouched older machine callback is retired');
 assert.deepEqual((await q("select id from icash_handoffs where state='resolved'")).rows,[{id:21}],'only default untouched source-bound all-menu handoff is retired');
 assert.equal((await q('select result from icash_live_conversations where id=21')).rows[0].result.transcript[0].message,menu,'source conversation is retained');
 assert.deepEqual((await q('select * from icash_property_controls')).rows,[{id:1,manual:true}]);
 assert.equal((await q("select has_function_privilege('authenticated','icash_call_is_automated_menu(text)','execute') allowed")).rows[0].allowed,false);
 await assert.rejects(db.exec('begin;'+patch),/Automated menu evidence predecessor changed/);await db.exec('rollback');
 console.log('PASS strict all-menu evidence, mixed/later opt-outs, real handoffs/callbacks, untouched historical cleanup, preserved source/security and drift guards. No provider traffic.');
}finally{await db.close();}
