// Offline only. Actual captured issuer; no provider transport or live data.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const a=id(1),b=id(2),baseline=read('tests/fixtures/urgent-voice-issuer-before.sql'),patch=read('config/urgent-voice-source-gate.sql');
const guard=' and (v.sms_source_message_id is not null or v.callback_id is not null or v.cancellation_notice_id is not null)\n';
const isolate=async f=>{await pg.exec('begin');try{await f();}finally{await pg.exec('rollback');}};
const add=async(n,account=a,source='ordinary',age=100)=>{
 const j=id(n),t=id(n+100000),s=id(n+200000);
 await q("insert into icash_contact_permissions(id,account_id,screening_id,contact_key,timezone,permission_until) values($1::uuid,$2,$3,($1::uuid)::text,'open',now()+interval '1 hour')",[t,account,s]);
 await q("insert into icash_voice_jobs(id,account_id,permission_id,due_at) values($1,$2,$3,now()-$4*interval '1 second')",[j,account,t,age]);
 if(source==='request')await q('update icash_voice_jobs set sms_source_message_id=$2 where id=$1',[j,id(n+300000)]);
 if(source==='cancellation')await q('update icash_voice_jobs set cancellation_notice_id=$2 where id=$1',[j,id(n+300000)]);
 if(source==='callback'){
  const cb=id(n+300000),call=id(n+400000);
  await q('update icash_voice_jobs set callback_id=$2 where id=$1',[j,cb]);
  await q("insert into icash_live_callbacks select $2,account_id,$3,$4,'pending_dispatch_review',due_at from icash_voice_jobs where id=$1",[j,cb,s,call]);
  await q("insert into icash_live_conversations select $2,account_id,$3,$4,'seller','complete',jsonb_build_object('human',true,'callbackDueAt',due_at),now()-interval '10 minutes' from icash_voice_jobs where id=$1",[j,call,s,t]);
 }
 return j;
};
const next=async()=>{const x=await one('select icash_issue_ready_voice_ticket()');return x?one('select voice_job_id from icash_automation_tickets where token=$1',[x.token]):null;};
const release=()=>pg.exec("update icash_voice_scheduler set last_dispatch_at=now()-interval '2 seconds'");
try{
 await pg.exec(read('tests/fixtures/urgent-voice-source-gate-setup.sql'));
 for(const account of [a,b]){await q('insert into icash_accounts(id) values($1)',[account]);await q('insert into icash_wallets(account_id) values($1)',[account]);await q('insert into icash_voice_configs(account_id) values($1)',[account]);}
 await pg.exec(baseline);
 assert.equal(await one("select md5(pg_get_functiondef('icash_issue_ready_voice_ticket()'::regprocedure))"),'5d1f4bb69ab6e0e49eb49b3cc9fdce54');
 await pg.exec('revoke all on function icash_issue_ready_voice_ticket() from public,anon,authenticated;grant execute on function icash_issue_ready_voice_ticket() to service_role;');
 const before=await one("select pg_get_functiondef('icash_issue_ready_voice_ticket()'::regprocedure)"),acl=await one("select proacl::text from pg_proc where oid='icash_issue_ready_voice_ticket()'::regprocedure");
 await pg.exec(patch);
 const after=await one("select pg_get_functiondef('icash_issue_ready_voice_ticket()'::regprocedure)");
 assert.equal(after.replace(guard,''),before,'Every original gate, lock, urgent ordering, ordinary fairness and mutation remains exact');
 assert.equal(after.split(guard).length,2,'Only the urgent scan gains the predicate');
 assert.equal(await one("select proacl::text from pg_proc where oid='icash_issue_ready_voice_ticket()'::regprocedure"),acl);
 const money=()=>one("select jsonb_build_object('wallets',(select jsonb_agg(to_jsonb(w) order by account_id) from icash_wallets w),'spend',(select jsonb_agg(to_jsonb(s) order by operation_key) from icash_operation_spend s))");
 const financialBefore=await money();
 await isolate(async()=>{
  await pg.exec(`insert into icash_contact_permissions(id,account_id,screening_id,contact_key,timezone,permission_until)
   select md5('p'||n)::uuid,'${a}',md5('s'||n)::uuid,n::text,'closed',now()+interval '1 hour' from generate_series(1,1000)n;
   insert into icash_voice_jobs(id,account_id,permission_id,due_at) select md5('j'||n)::uuid,'${a}',md5('p'||n)::uuid,now()-interval '1 hour' from generate_series(1,1000)n;
   analyze icash_voice_jobs;analyze icash_contact_permissions;alter sequence fixture_window_checks restart with 1;`);
  const urgent=after.slice(after.indexOf(' select candidate.* into j'),after.indexOf(' limit 1;')+9).replace('into j ','').replace('for update of v skip locked ','').replaceAll('capacity_snapshot',"'{}'::jsonb");
  assert.equal((await q(urgent)).rows.length,0);
  assert.equal(await one('select is_called from fixture_window_checks'),false,'Ordinary backlog never invokes urgent contact/window checks');
  const request=await add(5000,b,'request');assert.equal(await next(),request,'A valid urgent request beyond a large ordinary backlog progresses');
 });
 for(const source of ['request','callback','cancellation'])await isolate(async()=>{const later=await add(100,a,source,20),earlier=await add(101,b,source,40);assert.equal(await next(),earlier);await release();assert.equal(await next(),later);});
 await isolate(async()=>{await add(100,a,'ordinary',5000);const urgent=await add(101,b,'callback',20);assert.equal(await next(),urgent,'Validated urgent work retains priority over older ordinary work');});
 await isolate(async()=>{const old=await add(100,a,'ordinary',5000),overdue=await add(101,b,'ordinary',10);await q("insert into icash_automation_tickets(account_id,kind,created_at) values($1,'voice_dispatch',now()-interval '5 minutes')",[a]);assert.equal(await next(),overdue,'Ordinary account fairness remains authoritative');await release();assert.equal(await next(),old);});
 for(const condition of ['pause','reserved','source_expired','hours','capacity','phone'])await isolate(async()=>{
  const j=await add(100,a,'request');
  if(condition==='pause')await pg.exec('update icash_accounts set bot_paused=true');
  else if(condition==='reserved')await pg.exec('update icash_wallets set reserved_cents=balance_cents');
  else if(condition==='source_expired')await pg.exec("update icash_contact_permissions set permission_until=now()-interval '1 second'");
  else if(condition==='hours')await pg.exec("update icash_contact_permissions set timezone='closed'");
  else await q('insert into fixture_guards values($1,$2)',[j,condition]);
  assert.equal(await next(),null,condition+' remains blocked in both branches');
 });
 assert.deepEqual(await money(),financialBefore);
 const migrations=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(n=>n.endsWith('_urgent_voice_source_gate.sql'));
 assert.equal(migrations.length,1,'One canonical migration; no duplicate replay aliases');
 assert.equal(patch,read('supabase/migrations/'+migrations[0]));
 await assert.rejects(pg.exec(patch),/Urgent voice source gate prerequisite changed/);await pg.exec('rollback');
 assert.equal(await one("select pg_get_functiondef('icash_issue_ready_voice_ticket()'::regprocedure)"),after,'Unknown/repeated migration fails without partial changes');
 console.log('PASS urgent voice source gate: 1000 ordinary jobs skip expensive urgent checks; all three urgent sources, due ordering, ordinary-account fairness, original guards/locks/ACL and finances preserved. Offline only.');
}finally{await pg.close();}
