// Real original issuer/lane sources; only their existing dependencies use
// fictional local fixtures. No hosted database or provider requests occur.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const originals=JSON.parse(read('tests/fixtures/voice-cooldown-before.json'));
const migration=read('config/voice-cooldown-poll.sql');
const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(p=>p.endsWith('_voice_cooldown_poll.sql'));
assert.equal(files.length,1);assert.equal(read('supabase/migrations/'+files[0]),migration);
const native=!!process.env.ICASH_PG_MODULE;
const connection={host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_voice_cooldown',application_name:'voice-cooldown-fixture',connectionTimeoutMillis:5000};
let pg,Client;
if(native){
 ({Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE));const client=new Client(connection);await client.connect();
 assert.equal(client.connection.stream.remoteAddress,'127.0.0.1');assert.equal(client.connection.stream.remotePort,55443);
 assert.equal((await client.query('select current_database() db')).rows[0].db,connection.database);
 assert.equal((await client.query("select count(*)::int n from pg_tables where schemaname='public' or schemaname like 'icash_%'")).rows[0].n,0,'Only an empty isolated fixture database');
 await client.query("set statement_timeout='10s';set lock_timeout='3s'");
 pg={query:(sql,args)=>client.query(sql,args),exec:sql=>client.query(sql),close:()=>client.end()};
}else {const {PGlite}=await import('@electric-sql/pglite');pg=await PGlite.create();}
const q=(sql,args=[])=>pg.query(sql,args),val=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const install=()=>pg.exec('begin;\n'+migration+'\ncommit;');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const primitiveState=()=>val("select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p where p.oid in ('icash_next_automation_lane(text)'::regprocedure,'icash_issue_ready_voice_ticket()'::regprocedure,'icash_queue_voice_jobs()'::regprocedure)");
const poll=()=>val('select public.icash_poll_voice_ticket()');
const queueCount=()=>val('select (case when is_called then last_value else 0 end)::integer from fixture_queue_calls');
try{
 const setup=read('tests/fixtures/urgent-voice-source-gate-setup.sql').replace('create role anon;create role authenticated;create role service_role;',()=>`do $$begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
 end $$;`);
 await pg.exec(setup);
 await pg.exec('create schema icash_work_private;create table icash_work_private.dispatch_policy(id integer primary key,enabled boolean);insert into icash_work_private.dispatch_policy values(1,true);');
 await pg.exec('alter table icash_automation_tickets alter column token set default (gen_random_uuid()::text||gen_random_uuid()::text)');
 for(const f of originals)await pg.exec(f.definition);
 await pg.exec('revoke all on all functions in schema public from public,anon,authenticated;grant execute on all functions in schema public to service_role;');
 for(const f of originals)assert.equal(await val('select md5(pg_get_functiondef($1::regprocedure))',[f.signature]),f.hash);
 const before=await primitiveState();
 await pg.exec('grant execute on function icash_next_automation_lane(text) to authenticated');
 await assert.rejects(()=>install(),/prerequisite changed/);await pg.exec('rollback;');
 await pg.exec('revoke execute on function icash_next_automation_lane(text) from authenticated');
 await pg.exec('alter function icash_issue_ready_voice_ticket() stable');
 await assert.rejects(()=>install(),/prerequisite changed/);await pg.exec('rollback;');
 await pg.exec('alter function icash_issue_ready_voice_ticket() volatile');
 const issuer=originals.find(f=>f.signature==='icash_issue_ready_voice_ticket()');
 await pg.exec(issuer.definition.replace('begin','begin\n -- Source drift'));
 await assert.rejects(()=>install(),/prerequisite changed/);await pg.exec('rollback;');await pg.exec(issuer.definition);
 assert.deepEqual(await primitiveState(),before);
 await install();assert.deepEqual(await primitiveState(),before,'All three original OIDs, definitions and every pg_proc field remain identical');
 await assert.rejects(()=>install(),/already exists/);await pg.exec('rollback;');
 const newMetadata=await val("select jsonb_build_object('definer',prosecdef,'volatile',provolatile,'path',proconfig,'acl',proacl::text,'owner',pg_get_userbyid(proowner)) from pg_proc where oid='icash_poll_voice_ticket()'::regprocedure");
 const installedHash=await val("select md5(pg_get_functiondef('icash_poll_voice_ticket()'::regprocedure))");
 assert.deepEqual(newMetadata,{definer:true,volatile:'v',path:['search_path=""'],acl:'{postgres=X/postgres,service_role=X/postgres}',owner:'postgres'});
 for(const role of ['anon','authenticated'])assert.equal(await val("select has_function_privilege($1,'icash_poll_voice_ticket()','execute')",[role]),false);
 assert.equal(await val("select has_function_privilege('service_role','icash_poll_voice_ticket()','execute')"),true);
 const originalSpend=await val('select jsonb_agg(to_jsonb(s) order by operation_key) from icash_operation_spend s');
 // Only queue preparation is instrumented after proving the real migration
 // preserves it. Actual original issuer/lane functions stay loaded unchanged.
 await pg.exec("create sequence fixture_queue_calls;create or replace function icash_queue_voice_jobs() returns void language plpgsql set search_path='' as $$begin perform nextval('public.fixture_queue_calls');end$$;");
 const assertHint=hint=>{assert.deepEqual(Object.keys(hint).sort(),['retryAfterMs','status']);assert.equal(hint.status,'voice_cooldown');assert(Number.isInteger(hint.retryAfterMs)&&hint.retryAfterMs>=100&&hint.retryAfterMs<=1100);};
 for(const age of ['0 milliseconds','500 milliseconds','999 milliseconds','1 second']){
  await pg.exec('begin');await q('update icash_voice_scheduler set last_dispatch_at=now()-$1::interval',[age]);const count=await queueCount();
  const hint=await poll();assertHint(hint);assert.equal(hint.retryAfterMs,age==='0 milliseconds'?1025:age==='500 milliseconds'?525:100);
  assert.equal(await queueCount(),count,'Cooldown never prepares the queue or scans candidates');
  assert.equal(await val('select count(*)::integer from icash_automation_tickets'),0);await pg.exec('rollback');
 }
 await pg.exec("begin;update icash_voice_scheduler set last_dispatch_at=now()+interval '1 second'");
 assert.equal(await poll(),null);assert.equal(await queueCount(),0,'Future timestamp does not repeat a short wait');await pg.exec('rollback');
 await pg.exec('begin;delete from icash_voice_scheduler');assert.equal(await poll(),null);assert.equal(await queueCount(),0);await pg.exec('rollback');
 await pg.exec('begin;update icash_work_private.dispatch_policy set enabled=false');assert.equal(await poll(),null);assert.equal(await queueCount(),0);await pg.exec('rollback');
 await pg.exec('begin;update icash_voice_scheduler set last_dispatch_at=now()');
 assert.equal(await val("select public.icash_next_automation_lane('voice')"),null,'Old worker contract remains null during cooldown');
 assert.equal(await queueCount(),1,'Old worker retains its original queue behavior');await pg.exec('rollback');
 await pg.exec("begin;update icash_voice_scheduler set last_dispatch_at=now()-interval '1001 milliseconds'");
 assert.equal(await poll(),null,'A genuinely empty eligible queue remains null');assert.equal(await queueCount(),2);await pg.exec('rollback');
 await pg.exec('update icash_voice_scheduler set last_dispatch_at=now()');
 const prepared=await queueCount();await pg.exec('begin read only');assertHint(await poll());await pg.exec('rollback');
 assert.equal(await queueCount(),prepared,'A hint is safe inside an actual read-only transaction');
 await pg.exec('update icash_voice_scheduler set last_dispatch_at=null');assert.equal(await poll(),null);
 assert.equal(await queueCount(),prepared+1,'An existing never-used singleton delegates; only a missing row fails closed');
 for(let n=1;n<=4;n++){
  await q('insert into icash_accounts(id) values($1)',[id(n)]);await q('insert into icash_wallets(account_id) values($1)',[id(n)]);await q('insert into icash_voice_configs(account_id) values($1)',[id(n)]);
  await q("insert into icash_contact_permissions(id,account_id,screening_id,contact_key,timezone,permission_until) values($1,$2,$3,$4,'open',now()+interval '1 day')",[id(100+n),id(n),id(200+n),'contact-'+n]);
  await q("insert into icash_voice_jobs(id,account_id,permission_id,due_at) values($1,$2,$3,now()-interval '1 hour')",[id(300+n),id(n),id(100+n)]);
 }
 // All original eligibility gates still decide the first real ticket.
 await pg.exec("update icash_accounts set bot_paused=true;update icash_voice_scheduler set last_dispatch_at=null");assert.equal(await poll(),null);
 await pg.exec('update icash_accounts set bot_paused=false;update icash_wallets set balance_cents=0');assert.equal(await poll(),null);
 await pg.exec("update icash_wallets set balance_cents=10000;update icash_contact_permissions set timezone='closed'");assert.equal(await poll(),null);
 await pg.exec("update icash_contact_permissions set timezone='open';insert into fixture_guards select id,'phone' from icash_voice_jobs");assert.equal(await poll(),null);
 await pg.exec("update fixture_guards set kind='capacity'");assert.equal(await poll(),null);await pg.exec('truncate fixture_guards');
 await pg.exec('begin');const first=await poll();assert.match(first.token,/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){2}$/);assertHint(await poll());
 assert.equal(await val("select public.icash_next_automation_lane('voice')"),null,'Old/new callers share the unchanged one-second gate');
 assert.equal(await val('select count(*)::integer from icash_automation_tickets'),1);await pg.exec('commit');
 if(native){
  const locker=new Client(connection);await locker.connect();
  try{
   await locker.query('begin;select pg_advisory_xact_lock(726341927)');const count=await queueCount();
   assert.equal(await poll(),null,'Real lock contention stays ordinary idle, never cooldown');assert.equal(await queueCount(),count);
  }finally{await locker.query('rollback');await locker.end();}
  await pg.exec("truncate icash_automation_tickets;update icash_voice_jobs set state='ready';update icash_voice_scheduler set last_dispatch_at=null");
  const clients=await Promise.all(Array.from({length:24},async()=>{const c=new Client(connection);await c.connect();return c;}));
  try{
   // Freeze all transaction clocks before the shared claim barrier. Keep the
   // winner's original advisory lock until every contender has answered, so
   // slow CI cannot accidentally test a second legitimate one-second window.
   await Promise.all(clients.map(c=>c.query('begin;set local role service_role')));
   const results=await Promise.all(clients.map(async(c,i)=>(await c.query(i%2?"select public.icash_next_automation_lane('voice') result":'select public.icash_poll_voice_ticket() result')).rows[0].result));
   assert.equal(results.filter(r=>r?.token).length,1,'Mixed old/new concurrent calls issue one original, not duplicate tickets');
   await Promise.all(clients.map(c=>c.query('commit')));
   assert.equal(await val('select count(*)::integer from icash_automation_tickets'),1);
   results.filter(r=>r?.status).forEach(assertHint);
  }finally{await Promise.all(clients.map(async c=>{try{await c.query('rollback');}finally{await c.end();}}));}
 }
 assert.deepEqual(await val('select jsonb_agg(to_jsonb(s) order by operation_key) from icash_operation_spend s'),originalSpend,'Unknown and settled originals are untouched');
 for(const f of originals.filter(f=>f.signature!=='icash_queue_voice_jobs()'))assert.equal(await val('select md5(pg_get_functiondef($1::regprocedure))',[f.signature]),f.hash);
 console.log('PASS additive voice cooldown: source/ACL/metadata guards, untouched original issuer/lane, tokenless bounded hints, no queue work on cooldown, ordinary empty/held/clock/policy behavior, original controls and mixed one-use issuance. Native:',native,'RPC MD5:',installedHash);
}finally{await pg.close();}
