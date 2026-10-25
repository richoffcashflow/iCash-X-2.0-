// Local PostgreSQL only. No provider calls or production writes.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createOperationalContactFixture} from './helpers/operational-contact-fixture.mjs';
const require=createRequire(import.meta.url);
const f=await createOperationalContactFixture(require.resolve('@electric-sql/pglite'),{automaticChannels:true});
const {pg,q,rpc,one,account,prepare,project,isolated}=f;
const sql=readFileSync(new URL('../config/seller-opener-volume.sql',import.meta.url),'utf8');
const original=sql.split('$original$')[1],replacement=sql.split('$replacement$')[1];
const select=s=>s.replace(' into t','').replace(' for update of th skip locked','');
const baseline=JSON.parse(readFileSync(new URL('./fixtures/seller-opener-volume-baseline.json',import.meta.url),'utf8'));
const uid=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
try{
 await pg.exec(`create table icash_timezone_names(name text primary key);insert into icash_timezone_names select name from pg_timezone_names;
 create or replace function icash_sms_outreach_window_current(uuid,uuid) returns boolean language sql stable as $$select true$$;
 set check_function_bodies=off;`);
 for(const row of baseline)await pg.exec(row.definition);
 await pg.exec('set check_function_bodies=on');
 await prepare();await project();
 const thread=(await one('select id from icash_text_threads where account_id=$1',[account])).id;
 const definition=name=>one('select pg_get_functiondef(oid) body,proacl::text acl,prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[name+'()']);
 const before=new Map();for(const row of baseline)before.set(row.proname,await definition(row.proname));
 const wallet=await one('select * from icash_wallets where account_id=$1',[account]);
 const writers=await q("select oid::regprocedure::text signature,pg_get_functiondef(oid) body from pg_proc where proname in ('icash_queue_seller_opener','icash_claim_text_message') order by oid");
 await pg.exec(sql);
 for(const row of baseline){
  const prior=before.get(row.proname);
  const body=prior.body.replace(original,replacement).replace("kind='seller_opener' and created_at>now()-interval '5 seconds'","kind='seller_opener' and created_at>now()-interval '1 second'");
  assert.deepEqual(await definition(row.proname),{...prior,body},row.proname+' preserves all other guards, ACLs, locks and writes');
 }
 const compare=async(label,expected)=>{const old=(await q(select(original))).rows,updated=(await q(select(replacement))).rows;assert.deepEqual(updated,old,label);assert.equal(updated.length,expected,label);return updated;};
 assert.equal((await compare('eligible contact',1))[0].id,thread);
 for(const [label,statement,args] of [
  ['Pause','update icash_accounts set bot_paused=true where id=$1',[account]],
  ['wallet','update icash_wallets set balance_cents=reserved_cents where account_id=$1',[account]],
  ['stage',"update icash_deal_files set stage='under_contract' where id=$1",[f.deal]],
  ['practice',"update icash_deal_files set terms=terms||'{\"practice\":true}'::jsonb where id=$1",[f.deal]],
  ['financial',"update icash_screening_jobs set result=jsonb_set(result,'{financialCheck,status}','\"ineligible\"') where id=$1",[f.screening]],
  ['expired screening',"update icash_screening_jobs set completed_at=now()-interval '25 hours' where id=$1",[f.screening]],
  ['paused thread','update icash_text_threads set paused=true where id=$1',[thread]],
  ['manual AI',"update icash_text_threads set ai_mode='off' where id=$1",[thread]],
  ['STOP',"insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[f.phone]],
  ['property takeover',"insert into icash_property_controls(account_id,property_id,manual) values($1,'prop_1001',true)",[account]],
 ])await isolated(async()=>{await q(statement,args);await compare(label,0);});
 for(const state of ['ready','dispatching','accepted','delivered','needs_review','cancelled'])await isolated(async()=>{
  await q("insert into icash_text_messages(account_id,thread_id,direction,body,state,request_key) values($1,$2,'outgoing','SIMULATION prior message',$3,gen_random_uuid())",[account,thread,state]);
  await compare('prior '+state,0);
 });
 for(const v of ['false','null'])await isolated(async()=>{
  await pg.exec(`create or replace function icash_sms_outreach_window_current(uuid,uuid) returns boolean language sql stable as $$select ${v}::boolean$$;`);
  await compare('closed/unknown hours',0);
 });
 await isolated(async()=>{
  await pg.exec("create or replace function icash_sms_thread_dispatch_until(p_account uuid,p_thread uuid) returns timestamptz language sql stable as $$select now()-interval '1 second'$$;");
  await compare('expired admission',0);
 });
 // Historical threads must not trigger costly channel/time checks. Compare
 // real query results and call counts instead of asserting wall-clock timing.
 await isolated(async()=>{
  await pg.exec(`create sequence fixture_fresh_checks;
   create or replace function icash_sms_outreach_window_current(uuid,uuid) returns boolean language plpgsql as $$begin perform nextval('fixture_fresh_checks');return true;end$$;`);
  for(let n=1;n<=120;n++){
   await q("insert into icash_text_threads select (jsonb_populate_record(null::icash_text_threads,to_jsonb(t)||jsonb_build_object('id',$2::text,'recipient',$3::text))).* from icash_text_threads t where t.id=$1",[thread,uid(n),'+1202555'+String(n).padStart(4,'0')]);
   await q("insert into icash_text_messages(account_id,thread_id,direction,body,state,request_key) values($1,$2,'outgoing','SIMULATION historical','ready',gen_random_uuid())",[account,uid(n)]);
  }
  await q("insert into icash_text_messages(account_id,thread_id,direction,body,state,request_key) values($1,$2,'outgoing','SIMULATION prior','ready',gen_random_uuid())",[account,thread]);
  await pg.exec('analyze');await q(select(original));
  assert.equal((await one('select is_called from fixture_fresh_checks')).is_called,true);
  await pg.exec('alter sequence fixture_fresh_checks restart with 1');
  assert.deepEqual((await q(select(replacement))).rows,[]);
  assert.equal((await one('select is_called from fixture_fresh_checks')).is_called,false,'History excluded before expensive checks');
  await q('delete from icash_text_messages where thread_id between $1 and $2',[uid(1),uid(120)]);
  await pg.exec(`create or replace function icash_sms_outreach_window_current(uuid,uuid) returns boolean language sql stable as $$select $2='${uid(120)}'::uuid$$;`);
  assert.equal((await compare('119 closed recipients do not starve later contact',1))[0].id,uid(120));
 });
 // Exercise the actual scheduler/writer with another account's ticket at the
 // boundary. Each isolated run keeps the global one-second throttle intact.
 await pg.exec('create or replace function icash_next_before_sms_inbound_campaign() returns jsonb language sql as $$select null::jsonb$$;');
 for(const seconds of [0,0.999,1,2,5])await isolated(async()=>{
  const message=(await one("insert into icash_text_messages(account_id,direction,body,state,request_key) values($1,'outgoing','SIMULATION unrelated','ready',gen_random_uuid()) returning id",[f.other])).id;
  await q("insert into icash_automation_tickets(account_id,kind,opener_message_id,state,outcome,created_at,expires_at) values($1,'seller_opener',$2,'held','message_held',now()-$3*interval '1 second',now()+interval '1 minute')",[f.other,message,seconds]);
  const issued=await rpc('icash_next_before_unstarted_sms_recovery',{});
  assert.equal(!!issued?.token,seconds>=1,'shared cadence '+seconds);
  if(issued?.token){
   assert.equal(await rpc('icash_next_before_unstarted_sms_recovery',{}),null,'No duplicate ticket or second immediate opener');
   assert.equal((await one('select count(*)::int n from icash_text_messages where thread_id=$1',[thread])).n,1);
  }
 });
 assert.deepEqual(await one('select * from icash_wallets where account_id=$1',[account]),wallet,'Scheduling never debits or releases credits');
 assert.deepEqual(await q("select oid::regprocedure::text signature,pg_get_functiondef(oid) body from pg_proc where proname in ('icash_queue_seller_opener','icash_claim_text_message') order by oid"),writers,'Final writer and provider admission are unchanged');
 assert.equal((await one('select count(*)::int n from icash_text_messages where provider_id is not null')).n,0);
 await assert.rejects(pg.exec(sql),/Fresh SMS selection prerequisite changed/);await q('rollback');
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(n=>n.endsWith('_seller_outreach_volume_and_call_hours.sql'));
 assert.equal(files.length,1);assert.equal(readFileSync(new URL('../supabase/migrations/'+files[0],import.meta.url),'utf8'),sql+'\n'+readFileSync(new URL('../config/strict-outbound-call-hours.sql',import.meta.url),'utf8'));
 console.log('PASS seller opener volume: one-second aggregate cadence, identical candidate selection, no historical admission scans, protected contact/wallet/receipt rules and atomic migration prerequisites.');
}catch(error){console.error(error.message,error.where??'',error.query??'');process.exitCode=1;}finally{await pg.close();}
