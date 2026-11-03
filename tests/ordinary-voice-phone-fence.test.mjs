// Actual captured issuer with synthetic guard boundaries; no provider requests.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const a=uid(1),b=uid(2),patch=read('config/ordinary-voice-phone-fence.sql');
const oldQuery=patch.match(/old_query text:=\$old\$([\s\S]*?)\$old\$/)[1],newQuery=patch.match(/new_query text:=\$new\$([\s\S]*?)\$new\$/)[1];
const isolated=async f=>{await q('begin');try{await f();}finally{await q('rollback');}};
const seed=async(n,account=a,age=100)=>{
 await q("insert into icash_contact_permissions(id,account_id,screening_id,contact_key,timezone,permission_until) values($1,$2,$3,$4,'open',now()+interval '1 hour')",[uid(n+10000),account,uid(n+20000),String(n)]);
 await q("insert into icash_voice_jobs(id,account_id,permission_id,due_at) values($1,$2,$3,now()-$4*interval '1 second')",[uid(n),account,uid(n+10000),age]);return uid(n);
};
const next=async()=>{const result=await one('select icash_issue_ready_voice_ticket()');return result?one('select voice_job_id from icash_automation_tickets where token=$1',[result.token]):null;};
const release=()=>q("update icash_voice_scheduler set last_dispatch_at=now()-interval '2 seconds'");
const guard=(id,kind)=>q('insert into fixture_guards values($1,$2)',[id,kind]);
try{
 await pg.exec(read('tests/fixtures/urgent-voice-source-gate-setup.sql'));
 await pg.exec(read('tests/fixtures/ordinary-voice-phone-instrumentation.sql'));
 await pg.exec(read('tests/fixtures/ordinary-voice-phone-before.sql'));
 await pg.exec('revoke all on function icash_issue_ready_voice_ticket() from public,anon,authenticated;grant execute on function icash_issue_ready_voice_ticket() to service_role;');
 for(const account of[a,b]){await q('insert into icash_accounts(id) values($1)',[account]);await q('insert into icash_wallets(account_id) values($1)',[account]);await q('insert into icash_voice_configs(account_id) values($1)',[account]);}
 const before=await one("select pg_get_functiondef('icash_issue_ready_voice_ticket()'::regprocedure)"),acl=await one("select proacl::text from pg_proc where oid='icash_issue_ready_voice_ticket()'::regprocedure");
 assert.equal(await one("select md5(pg_get_functiondef('icash_issue_ready_voice_ticket()'::regprocedure))"),'c74e1cd9d71c715923d185189e26b4c2');
 await pg.exec(patch);
 const after=await one("select pg_get_functiondef('icash_issue_ready_voice_ticket()'::regprocedure)");
 assert.equal(after,before.replace(oldQuery,newQuery),'Only ordinary query evaluation order changes; urgent branch, locks and writes remain exact');
 assert.equal(await one("select proacl::text from pg_proc where oid='icash_issue_ready_voice_ticket()'::regprocedure"),acl);
 const money=()=>one("select jsonb_build_object('wallets',(select jsonb_agg(to_jsonb(w) order by account_id) from icash_wallets w),'spend',(select jsonb_agg(to_jsonb(s) order by operation_key) from icash_operation_spend s))");
 const saved=await money();
 await isolated(async()=>{
  for(let n=100;n<260;n++){const id=await seed(n);await guard(id,'phone');await guard(id,'explode_slot');}
  await q('alter sequence fixture_slot_checks restart with 1');
  for(const mode of['force_custom_plan','force_generic_plan']){await q('set local plan_cache_mode='+mode);assert.equal(await next(),null);}
  assert.equal(await one('select is_called from fixture_slot_checks'),false,'Rejected phones never reach capacity');
  const late=await seed(1000,b,1);assert.equal(await next(),late,'No early prefix limit can starve later eligible work');
  assert.equal(await one('select last_value from fixture_slot_checks'),1);
 });
 await isolated(async()=>{const blocked=await seed(100),allowed=await seed(101,b);await guard(blocked,'capacity');assert.equal(await next(),allowed,'Current unknown/capacity hold still blocks a phone-eligible job');});
 await isolated(async()=>{const old=await seed(100,a,1000),overdue=await seed(101,b,10);await q("insert into icash_automation_tickets(account_id,kind,created_at) values($1,'voice_dispatch',now()-interval '5 minutes')",[a]);assert.equal(await next(),overdue);await release();assert.equal(await next(),old,'Ordinary account fairness and due ordering remain');});
 await isolated(async()=>{await seed(100,a,1000);const urgent=await seed(101,b,1);await q('update icash_voice_jobs set sms_source_message_id=$2 where id=$1',[urgent,uid(301)]);assert.equal(await next(),urgent,'Urgent requests preserve priority');});
 for(const condition of['Pause','reserved','disabled','expired','hours','capacity','phone'])await isolated(async()=>{
  const id=await seed(100);
  if(condition==='Pause')await q('update icash_accounts set bot_paused=true');
  else if(condition==='reserved')await q('update icash_wallets set reserved_cents=balance_cents');
  else if(condition==='disabled')await q('update icash_voice_configs set enabled=false');
  else if(condition==='expired')await q("update icash_contact_permissions set permission_until=now()-interval '1 second'");
  else if(condition==='hours')await q("update icash_contact_permissions set timezone='closed'");
  else await guard(id,condition);
  assert.equal(await next(),null,condition+' remains blocked');
 });
 assert.deepEqual(await money(),saved,'Original money and hold receipts are untouched');
 const migrations=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(n=>n.endsWith('_ordinary_voice_phone_fence.sql'));
 assert.equal(migrations.length,1);assert.equal(patch,read('supabase/migrations/'+migrations[0]));
 await assert.rejects(pg.exec(patch),/Ordinary voice phone fence prerequisite changed/);await q('rollback');
 assert.equal(await one("select pg_get_functiondef('icash_issue_ready_voice_ticket()'::regprocedure)"),after);
 console.log('PASS ordinary phone-first fence: blocked-phone backlog skips capacity; late eligible work, original holds, urgent priority, ordinary fairness, guards, locks, ACL and financial records preserved.');
}finally{await pg.close();}
