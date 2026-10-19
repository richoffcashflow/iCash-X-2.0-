import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {reliabilityAlertClaimSchema} from '../lib/reliability-alerts.ts';
const pg=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const one=async(sql,args=[])=>Object.values((await pg.query(sql,args)).rows[0])[0];
const report=(worker='ok',maintenance='ok',count=0)=>({status:worker!=='ok'||maintenance!=='ok'||count?'degraded':'ok',fresh:true,components:{worker:{status:worker},maintenance:{status:maintenance}},snapshot:{issueCount:count,issues:[]}});
const refresh=async(value)=>{await pg.query('update fixture_monitor set report=$1',[value]);await one("select icash_refresh_reliability_incident('ready')");};
const claim=async()=>{const value=await one('select icash_claim_reliability_notification_v2()');return value===null?null:reliabilityAlertClaimSchema.parse(value);};
const finish=async(value,provider='00000000-0000-4000-8000-000000000001')=>one('select icash_finish_reliability_notification($1,$2)',[value.id,provider]);
const active=()=>one('select to_jsonb(i) from icash_reliability_private.incidents i where recovered_at is null');
const reset=()=>pg.exec('truncate icash_reliability_private.incident_notifications,icash_reliability_private.incidents');
const elapsed=minutes=>pg.query("update icash_reliability_private.incidents set healthy_since=now()-$1::interval,last_observed_at=now()-interval '1 minute' where recovered_at is null",[`${minutes} minutes`]);
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema icash_reliability_private;grant usage on schema icash_reliability_private to service_role;
 create table public.icash_accounts(id uuid primary key,owner_user_id uuid);
 create table public.fixture_monitor(report jsonb);
 create function public.icash_reliability_status() returns jsonb language sql as $$select report from public.fixture_monitor limit 1$$;
 grant select,update on public.fixture_monitor to service_role;`);
 await pg.query('insert into fixture_monitor values($1)',[report('degraded')]);
 await pg.exec(read('config/workspace-experience-and-incidents.sql'));
 await pg.exec(read('config/reliability-incident-severity.sql'));
 // Upgrade an already-open, already-notified incident without replacing it.
 await refresh(report('degraded'));const first=await claim();await finish(first);
 const sql=read('config/reliability-incident-stable-recovery.sql');
 assert.equal(sql,read('supabase/migrations/20261019194638_reliability_incident_stable_recovery.sql'));
 await pg.exec(sql);
 assert.equal((await active()).id,first.incidentId);
 assert.deepEqual((await active()).seen_reasons,['worker']);
 for(let cycle=0;cycle<12;cycle++){
  await refresh(report());assert.equal(await claim(),null,'One healthy sample does not announce recovery');
  await refresh(report('degraded'));assert.equal(await claim(),null,'Recurring failure stays in the original incident');
  assert.equal((await active()).healthy_since,null);
 }
 assert.equal(await one('select count(*) from icash_reliability_private.incidents'),1);
 assert.equal(await one('select count(*) from icash_reliability_private.incident_notifications'),1);
 // Reasons can disappear and return without repeating an already-seen alert.
 await refresh(report('degraded','unavailable'));const newReason=await claim();assert.equal(newReason.incidentId,first.incidentId);await finish(newReason);
 await refresh(report('degraded'));await refresh(report('degraded','unavailable'));assert.equal(await claim(),null);
 // Continuous healthy observations, not merely elapsed wall time, are required.
 await refresh(report());await elapsed(14);await refresh(report());assert.equal(await claim(),null);
 await elapsed(16);await pg.exec("update icash_reliability_private.incidents set last_observed_at=now()-interval '4 minutes' where recovered_at is null");
 await refresh(report());assert.equal(await claim(),null,'A monitor gap restarts recovery evidence');
 assert.equal(await one("select healthy_since>now()-interval '1 minute' from icash_reliability_private.incidents where recovered_at is null"),true);
 await elapsed(16);await refresh(report());const recovered=await claim();assert.equal(recovered.event,'recovered');await finish(recovered);
 await refresh(report());assert.equal(await claim(),null,'Recovery sends once');
 assert.equal(await one('select count(*) from icash_reliability_private.incidents where recovered_at is null'),0);
 await refresh(report('degraded'));const later=await claim();assert.notEqual(later.incidentId,first.incidentId,'A new outage after stable recovery still alerts immediately');await finish(later);
 await reset();
 // Delayed detection cannot arrive during a recovery observation period.
 await refresh(report('degraded'));const pending=await one("select id from icash_reliability_private.incident_notifications where state='pending'");
 await refresh(report());assert.equal(await claim(),null);
 await refresh(report('degraded'));const resumed=await claim();assert.equal(resumed.id,pending,'Recurrence reuses the original unsent notification');
 await finish(resumed,null);await refresh(report());await refresh(report('degraded'));assert.equal(await claim(),null,'Uncertain delivery is never replayed');
 await reset();
 await refresh(report('degraded'));await refresh(report());await elapsed(16);await refresh(report());
 assert.equal(await claim(),null,'Never-notified transient incident needs no recovery email');
 assert.equal(await one("select count(*) from icash_reliability_private.incident_notifications where state='cancelled'"),1);
 await reset();
 // New severity and a new core failure remain immediately actionable.
 await refresh(report('ok','ok',1));const minor=await claim();assert.equal(minor.severity,'minor');await finish(minor);
 await refresh(report('ok','ok',5));const high=await claim();assert.equal(high.severity,'high');await finish(high);
 await refresh(report('degraded','ok',5));const critical=await claim();assert.equal(critical.severity,'critical');assert.equal(critical.incidentId,minor.incidentId);await finish(critical);
 for(const invalid of [{},{...report(),fresh:false},{...report(),components:{}},{...report(),snapshot:null}]){
  await assert.rejects(refresh(invalid),/Monitor unavailable/);
  assert.equal((await active()).id,minor.incidentId,'Incomplete evidence cannot close the incident');
 }
 await pg.exec('set role service_role');await refresh(report('degraded'));assert.equal(await claim(),null);await pg.exec('reset role');
 for(const role of ['anon','authenticated'])for(const fn of ['icash_refresh_reliability_incident(text)','icash_claim_reliability_notification()']){
  assert.equal(await one("select has_function_privilege($1,$2,'execute')",[role,fn]),false);
 }
 for(const name of ['icash_refresh_reliability_incident','icash_claim_reliability_notification'])assert.equal(await one('select prosecdef from pg_proc where proname=$1',[name]),false);
 console.log('PASS recurring failures share one incident; observed stable recovery, gap resets, immediate escalation, no stale/uncertain resend and private roles. No live sends.');
}finally{await pg.close();}
