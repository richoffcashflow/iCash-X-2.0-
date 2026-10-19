import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('config/voice-queue-prior-route-scan.sql');
const db=new PGlite(),q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const uid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,account=uid(1),other=uid(2);
const head=sql.match(/original_head text:=\$head\$([\s\S]*?)\$head\$/)[1];
const newHead=sql.match(/replacement_head text:=\$new_head\$([\s\S]*?)\$new_head\$/)[1];
const routes=sql.match(/original_routes text:=\$routes\$([\s\S]*?)\$routes\$/)[1];
const newRoutes=sql.match(/replacement_routes text:=\$new_routes\$([\s\S]*?)\$new_routes\$/)[1];
try{
await db.exec(`
create role anon;create role authenticated;create role service_role;
create table icash_operating_budget(id int primary key);insert into icash_operating_budget values(1);
create table icash_accounts(id uuid primary key,bot_paused bool default false);
create table icash_voice_configs(account_id uuid primary key,enabled bool default true,reviewed_until timestamptz default now()+interval '1 day');
create table icash_screening_jobs(id uuid primary key,account_id uuid,state text default 'complete',result jsonb default '{"financialCheck":{"status":"eligible"}}');
create table icash_dnc_verification_receipts(id uuid primary key,evidence_kind text default 'national_provider_observation');
create table icash_operational_contacts(id uuid primary key,account_id uuid,screening_id uuid,channel text default 'voice',phone text,contact_key text,dnc_receipt_id uuid,eligibility_until timestamptz default now()+interval '1 day',created_at timestamptz default now(),revoked_at timestamptz);
create index contact_scope on icash_operational_contacts(account_id,screening_id,channel);
create table icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid,phone text,contact_key text);
create table icash_outreach_campaigns(account_id uuid primary key,mode text);
create table icash_voice_jobs(id uuid primary key default gen_random_uuid(),account_id uuid,permission_id uuid,operational_contact_id uuid,callback_id uuid,due_at timestamptz default now(),state text default 'ready',outcome text);
create unique index first_once on icash_voice_jobs(operational_contact_id) where callback_id is null;
create unique index callback_once on icash_voice_jobs(callback_id) where callback_id is not null;
create sequence fixture_route_visits;
create function fixture_route_id(value uuid) returns uuid language plpgsql volatile as $$begin perform nextval('public.fixture_route_visits');return value;end$$;
-- Only instrument the view's identity projection to count route traversal.
-- Both branches and the operational receipt/channel membership match production.
create view icash_voice_contact_targets as
 select fixture_route_id(id) id,account_id,screening_id,contact_key from icash_contact_permissions
 union all select fixture_route_id(c.id),c.account_id,c.screening_id,c.contact_key
 from icash_operational_contacts c join icash_dnc_verification_receipts d on d.id=c.dnc_receipt_id where c.channel='voice';
create table icash_live_conversations(id uuid primary key,account_id uuid,state text,party text,result jsonb,contact_key text);
create table icash_live_callbacks(id uuid primary key,account_id uuid,conversation_id uuid,screening_id uuid,state text,due_at timestamptz);
create table fixture_checks(contact_id uuid primary key,account_id uuid,allowed boolean);
create table fixture_calls(contact_id uuid);
create function icash_prepare_operational_contacts() returns int language sql as $$select 0$$;
create function icash_queue_voice_jobs_before_operational() returns void language plpgsql as $$begin end$$;
create function icash_outreach_voice_current(uuid) returns bool language sql stable set search_path=public as $$select exists(select 1 from icash_accounts where id=$1 and not bot_paused)$$;
create function icash_operational_contact_current(uuid,uuid,text,boolean) returns bool language plpgsql set search_path=public as $$begin insert into fixture_calls values($2);return exists(select 1 from fixture_checks where contact_id=$2 and account_id=$1 and allowed) and $3='voice' and $4=false;end$$;
`);
await q('insert into icash_accounts(id) values($1),($2)',[account,other]);
await q('insert into icash_voice_configs(account_id) values($1),($2)',[account,other]);
await db.exec(read('tests/fixtures/voice-queue-before-candidate-fence.sql'));
await db.exec(read('config/voice-queue-candidate-fence.sql'));
await db.exec('revoke all on function icash_queue_voice_jobs() from public,anon,authenticated;grant execute on function icash_queue_voice_jobs() to service_role;');
const original=await v("select pg_get_functiondef('icash_queue_voice_jobs()'::regprocedure)");
const validator=await v("select pg_get_functiondef('icash_operational_contact_current(uuid,uuid,text,boolean)'::regprocedure)");
const cheap=definition=>definition.match(/for c in ([\s\S]*?)\n \) select op\.\* from candidates op/)[1]+'\n ) select id from candidates order by id';
const oldSelect=cheap(original),newSelect=cheap(original.replace(head,newHead).replace(routes,newRoutes));
const add=async(n,{a=account,allowed=true,age=0,queued=false,state='held'}={})=>{
 const id=uid(n),phone='+1214'+String(n).padStart(7,'0');
 await q('insert into icash_screening_jobs(id,account_id) values($1,$2)',[id,a]);
 await q('insert into icash_dnc_verification_receipts(id) values($1)',[id]);
 await q("insert into icash_operational_contacts(id,account_id,screening_id,phone,contact_key,dnc_receipt_id,created_at) values($1,$2,$1,$3,$3,$1,now()-$4*interval '1 second')",[id,a,phone,age]);
 await q('insert into fixture_checks values($1,$2,$3)',[id,a,allowed]);
 if(queued)await q("insert into icash_voice_jobs(account_id,operational_contact_id,state,outcome) values($1,$2,$3,'provider_outcome_unknown_no_retry')",[a,id,state]);
 return id;
};
for(let n=100;n<300;n++)await add(n,{queued:true,age:1000,state:['ready','held','cancelled','failed','complete'][n%5]});
const fresh=await add(1000);
await db.exec('analyze');
await q("select setval('fixture_route_visits',1,false)");
const beforeRows=(await q(oldSelect)).rows, beforeVisits=Number(await v('select last_value from fixture_route_visits'));
await q("select setval('fixture_route_visits',1,false)");
const afterRows=(await q(newSelect)).rows,afterVisits=Number(await v('select last_value from fixture_route_visits'));
assert.deepEqual(afterRows,beforeRows);assert.deepEqual(afterRows,[{id:fresh}]);
assert(afterVisits<beforeVisits/10,`existing route traversal drops: ${beforeVisits} -> ${afterVisits}`);
const saved=await v("select md5(string_agg(id::text||':'||state||':'||outcome,',' order by id)) from icash_voice_jobs");
await db.exec(sql);
assert.equal(await v("select pg_get_functiondef('icash_queue_voice_jobs()'::regprocedure)"),original.replace(head,newHead).replace(routes,newRoutes),'only the exact two query fragments change; callbacks and final locked checks stay exact');
assert.equal(await v("select pg_get_functiondef('icash_operational_contact_current(uuid,uuid,text,boolean)'::regprocedure)"),validator);
assert(!newHead.toLowerCase().includes('limit'),'no earlier limit');
assert.equal(await v("select md5(string_agg(id::text||':'||state||':'||outcome,',' order by id)) from icash_voice_jobs"),saved);
// Equivalent routes still exclude regardless of job state, and preserve SQL NULL,
// tenant, property, contact-key, receipt and coalesce-priority semantics.
for(const [name,change,args,blocked] of [
 ['other account','update icash_voice_jobs set account_id=$1 where operational_contact_id=$2',[other,uid(100)],false],
 ['different property route','update icash_voice_jobs set operational_contact_id=$1 where operational_contact_id=$2',[fresh,uid(100)],false],
 ['callback only','update icash_voice_jobs set callback_id=$1 where operational_contact_id=$1',[uid(100)],false],
 ['missing receipt','delete from icash_dnc_verification_receipts where id=$1',[uid(100)],false],
 ['NULL contact key','update icash_operational_contacts set contact_key=null where id=$1',[uid(100)],false],
 ['permission priority','insert into icash_contact_permissions(id,account_id,screening_id,phone,contact_key) values($1,$2,$3,\'different\',\'different\');update icash_voice_jobs set permission_id=$1 where operational_contact_id=$3',[uid(5000),account,uid(100)],false]
 ]){
  await q('begin');
  // q handles parameterized single statements; this coalesce case needs two.
  if(name==='permission priority'){
   await q("insert into icash_contact_permissions(id,account_id,screening_id,phone,contact_key) values($1,$2,$3,'different','different')",args);
   await q('update icash_voice_jobs set permission_id=$1 where operational_contact_id=$2',[args[0],args[2]]);
  }else await q(change,args);
  const oldRows=(await q(oldSelect)).rows,newRows=(await q(newSelect)).rows;
  assert.deepEqual(newRows,oldRows,name);assert.equal(newRows.some(r=>r.id===uid(100)),!blocked,name);
  await q('rollback');
 }
// A legacy permission on the same route excludes without requiring matching IDs.
await q('begin');
await q('insert into icash_contact_permissions(id,account_id,screening_id,phone,contact_key) select $1,account_id,screening_id,\'different\',contact_key from icash_operational_contacts where id=$2',[uid(5001),fresh]);
await q('insert into icash_voice_jobs(account_id,permission_id,state) values($1,$2,\'cancelled\')',[account,uid(5001)]);
assert.deepEqual((await q(newSelect)).rows,(await q(oldSelect)).rows);assert.equal((await q(newSelect)).rows.some(r=>r.id===fresh),false);
await q('rollback');
// Candidates are one statement snapshot; the original final duplicate check
// must still stop a second matching route inserted earlier in this same loop.
await q('begin');
await q('insert into icash_operational_contacts select $1,account_id,screening_id,channel,phone,contact_key,dnc_receipt_id,eligibility_until,created_at,revoked_at from icash_operational_contacts where id=$2',[uid(6000),fresh]);
await q('insert into fixture_checks values($1,$2,true)',[uid(6000),account]);
await q('select icash_queue_voice_jobs()');
assert.equal(Number(await v('select count(*) from icash_voice_jobs where operational_contact_id in ($1,$2)',[fresh,uid(6000)])),1,'final locked route exclusion handles same-batch duplicates');
await q('rollback');
await q('select icash_queue_voice_jobs()');
assert.equal(Number(await v('select count(*) from fixture_calls')),2,'new candidate still has admission and final locked validation');
await db.exec('truncate fixture_calls');await q('select icash_queue_voice_jobs()');assert.equal(Number(await v('select count(*) from fixture_calls')),0,'existing unknown jobs never revalidated');
// Every eligibility check still precedes LIMIT 100, including later accounts.
for(let n=2000;n<2120;n++)await add(n,{allowed:false,age:500});
const later=await add(2200,{a:other});await q('select icash_queue_voice_jobs()');
assert.equal(Number(await v('select count(*) from icash_voice_jobs where operational_contact_id=$1',[later])),1);
await q('begin');await db.exec('update icash_accounts set bot_paused=true;truncate fixture_calls');await q('select icash_queue_voice_jobs()');assert.equal(Number(await v('select count(*) from fixture_calls')),0);await q('rollback');
assert.equal(await v("select md5(string_agg(id::text||':'||state||':'||outcome,',' order by id)) from icash_voice_jobs where operational_contact_id not in ($1,$2)",[fresh,later]),saved,'all existing jobs stay exact');
for(const role of ['anon','authenticated'])assert.equal(await v("select has_function_privilege($1,'icash_queue_voice_jobs()','execute')",[role]),false);
assert.equal(await v("select has_function_privilege('service_role','icash_queue_voice_jobs()','execute')"),true);
await assert.rejects(db.exec(sql),/Voice queue prior-route prerequisite changed/);await db.exec('rollback');
assert.equal(sql,read('supabase/migrations/20261019185813_voice_queue_prior_route_scan.sql'));
console.log(`Prior-route materialization: ${beforeVisits} -> ${afterVisits} route visits, same candidates; account/property/key/NULL/coalesce/receipt and held/cancelled exclusion, late-account admission, Pause, unchanged validators/callbacks/locked checks/ACLs all pass.`);
}catch(error){console.error(error.message,error.where??'');process.exitCode=1;}finally{await db.close();}
