import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const at=new Date().toISOString(),account='00000000-0000-4000-8000-000000000001';
const report={status:'degraded',fresh:true,components:{worker:{status:'ok'},maintenance:{status:'ok'}},snapshot:{checkedAt:at,issueCount:90,issues:[],accountProgress:{checkedAt:at,affectedAccounts:88,stalledAccounts:88,pendingAccounts:0,expiredConfigurations:0,unexpectedPauses:0,samples:[]}}};
const refresh=async(r=report)=>{await q('update fixture_monitor set report=$1',[r]);await v("select icash_refresh_reliability_incident('ready')");};
const claim=()=>v('select icash_claim_reliability_notification_v2()');
const finish=c=>v('select icash_finish_reliability_notification($1,$2)',[c.id,account]);
const age=()=>pg.exec("update icash_reliability_private.incident_notifications set accepted_at=now()-interval '61 minutes',claimed_at=now()-interval '61 minutes' where state='accepted'");
try{
 await pg.exec(read('tests/fixtures/reliability-reset-foundation.sql'));
 await q('insert into fixture_monitor values($1)',[report]);
 for(const name of ['workspace-experience-and-incidents','reliability-incident-severity','reliability-incident-stable-recovery','reliability-component-outages'])await pg.exec(read('config/'+name+'.sql'));
 await pg.exec("alter table icash_reliability_private.component_outages drop constraint component_outages_component_check;insert into icash_reliability_private.component_outages(component) values('account_progress');");
 await pg.exec(JSON.parse(read('tests/fixtures/outbound-recovery-before.json')).icash_refresh_reliability_incident);
 await q("insert into icash_reliability_private.account_work_states values($1,'no_completed_work',now()-interval '1 hour')",[account]);
 await refresh();const first=await claim();await finish(first);await age();await refresh();const repeated=await claim();assert(repeated,'Reproduce repeated notice for unchanged account delays');await finish(repeated);
 const sql=read('config/reliability-email-reset.sql');assert.equal(sql,read('supabase/migrations/20261113191411_reliability_email_reset.sql'));await pg.exec(sql);
 const reset=(key='owner-request-outbound-recovery-20261113',snapshot=at,release='a'.repeat(40),incident=first.incidentId)=>v('select icash_reliability_private.reset_notification_baseline($1,$2,$3,$4)',[key,incident,snapshot,release]);
 assert.equal(await reset('bad'),false);assert.equal(await reset(undefined,'2020-01-01T00:00:00Z'),false);assert.equal(await reset(undefined,at,'bad'),false);
 await pg.exec('begin');await pg.exec("update icash_reliability_private.incident_notifications set state='pending',accepted_at=null");
 assert.equal(await reset('owner-reset-first-unconfirmed'),false,'Never cancel the first unconfirmed alert with no accepted notice to acknowledge');
 await pg.exec('rollback');
 const before=await v('select jsonb_build_object(\'health\',(select report from fixture_monitor),\'accounts\',(select jsonb_agg(s) from icash_reliability_private.account_work_states s),\'receipts\',(select jsonb_agg(n order by id) from icash_reliability_private.incident_notifications n))');
 assert.equal(await reset(),true);assert.equal(await reset(),true,'Same request is idempotent');assert.equal(await reset(undefined,at,'b'.repeat(40)),false);
 assert.deepEqual(await v('select jsonb_build_object(\'health\',(select report from fixture_monitor),\'accounts\',(select jsonb_agg(s) from icash_reliability_private.account_work_states s),\'receipts\',(select jsonb_agg(n order by id) from icash_reliability_private.incident_notifications n))'),before);
 await pg.exec('begin');
 await q("insert into icash_reliability_private.incident_notifications(incident_id,event,revision,state,created_at) values($1,'detected',10,'pending',$2::timestamptz-interval '1 second'),($1,'detected',11,'needs_review',$2::timestamptz-interval '1 second')",[first.incidentId,at]);
 assert.equal(await reset('owner-reset-pending-fixture'),true);
 assert.equal(await v("select state from icash_reliability_private.incident_notifications where revision=10"),'cancelled');
 assert.equal(await v("select state from icash_reliability_private.incident_notifications where revision=11"),'needs_review','Unknown email remains consumed');
 assert.equal(await v("select cardinality(cancelled_notifications) from icash_reliability_private.notification_baselines where request_key='owner-reset-pending-fixture'"),1);
 await pg.exec('rollback');
 await age();await refresh();assert.equal(await claim(),null,'Explicitly reviewed unchanged delay no longer repeats hourly');
 assert.equal(await v('select count(*)::int from icash_reliability_private.incidents where recovered_at is null'),1,'Reset is not fabricated recovery');
 await q("insert into icash_reliability_private.account_work_states values('00000000-0000-4000-8000-000000000002','no_completed_work',now())");
 await refresh();const changed=await claim();assert(changed,'A different affected account invalidates the baseline even if totals match');await finish(changed);
 await refresh({...report,components:{...report.components,worker:{status:'unavailable'}}});const outage=await claim();assert(outage,'New service outage alerts immediately');await finish(outage);
 await v('select icash_finish_reliability_notification($1,$2)',[outage.id,account]);
 // Recovery keeps the existing observed 15-minute window.
 const healthy={...report,status:'ok',snapshot:{...report.snapshot,issueCount:0,accountProgress:{...report.snapshot.accountProgress,affectedAccounts:0,stalledAccounts:0}}};
 await refresh(healthy);assert.equal(await claim(),null);
 await pg.exec("update icash_reliability_private.incidents set healthy_since=now()-interval '16 minutes',last_observed_at=now()-interval '1 minute' where recovered_at is null");
 await refresh(healthy);const recovered=await claim();assert.equal(recovered.event,'recovered');await finish(recovered);
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await v("select has_function_privilege($1,'icash_reliability_private.reset_notification_baseline(text,uuid,timestamptz,text)','execute')",[role]),false);
  assert.equal(await v("select has_table_privilege($1,'icash_reliability_private.notification_baselines','insert')",[role]),false);
 }
 await pg.exec('set role service_role');await refresh(healthy);assert.equal(await claim(),null);await pg.exec('reset role');
 assert.equal(await v("select relrowsecurity from pg_class where oid='icash_reliability_private.notification_baselines'::regclass"),true);
 console.log('PASS owner notification reset: unchanged-only reminders, idempotent audit, new-account/new-outage alerts, original receipts, genuine recovery window and private access. No email sent.');
}finally{await pg.close();}
