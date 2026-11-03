import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const original=JSON.parse(read('tests/fixtures/text-message-thread-scheduler-before.json')).definition;
const migration=read('config/seller-opener-bounded-scan.sql');
const id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scan=()=>v('select public.icash_next_before_sms_inbound_campaign()');
const cursor=()=>v('select last_thread_id from icash_work_private.seller_opener_scan where id=1');
const checks=()=>v("select count(*)::integer from fixture_checks where phase='hours'");
const resetChecks=()=>pg.exec('truncate fixture_checks');
const ageTickets=()=>pg.exec("update icash_automation_tickets set created_at=now()-interval '2 seconds'");
const isolated=async fn=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
try{
 await pg.exec(read('tests/fixtures/seller-opener-bounded-scan.sql'));await pg.exec(original);
 await pg.exec('revoke all on function icash_next_before_sms_inbound_campaign() from public,anon,authenticated;grant execute on function icash_next_before_sms_inbound_campaign() to service_role;');
 await pg.exec('select public.fixture_seed(n,1+(n%7),false) from generate_series(1,1024)n');
 const queue=await v("select pg_get_functiondef('public.icash_queue_seller_opener(uuid,uuid)'::regprocedure)");
 const originalHistory=await v("select md5(string_agg(to_jsonb(w)::text,',' order by account_id)) from icash_wallets w");
 assert.equal(await scan(),null);assert.equal(await checks(),1024,'reproduce the unbounded after-hours scan');await resetChecks();
 await pg.exec(migration);
 assert.equal(await v("select pg_get_functiondef('public.icash_queue_seller_opener(uuid,uuid)'::regprocedure)"),queue,'final queue implementation stays exact');
 const actual=await v("select pg_get_functiondef('public.icash_next_before_sms_inbound_campaign()'::regprocedure)");
 // Every original guard remains present in its cheap or final phase; only the
 // source set and persistent iteration change. Global history is still global.
 for(const guard of ['and not a.bot_paused','w.balance_cents>w.reserved_cents',"d.stage='draft'", "s.completed_at>now()-interval '24 hours'", "t.party='seller' and not t.paused and t.ai_mode='auto'",'public.icash_sms_thread_dispatch_until(candidate.account_id,candidate.id)>now()','public.icash_sms_outreach_window_current(candidate.account_id,candidate.id)','not exists(select 1 from public.icash_text_messages m where m.thread_id=t.id)','public.icash_seller_opener_candidate_body(ordered.account_id,ordered.id) is not null','for update of t skip locked offset 0','pg_advisory_xact_lock(726341927)'])assert(actual.includes(guard),guard);
 await isolated(async()=>{
  await pg.exec('set local plan_cache_mode=force_generic_plan');
  for(let page=1;page<=32;page++){await resetChecks();assert.equal(await scan(),null);assert.equal(await checks(),32);assert.equal(await cursor(),id(page*32));}
  await resetChecks();assert.equal(await scan(),null);assert.equal(await checks(),0);assert.equal(await cursor(),null,'exhausted upper range wraps without another unbounded scan');
  await q('update icash_text_threads set hours_allowed=true where id=$1',[id(1)]);
  assert((await scan())?.token);assert.equal(await cursor(),id(1),'a changed earlier hold is revisited after wrap');
 });
 await isolated(async()=>{
  // Eligible work well beyond one blocked page must progress across accounts.
  await pg.exec('select fixture_seed(n,20+(n%4),true) from generate_series(1025,1040)n');
  const served=new Set();let invocations=0;
  while(served.size<4&&invocations++<45){await resetChecks();const result=await scan();assert((await checks())<=32);if(result?.token){served.add(await v('select account_id from icash_automation_tickets where token=$1',[result.token]));await ageTickets();}}
  assert.equal(served.size,4,'blocked earlier accounts cannot starve later funded accounts');
  assert.equal(await v('select count(*) from icash_text_messages'),4);
  assert.equal(await v('select count(distinct opener_message_id) from icash_automation_tickets'),4);
 });
 await isolated(async()=>{
  // A busy account can have many queueable rows. Newly eligible lower UUIDs
  // must not restart the sweep and starve accounts later in the source order.
  await pg.exec('select fixture_seed(n,20,true) from generate_series(1025,1088)n;select fixture_seed(1089,21,true);select fixture_seed(1090,22,true)');
  await q('update icash_work_private.seller_opener_scan set last_thread_id=$1',[id(1024)]);
  const served=[];
  for(let n=1;n<=66;n++){
   await q('update icash_text_threads set hours_allowed=true where id=$1',[id(n)]);
   const result=await scan();assert(result?.token);
   served.push(await v('select account_id from icash_automation_tickets where token=$1',[result.token]));
   await ageTickets();
  }
  assert.equal(new Set(served).size,3,'a successful large-account backlog and earlier new work cannot restart the cursor');
  assert.equal(await cursor(),id(1090));
  assert.equal(await v('select count(distinct thread_id) from icash_text_messages'),66);
  await resetChecks();assert.equal(await scan(),null);assert.equal(await cursor(),null);
  assert((await scan())?.token);assert.equal(await cursor(),id(1),'earlier new work resumes after the same bounded sweep');
 });
 await isolated(async()=>{
  await q('update icash_text_threads set hours_allowed=true where id in($1,$2,$3)',[id(1),id(2),id(3)]);
  await q('update icash_text_threads set review_allowed=false where id=$1',[id(1)]);
  await q('update icash_text_threads set queue_allowed=false where id=$1',[id(2)]);
  assert((await scan())?.token);assert.equal(await cursor(),id(3),'failed final queue also advances without retrying or freezing the page');
  assert.equal(await v('select count(*) from icash_text_messages'),1);
 });
 for(const state of ['ready','dispatching','needs_review','accepted','delivered','received','cancelled'])await isolated(async()=>{
  await q('update icash_text_threads set hours_allowed=true where id in($1,$2)',[id(1),id(2)]);
  await q("insert into icash_text_messages values(gen_random_uuid(),null,$1,now(),$2,'incoming','saved original history')",[id(1),state]);
  assert((await scan())?.token);assert.equal(await cursor(),id(2),state+' or wrong/NULL-account history still excludes the thread');
 });
 for(const change of ['update icash_accounts set bot_paused=true','update icash_wallets set reserved_cents=balance_cents',"update icash_screening_jobs set completed_at=now()-interval '25 hours'",'update icash_text_threads set paused=true',"update icash_text_threads set permission_until=now()-interval '1 second'",'update icash_operating_budget set enabled=false'])await isolated(async()=>{
  await pg.exec('update icash_text_threads set hours_allowed=true;'+change);assert.equal(await scan(),null);assert.equal(await v('select count(*) from icash_text_messages'),0);
 });
 await isolated(async()=>{await pg.exec("insert into fixture_prior values('existing-priority')");assert.deepEqual(await scan(),{token:'existing-priority'});assert.equal(await cursor(),null);assert.equal(await checks(),0);});
 assert.equal(await v("select md5(string_agg(to_jsonb(w)::text,',' order by account_id)) from icash_wallets w"),originalHistory);
 for(const role of ['anon','authenticated']){
  assert.equal(await v("select has_schema_privilege($1,'icash_work_private','usage')",[role]),false);
  assert.equal(await v("select has_table_privilege($1,'icash_work_private.seller_opener_scan','select')",[role]),false);
  assert.equal(await v("select has_function_privilege($1,'icash_next_before_sms_inbound_campaign()','execute')",[role]),false);
 }
 assert.equal(await v("select has_table_privilege('service_role','icash_work_private.seller_opener_scan','delete')"),false);
 assert.equal(await v("select relrowsecurity from pg_class where oid='icash_work_private.seller_opener_scan'::regclass"),true);
 const filenames=readdirSync(new URL('../supabase/migrations',import.meta.url)).filter(x=>x.endsWith('_seller_opener_bounded_scan.sql'));assert.equal(filenames.length,1);assert.equal(read('supabase/migrations/'+filenames[0]),migration);
 console.log('Seller opener scan: reproduced 1024 unbounded checks, capped each scan at 32, persistent wrap and fair progress across later accounts, original gates/history/queue/one-use tickets intact. Offline only.');
}finally{await pg.close();}
