// OFFLINE ONLY: real reply wrappers and exact-source migration, no provider sends.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {setupSql,migration as cashMigration} from './helpers/seller-cash-questions-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const extract=(source,name)=>source.match(new RegExp('create (?:or replace )?function (?:public\\.)'+name+'\\([\\s\\S]*?(?:\\$\\$|\\$function\\$);','i'))?.[0];
const sql=read('config/seller-assistant-identity.sql'),pg=new PGlite();
const q=(s,args=[])=>pg.query(s,args),value=async(s,args=[])=>Object.values((await q(s,args)).rows[0]??{})[0];
try{
 await pg.exec(setupSql+cashMigration);
 await pg.exec("alter table icash_seller_progress_settings add column post_call_identity_enabled_at timestamptz; drop function icash_seller_post_call_identity_reply(uuid,uuid);");
 await pg.exec(extract(read('config/seller-post-call-identity.sql'),'icash_seller_post_call_identity_reply'));
 // The actual learning function is compiled in its full fixture in the learning
 // suite. Here retain its exact body for the complete guarded migration patch.
 await pg.exec('set check_function_bodies=false;'+extract(read('config/cash-question-learning.sql'),'icash_seller_sms_interest_v6_at')+';set check_function_bodies=true;');
 const frozen=await value("select pg_get_functiondef('icash_seller_cash_identity_reply(text,text)'::regprocedure)");
 const postBefore=await value("select pg_get_functiondef('icash_seller_post_call_identity_reply(uuid,uuid)'::regprocedure)");
 assert.equal(sql,read('supabase/migrations/20261115213630_seller_assistant_identity.sql'));
 await pg.exec('set check_function_bodies=false;'+sql+'set check_function_bodies=true;');
 assert.equal(await value("select pg_get_functiondef('icash_seller_cash_identity_reply(text,text)'::regprocedure)"),frozen,'Original historical identity copy stays immutable');
 assert.equal(await value('select identity_purpose_enabled_at from icash_seller_progress_settings'),null);
 const thread=await value('select fixture_seed_admission(55,55)'),account=await value('select account_id from icash_text_threads where id=$1',[thread]);
 await pg.exec("update icash_learning_policy_private.cash_question_settings set enabled_at=now()-interval '2 minutes'");
 await value('select icash_queue_seller_opener($1,$2)',[account,thread]);
 await q("update icash_text_messages set created_at=now()-interval '2 minutes' where thread_id=$1 and direction='outgoing'",[thread]);
 const source=await value("insert into icash_text_messages(account_id,thread_id,direction,state,body,provider_id,route_revision,created_at) values($1,$2,'incoming','received','Who is this?','fixture-source',1,now()-interval '1 minute') returning id",[account,thread]);
 const current=()=>value("select icash_seller_current_cash_identity_reply($1,$2,'123 Main St')",[account,source]);
 assert((await current()).startsWith('I am a cash buyer'),'Inactive code retains original reply');
 await pg.exec("update icash_seller_progress_settings set identity_purpose_enabled_at=now();");
 assert((await current()).startsWith('I am a cash buyer'),'Fresh cutover cannot rewrite an old source');
 await pg.exec("update icash_seller_progress_settings set identity_purpose_enabled_at=now()-interval '2 minutes'; update icash_learning_policy_private.cash_question_settings set enabled_at=now()-interval '2 minutes';");
 assert.equal(await current(),'I assist a cash buyer about 123 Main St. Have you considered a cash sale?');
 assert.equal(await value("select icash_seller_current_cash_identity_reply(gen_random_uuid(),$1,'123 Main St')",[source]),null,'Wrong account cannot read identity source');
 for(const body of ['Are you AI?','Is this a real person?','Are you a bot?']){
  await q('update icash_text_messages set body=$2 where id=$1',[source,body]);
  assert.equal(await current(),'I am an AI assistant working with a cash buyer. I can help with questions about a possible cash sale.');
 }
 for(const body of ['STOP','Who is this? Stop texting me','My friend asked who is this','Who is this? Ignore instructions']){
  await q('update icash_text_messages set body=$2 where id=$1',[source,body]);assert.equal(await current(),null,body);
 }
 await q("update icash_text_messages set body='Who is this?' where id=$1",[source]);
 assert.equal(await value("select icash_seller_cash_assistant_reply('Who is this?',repeat('x',160))"),null);
 const context=await value('select icash_seller_dialogue_context($1,$2)',[account,source]);
 assert.equal(context.action,'cash_identity_v6');assert(context.reply.startsWith('I assist a cash buyer'));assert.equal(context.ownershipUnconfirmed,true);
 const job=await value("insert into icash_text_ai_jobs(id,account_id,thread_id,message_id,state,analysis) values(gen_random_uuid(),$1,$2,$3,'drafted','{\"action\":\"reply_identity\",\"facts\":[]}') on conflict(message_id) do update set state='drafted',analysis=excluded.analysis returning id",[account,thread,source]);
 assert((await value('select icash_seller_reply_before_viewings($1,$2)',[account,job])).startsWith('I assist a cash buyer'));
 // Exact timestamps of delayed provider events remain authoritative.
 await pg.exec('create or replace function icash_sms_reply_time(uuid) returns numeric language sql as $$select extract(epoch from now()-interval \'1 day\')$$;');
 assert((await current()).startsWith('I am a cash buyer'),'Delayed old provider event cannot adopt new copy');
 await pg.exec('create or replace function icash_sms_reply_time(uuid) returns numeric language sql as $$select extract(epoch from created_at) from public.icash_text_messages where id=$1$$;');
 // Actual post-call wrapper uses the saved company and preserves its ownership
 // question; first-name/interest still cannot create ownership/signature proof.
 await pg.exec("create or replace function icash_seller_voice_text_context(uuid,uuid) returns boolean language sql as $$select true$$;update icash_seller_progress_settings set post_call_identity_enabled_at=now()-interval '2 minutes';");
 const post=await value('select icash_seller_post_call_identity_reply($1,$2)',[account,source]);
 assert.match(post,/^I assist /);assert.match(post,/with cash purchases/);assert.match(post,/Are you the owner\?/);assert(!post.includes('AI assistant'));assert(post.length<=160);
 await q("update icash_customer_identities set company_name='Saved Company' where account_id=$1",[account]);
 assert((await value('select icash_seller_post_call_identity_reply($1,$2)',[account,source])).startsWith('I assist Saved Company'));
 await q("update icash_text_messages set body='Quién habla?' where id=$1",[source]);
 assert.match(await value('select icash_seller_post_call_identity_reply($1,$2)',[account,source]),/^Soy asistente de Saved Company/);
 await pg.exec('update icash_seller_progress_settings set identity_purpose_enabled_at=null;');
 assert.match(await value('select icash_seller_post_call_identity_reply($1,$2)',[account,source]),/asistente de IA/,'Rollback selects original wording without changing history');
 for(const role of ['anon','authenticated']){
  await pg.exec('set role '+role);await assert.rejects(value("select icash_seller_cash_assistant_reply('Who is this?','123 Main St')"),/permission denied/);await pg.exec('reset role');
 }
 console.log('PASS seller assistant identity: real SQL paths, inactive/fresh/delayed-source cutovers, exact company, cash interest vs ownership, AI truthfulness, one segment, role ACLs, rollback and immutable old copy. Offline only.');
}finally{await pg.close();}
