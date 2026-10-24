import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {reliabilityAlertClaimSchema} from '../lib/reliability-alerts.ts';
const pg=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const one=async(sql,args=[])=>Object.values((await pg.query(sql,args)).rows[0])[0];
const report=(worker='ok',maintenance='ok',count=183)=>({status:worker!=='ok'||maintenance!=='ok'||count?'degraded':'ok',fresh:true,components:{worker:{status:worker},maintenance:{status:maintenance}},snapshot:{issueCount:count,issues:[]}});
const refresh=async(value)=>{await pg.query('update fixture_monitor set report=$1',[value]);return one("select icash_refresh_reliability_incident('ready')");};
const claim=async()=>{const value=await one('select icash_claim_reliability_notification_v2()');return value===null?null:reliabilityAlertClaimSchema.parse(value);};
const finish=async(value,provider='00000000-0000-4000-8000-000000000001')=>one('select icash_finish_reliability_notification($1,$2)',[value.id,provider]);
const ageNotice=()=>pg.exec("update icash_reliability_private.incident_notifications set accepted_at=now()-interval '61 minutes',claimed_at=now()-interval '61 minutes' where event='detected'");
const ageHealthy=(minutes,gap=1)=>pg.query("update icash_reliability_private.component_outages set healthy_since=now()-$1::interval,last_observed_at=now()-$2::interval where component='worker'",[`${minutes} minutes`,`${gap} minutes`]);
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema icash_reliability_private;grant usage on schema icash_reliability_private to service_role;
 create table public.icash_accounts(id uuid primary key,owner_user_id uuid);
 create table public.fixture_monitor(report jsonb);
 create function public.icash_reliability_status() returns jsonb language sql as $$select report from public.fixture_monitor limit 1$$;
 grant select,update on public.fixture_monitor to service_role;`);
 await pg.query('insert into fixture_monitor values($1)',[report('unavailable')]);
 for(const name of ['workspace-experience-and-incidents','reliability-incident-severity','reliability-incident-stable-recovery'])await pg.exec(read(`config/${name}.sql`));
 // Reproduce the production incident: core outages were already seen, but old
 // workflow receipts prevented global recovery for several days.
 await refresh(report('unavailable','unavailable'));const old=await claim();await finish(old);
 await refresh(report());await refresh(report('unavailable'));assert.equal(await claim(),null,'Old behavior hid the second outage');
 const sql=read('config/reliability-component-outages.sql');
 assert.equal(sql,read('supabase/migrations/20261024170321_reliability_component_outages.sql'));
 await pg.exec(sql);
 await refresh(report('unavailable'));const current=await claim();assert.equal(current.incidentId,old.incidentId);assert.equal(current.severity,'critical');await finish(current);
 assert.equal(await claim(),null,'One claim only');
 for(let i=0;i<12;i++){
  await refresh(report());await refresh(report('unavailable'));assert.equal(await claim(),null,'Brief restarts do not repeatedly page');
 }
 // Independent sustained recovery rearms worker alerts despite old workflows.
 await refresh(report());await ageHealthy(14);await refresh(report());await refresh(report('unavailable'));assert.equal(await claim(),null);
 await refresh(report());await ageHealthy(16,4);await refresh(report());await refresh(report('unavailable'));assert.equal(await claim(),null,'A gap is not healthy evidence');
 await refresh(report());await ageHealthy(16);await refresh(report());
 assert.equal(await one("select opened_at from icash_reliability_private.component_outages where component='worker'"),null);
 assert.equal(await one('select count(*) from icash_reliability_private.incidents where recovered_at is null'),1,'Old workflows remain unresolved');
 await refresh(report('degraded'));const recurred=await claim();assert.equal(recurred.incidentId,old.incidentId);await finish(recurred);
 await refresh(report('unavailable'));const stopped=await claim();assert.equal(stopped.severity,'critical');await finish(stopped);
 await refresh(report('degraded'));await refresh(report('unavailable'));assert.equal(await claim(),null,'One unavailable escalation per component outage');
 // Hourly reminders require a confirmed prior acceptance and a current outage.
 await ageNotice();await refresh(report());assert.equal(await claim(),null,'Healthy core work never triggers outage reminders');
 await refresh(report('unavailable'));const reminder=await claim();await finish(reminder);
 for(let i=0;i<10;i++){await refresh(report('unavailable'));assert.equal(await claim(),null,'No per-minute reminder storm');}
 await ageNotice();await refresh(report('unavailable'));const uncertain=await claim();await finish(uncertain,null);
 await ageNotice();await refresh(report('unavailable'));assert.equal(await claim(),null,'Unknown delivery is not blindly retried');
 await refresh(report('unavailable','unavailable'));const maintenance=await claim();assert.ok(maintenance,'A separate new outage still alerts');await finish(maintenance);
 // Maintenance observations continue while the worker is absent. The service
 // role can update exactly this private state; public roles cannot inspect it.
 await pg.exec('set role service_role');await refresh(report('unavailable','unavailable'));assert.equal(await claim(),null);await pg.exec('reset role');
 for(const role of ['anon','authenticated']){
  assert.equal(await one("select has_table_privilege($1,'icash_reliability_private.component_outages','select')",[role]),false);
  assert.equal(await one("select has_function_privilege($1,'icash_refresh_reliability_incident(text)','execute')",[role]),false);
 }
 assert.equal(await one("select relrowsecurity from pg_class where oid='icash_reliability_private.component_outages'::regclass"),true);
 assert.equal(await one("select prosecdef from pg_proc where proname='icash_refresh_reliability_incident'"),false);
 assert.equal(await one('select count(*) from icash_reliability_private.component_outages'),3);
 console.log('PASS new worker outages cannot hide behind old workflows; independent stable recovery, missing-heartbeat escalation, bounded reminders, uncertain-delivery protection and private permissions. No live sends.');
}finally{await pg.close();}
