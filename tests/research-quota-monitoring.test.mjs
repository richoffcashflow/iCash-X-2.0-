// Exercise the production incoming/account snapshot wrapper and local limiter
// observations in isolated PostgreSQL. No provider calls or counter resets.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {reliabilitySchema} from '../lib/reliability.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0])[0];
const refresh=()=>one('select icash_refresh_account_work_snapshot()');
const parse=snapshot=>reliabilitySchema.parse({status:snapshot.issueCount?'degraded':'ok',fresh:true,
 components:{worker:{status:'ok',checkedAt:snapshot.checkedAt},maintenance:{status:'ok',checkedAt:snapshot.checkedAt}},snapshot}).snapshot;
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create schema icash_research_private;create schema icash_reliability_private;
 create table icash_dealmachine_request_budget(id int primary key,minute_start timestamptz,minute_used int,minute_limit int,day_start timestamptz,day_used int,day_limit int);
 insert into icash_dealmachine_request_budget values(1,now()-interval '2 minutes',4,60,now()-interval '10 hours',9800,9800);
 create table icash_research_private.quota_feedback(id int primary key,request_started_at timestamptz,observed_at timestamptz,headers jsonb,blocked_until timestamptz);
 insert into icash_research_private.quota_feedback values(1,now()-interval '6 hours',now()-interval '6 hours','{"dayLimit":10000,"dayRemaining":9917}',null);
 create table icash_reliability_private.snapshots(id int primary key,checked_at timestamptz,report jsonb);
 create table fixture_base(issue_count int);insert into fixture_base values(3);
 create function public.icash_refresh_account_work_snapshot() returns jsonb language plpgsql set search_path='' as $$declare r jsonb;begin
  r:=jsonb_build_object('checkedAt',now(),'issueCount',(select issue_count from public.fixture_base),'issues','[]'::jsonb,
   'texts',jsonb_build_object('accepted',0,'delivered',0,'review',0),'contracts',jsonb_build_object('created',0,'completed',0,'review',0));
  insert into icash_reliability_private.snapshots values(1,now(),r) on conflict(id) do update set checked_at=now(),report=excluded.report;return r;
 end$$;
 create function public.icash_owner_text_health(uuid) returns jsonb language sql stable set search_path='' as $$select jsonb_build_object('checkedAt',now(),'lines','[]'::jsonb)$$;`);
 await pg.exec(read('config/incoming-text-reliability.sql'));
 assert.equal(await one("select md5(pg_get_functiondef('public.icash_refresh_account_work_snapshot()'::regprocedure))"),'73dae59d66460dddd1ab6c77c7286341','use the actual current monitor prerequisite');
 const before=await one('select to_jsonb(b) from icash_dealmachine_request_budget b');
 await pg.exec(read('config/research-quota-monitoring.sql'));
 let report=parse(await refresh());
 assert.equal(report.researchQuota.status,'day_exhausted');
 assert.equal(report.researchQuota.dayUsed,9800);assert.equal(report.researchQuota.dayRemaining,0);
 assert.equal(report.researchQuota.minuteUsed,0);assert.equal(report.researchQuota.minuteRemaining,60);
 assert.equal(report.researchQuota.providerDayRemaining,9917,'provider observations remain separate from the local counter');
 assert.equal(report.researchQuota.nextAvailableAt,report.researchQuota.dayResetsAt);
 assert.equal(report.issueCount,4,'a daily research stop cannot hide behind healthy processes');
 assert.equal(parse(await refresh()).issueCount,4,'repeated refresh cannot inflate warnings');
 assert.deepEqual(await one('select to_jsonb(b) from icash_dealmachine_request_budget b'),before,'installation and monitoring never mutate counters');

 // Use the original scheduler capacity predicate, not a synthetic admission.
 const capacity=read('config/provider-quota-scheduling.sql');
 await pg.exec(capacity.slice(capacity.indexOf('create function public.icash_dealmachine_capacity_available'),capacity.indexOf('alter function public.icash_outbound_search_due')));
 await pg.exec('update icash_dealmachine_request_budget set day_used=9799');
 const partial=await one('select to_jsonb(b) from icash_dealmachine_request_budget b');
 report=parse(await refresh());assert.equal(report.researchQuota.status,'day_insufficient');
 assert.equal(report.researchQuota.dayRemaining,1);assert.equal(report.issueCount,4);
 assert.equal(report.researchQuota.nextAvailableAt,report.researchQuota.dayResetsAt);
 assert.equal(await one('select icash_dealmachine_capacity_available()'),false,'One slot cannot admit ordinary research');
 assert.equal(await one('select icash_dealmachine_capacity_available(1)'),true,'Do not claim all free requests are blocked');
 assert.deepEqual(await one('select to_jsonb(b) from icash_dealmachine_request_budget b'),partial);
 await pg.exec('update icash_dealmachine_request_budget set day_used=9800');

 await pg.exec("update icash_dealmachine_request_budget set day_start=now()-interval '25 hours'");
 const expired=await one('select to_jsonb(b) from icash_dealmachine_request_budget b');
 report=parse(await refresh());assert.equal(report.researchQuota.status,'available');
 assert.equal(report.researchQuota.dayUsed,0);assert.equal(report.researchQuota.dayRemaining,9800);assert.equal(report.researchQuota.dayResetsAt,null);
 assert.equal(report.issueCount,3,'only the quota warning recovers; independent issues stay');
 assert.deepEqual(await one('select to_jsonb(b) from icash_dealmachine_request_budget b'),expired,'an elapsed window is calculated, never reset by the monitor');

 await pg.exec("update icash_dealmachine_request_budget set minute_start=now(),minute_used=59");
 report=parse(await refresh());assert.equal(report.researchQuota.status,'minute_insufficient');assert.equal(report.issueCount,3);
 assert.equal(await one('select icash_dealmachine_capacity_available()'),false);
 assert.equal(await one('select icash_dealmachine_capacity_available(1)'),true);
 assert.ok(report.researchQuota.nextAvailableAt);
 await pg.exec("update icash_dealmachine_request_budget set minute_start=now(),minute_used=60");
 report=parse(await refresh());assert.equal(report.researchQuota.status,'minute_exhausted');assert.equal(report.issueCount,3,'ordinary minute pacing is visible without an outage alert');
 assert.ok(report.researchQuota.nextAvailableAt);
 await pg.exec("update icash_research_private.quota_feedback set blocked_until=now()+interval '5 minutes'");
 report=parse(await refresh());assert.equal(report.researchQuota.status,'provider_hold');assert.equal(report.issueCount,4);
 assert.equal(report.researchQuota.nextAvailableAt,report.researchQuota.providerBlockedUntil,'the longest actual admission hold wins');

 const previous=report.researchQuota,definition=await one("select pg_get_functiondef('public.icash_research_quota_status()'::regprocedure)");
 await pg.exec("create or replace function public.icash_research_quota_status() returns jsonb language plpgsql stable security definer set search_path='' as $$begin raise exception 'fixture unavailable';end$$;update fixture_base set issue_count=7");
 report=parse(await refresh());assert.equal(report.researchQuota.fresh,false);assert.equal(report.researchQuota.status,'unavailable');
 assert.equal(report.researchQuota.checkedAt,previous.checkedAt);assert.equal(report.researchQuota.dayRemaining,previous.dayRemaining);
 assert.equal(report.issueCount,8,'a failed quota read preserves earlier data while independent monitoring advances');
 assert.equal(parse(await refresh()).issueCount,8);
 await pg.exec(definition);
 await pg.exec('delete from icash_research_private.quota_feedback');
 report=parse(await refresh());assert.equal(report.researchQuota.status,'unavailable');assert.equal(report.researchQuota.warningCount,1);
 assert.equal(report.researchQuota.dayUsed,undefined,'missing configuration cannot invent capacity');
 for(const role of ['anon','authenticated'])for(const name of ['icash_research_quota_status()','icash_refresh_account_work_snapshot()','icash_refresh_work_before_research_quota()']){
  assert.equal(await one('select has_function_privilege($1,$2,\'execute\')',[role,name]),false);
 }
 assert.equal(await one("select has_function_privilege('service_role','icash_research_quota_status()','execute')"),true);
 assert.equal(await one('select day_used from icash_dealmachine_request_budget'),9800,'even elapsed/failed observations preserve the original consumed count');
 console.log('PASS research quota exhaustion, reset visibility, provider holds, stale/read-failure preservation, existing incidents and private ACLs without counter mutation.');
}finally{await pg.close();}
