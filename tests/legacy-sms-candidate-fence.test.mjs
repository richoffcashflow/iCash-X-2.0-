import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createOperationalContactFixture} from './helpers/operational-contact-fixture.mjs';
const require=createRequire(import.meta.url);
const f=await createOperationalContactFixture(require.resolve('@electric-sql/pglite'),{automaticChannels:true});
const {pg,q,rpc,one,account,prepare,project}=f;
const sql=readFileSync(new URL('../config/legacy-sms-candidate-fence.sql',import.meta.url),'utf8');
assert.equal(sql,readFileSync(new URL('../supabase/migrations/20261024211944_legacy_sms_candidate_fence.sql',import.meta.url),'utf8'));
const original=sql.split('$original$')[1],replacement=sql.split('$replacement$')[1];
const select=s=>s.replace(' into thread','').replace(' for update of t skip locked','');
const uid=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
try{
 await pg.exec(`create table if not exists icash_timezone_names(name text primary key);insert into icash_timezone_names select name from pg_timezone_names on conflict do nothing;
 create or replace function icash_next_before_seller_openers() returns jsonb language sql as $$select null::jsonb$$;
 create or replace function icash_sms_outreach_window_current(uuid,uuid) returns boolean language sql stable as $$select true$$;`);
 await prepare();await project();
 await pg.exec(readFileSync(new URL('./fixtures/legacy-sms-scheduler-baseline.sql',import.meta.url),'utf8'));
 const thread=(await one('select id from icash_text_threads where account_id=$1',[account])).id;
 const definition=()=>one("select pg_get_functiondef(p.oid) body,proacl::text acl,prosecdef,proconfig from pg_proc p where p.oid='icash_next_before_sms_inbound_campaign()'::regprocedure");
 const before=await definition();assert(before.body.includes(original));
 const writers=await q("select oid::regprocedure::text signature,pg_get_functiondef(oid) body from pg_proc where proname in ('icash_queue_seller_opener','icash_claim_text_message') order by oid");
 await pg.exec(sql);
 assert.deepEqual(await definition(),{...before,body:before.body.replace(original,replacement)},'Only candidate selection changes; all locks, cadence, writer calls and ACLs remain');
 const compare=async(label,expected)=>{const old=(await q(select(original))).rows,updated=(await q(select(replacement))).rows;assert.deepEqual(updated,old,label);if(expected!==undefined)assert.equal(updated.length,expected,label);return updated;};
 assert.equal((await compare('valid account',1))[0].id,thread);
 const isolated=async(label,change)=>{await q('begin');try{await change();await compare(label,0);}finally{await q('rollback');}};
 for(const [label,statement,args] of [
  ['account paused','update icash_accounts set bot_paused=true where id=$1',[account]],
  ['empty wallet','update icash_wallets set balance_cents=0 where account_id=$1',[account]],
  ['reserved wallet','update icash_wallets set reserved_cents=balance_cents where account_id=$1',[account]],
  ['non-draft deal',"update icash_deal_files set stage='under_contract' where account_id=$1",[account]],
  ['practice deal',"update icash_deal_files set terms=terms||'{\"practice\":true}'::jsonb where account_id=$1",[account]],
  ['ineligible screening',"update icash_screening_jobs set result=jsonb_set(result,'{financialCheck,status}','\"ineligible\"') where id=$1",[f.screening]],
  ['expired screening',"update icash_screening_jobs set completed_at=now()-interval '24 hours' where id=$1",[f.screening]],
  ['thread paused','update icash_text_threads set paused=true where id=$1',[thread]],
  ['AI disabled',"update icash_text_threads set ai_mode='off' where id=$1",[thread]],
  ['AI review only',"update icash_text_threads set ai_mode='review' where id=$1",[thread]],
  ['recipient suppression',"insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[f.phone]],
  ['property takeover',"insert into icash_property_controls(account_id,property_id,manual) select $1,snapshot->>'propertyId',true from icash_screening_jobs where id=$2 on conflict(account_id,property_id) do update set manual=true",[account,f.screening]],
 ])await isolated(label,()=>q(statement,args));
 for(const state of ['ready','dispatching','accepted','delivered','needs_review','cancelled'])await isolated('existing '+state,()=>q("insert into icash_text_messages(account_id,thread_id,direction,body,state,request_key) values($1,$2,'outgoing','SIMULATION prior message',$3,gen_random_uuid())",[account,thread,state]));
 await isolated('existing incoming',()=>q("insert into icash_text_messages(account_id,thread_id,direction,body,state,request_key) values($1,$2,'incoming','SIMULATION reply','received',gen_random_uuid())",[account,thread]));
 for(const value of ['false','null'])await isolated('outside/unknown contact window',()=>pg.exec(`create or replace function icash_sms_outreach_window_current(uuid,uuid) returns boolean language sql stable as $$select ${value}::boolean$$`));
 await isolated('expired permission',()=>pg.exec("create or replace function icash_sms_thread_dispatch_until(p_account uuid,p_thread uuid) returns timestamptz language sql stable as $$select now()-interval '1 second'$$"));
 // Historical conversations must never consume a fresh contact-check budget.
 await q('begin');
 try{
  await pg.exec(`create sequence fixture_legacy_sms_checks;
   alter function icash_sms_thread_dispatch_until(uuid,uuid) rename to fixture_original_dispatch_until;
   create function icash_sms_thread_dispatch_until(p_account uuid,p_thread uuid) returns timestamptz language plpgsql as $$begin perform nextval('fixture_legacy_sms_checks');return public.fixture_original_dispatch_until(p_account,p_thread);end$$;`);
  for(let n=1;n<=200;n++){
   await q("insert into icash_text_threads select (jsonb_populate_record(null::icash_text_threads,to_jsonb(t)||jsonb_build_object('id',$2::text,'recipient',$3::text))).* from icash_text_threads t where t.id=$1",[thread,uid(n),'+1202555'+String(n).padStart(4,'0')]);
   await q("insert into icash_text_messages(account_id,thread_id,direction,body,state,request_key) values($1,$2,'outgoing','SIMULATION historical message','ready',gen_random_uuid())",[account,uid(n)]);
  }
  await q("insert into icash_text_messages(account_id,thread_id,direction,body,state,request_key) values($1,$2,'outgoing','SIMULATION existing','ready',gen_random_uuid())",[account,thread]);
  await pg.exec('analyze');await q(select(original));
  const oldCalls=(await one('select case when is_called then last_value else 0 end n from fixture_legacy_sms_checks')).n;
  await pg.exec("select setval('fixture_legacy_sms_checks',1,false)");
  assert.deepEqual((await q(select(replacement))).rows,[]);
  assert.equal((await one('select is_called from fixture_legacy_sms_checks')).is_called,false,'Historical messages are excluded before expensive checks');
  console.log('Legacy SMS historical contact checks: '+oldCalls+' -> 0.');
  await q('delete from icash_text_messages where thread_id between $1::uuid and $2::uuid and thread_id<>$3::uuid',[uid(1),uid(200),thread]);
  await pg.exec(`create or replace function icash_sms_thread_dispatch_until(p_account uuid,p_thread uuid) returns timestamptz language sql stable as $$select now()+interval '1 day'$$;
   create or replace function icash_sms_outreach_window_current(uuid,uuid) returns boolean language sql stable as $$select $2='${uid(200)}'::uuid$$;`);
  assert.equal((await compare('199 unavailable windows cannot starve the final eligible thread',1))[0].id,uid(200));
  await pg.exec(`create or replace function icash_sms_outreach_window_current(uuid,uuid) returns boolean language sql stable as $$select $2 in ('${uid(150)}'::uuid,'${uid(200)}'::uuid)$$;`);
  assert.equal((await compare('Original eligible-thread ordering and limit',1))[0].id,uid(150));
 }finally{await q('rollback');}
 const wallet=await one('select * from icash_wallets where account_id=$1',[account]);
 const issued=await rpc('icash_next_before_sms_inbound_campaign',{});assert(issued?.token,'Real unchanged writer creates an eligible opener');
 assert.equal(await rpc('icash_next_before_sms_inbound_campaign',{}),null,'No second ticket or duplicate opener');
 assert.deepEqual(await one('select * from icash_wallets where account_id=$1',[account]),wallet,'Scheduling does not debit or release wallet funds');
 assert.equal((await one('select count(*)::int n from icash_text_messages where thread_id=$1 and provider_id is not null',[thread])).n,0,'No provider receipt invented');
 assert.deepEqual(await q("select oid::regprocedure::text signature,pg_get_functiondef(oid) body from pg_proc where proname in ('icash_queue_seller_opener','icash_claim_text_message') order by oid"),writers);
 await assert.rejects(pg.exec(sql),/Legacy SMS candidate prerequisite changed/);await q('rollback');
 assert.deepEqual(await definition(),{...before,body:before.body.replace(original,replacement)});
 console.log('PASS legacy SMS candidate fence: identical eligibility and ordering, protected wallet/contact rules, real idempotent writer, unchanged ACL and fail-closed replay.');
}catch(error){console.error(error.message,error.where??'',error.query??'');process.exitCode=1;}finally{await pg.close();}
