// Offline receipt observations and the real reliability/incident functions.
// No provider requests, delivery probes, sends or permission changes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {reliabilitySchema} from '../lib/reliability.ts';
import {reliabilityPriority} from '../lib/reliability-priority.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(sql,args=[])=>pg.query(sql,args),one=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const live='+17205550100',paused='+14245550100',idle='+17205550101';
const refresh=async()=>{await one('select icash_refresh_account_work_snapshot()');return reliabilitySchema.parse(await one('select icash_reliability_status()'));};
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema icash_reliability_private;grant usage on schema icash_reliability_private to service_role;
 create table icash_accounts(id uuid primary key,owner_user_id uuid);
 create table fixture_base(issue_count integer,affected_accounts integer,health_mode text);
 insert into fixture_base values(0,0,'ok');`);
 await pg.exec(read('tests/fixtures/account-work-monitor-baseline.sql'));
 await pg.exec(`drop function public.icash_reliability_severity(jsonb,timestamptz);`);
 for(const name of ['workspace-experience-and-incidents','reliability-incident-severity','reliability-incident-stable-recovery'])await pg.exec(read('config/'+name+'.sql'));
 const schema=JSON.parse(read('tests/fixtures/seller-text-health-schema.json'));
 for(const name of ['icash_text_senders','icash_text_threads','icash_text_messages','icash_operation_spend','icash_lifecycle_text_inbox','icash_customer_update_deliveries']){
  const table=schema.find(t=>t.name===name);assert(table,name);
  await pg.exec(`create table public.${name} (${table.columns.map(c=>`"${c.name}" ${c.type}`).join(',')});`);
 }
 await pg.exec(`create function icash_seller_response_disposition(text) returns text language sql immutable as $$select null::text$$;
 create function icash_seller_direct_response_match(text,text) returns boolean language sql immutable as $$select false$$;
 create function icash_seller_sms_interest_at(uuid,uuid,timestamptz,timestamptz) returns timestamptz language sql stable as $$select null::timestamptz$$;
 create function public.icash_refresh_account_work_snapshot() returns jsonb language plpgsql set search_path='' as $$declare r jsonb;f public.fixture_base;begin
  select * into f from public.fixture_base;
  r:=jsonb_build_object('checkedAt',now(),'issueCount',f.issue_count,'issues','[]'::jsonb,
   'texts',jsonb_build_object('accepted',0,'delivered',0,'review',0),'contracts',jsonb_build_object('created',0,'completed',0,'review',0),
   'accountProgress',jsonb_build_object('checkedAt',now(),'affectedAccounts',f.affected_accounts,'expiredConfigurations',0,'unexpectedPauses',0,'stalledAccounts',f.affected_accounts,'pendingAccounts',0,'samples','[]'::jsonb));
  insert into icash_reliability_private.snapshots values(1,now(),r) on conflict(id) do update set checked_at=now(),report=excluded.report;return r;
 end$$;`);
 await pg.exec(read('config/seller-text-health.sql'));
 // Only the read's availability/freshness is injected; the number classification
 // itself comes from the installed SQL and actual fixture receipt tables.
 await pg.exec(`alter function icash_owner_text_health(uuid) rename to fixture_actual_text_health;
 create function icash_owner_text_health(p_actor uuid) returns jsonb language plpgsql stable set search_path='' as $$declare h jsonb;mode text;begin
  select health_mode into mode from public.fixture_base;
  if mode='failed' then raise exception 'fixture unavailable';end if;
  h:=public.fixture_actual_text_health(p_actor);
  if mode='stale' then h:=jsonb_set(h,'{checkedAt}',to_jsonb(now()-interval '4 minutes'));end if;
  return h;
 end$$;`);
 const migration=read('config/incoming-text-reliability.sql');
 assert.equal(migration,read('supabase/migrations/20261103002537_incoming_text_reliability.sql'));
 await q('insert into icash_text_senders values($1,true),($2,false),($3,true)',[live,paused,idle]);
 for(const [n,line] of [[1,live],[2,paused]]){
  await q("insert into icash_text_threads(id,account_id,sender,recipient,party) values($1,$2,$3,'+12145550123','seller')",[id(n),id(10+n),line]);
  await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,provider_id,body,created_at) values($1,$2,$3,'outgoing','delivered',$4,'Fixture outgoing',now()-interval '1 hour')",[id(100+n),id(10+n),id(n),'provider-'+n]);
  await q("insert into icash_operation_spend(operation_key,account_id,state,dispatched_at) values($1,$2,'dispatched',now()-interval '1 hour')",['text:'+id(100+n),id(10+n)]);
 }
 assert.equal((await refresh()).status,'ok','baseline wrongly hides missing incoming evidence behind healthy process checks');
 assert.equal((await one("select icash_owner_text_health('592171a0-2bb9-484e-8c9a-dd5d2b43b5f7')")).lines.find(l=>l.phone===live).incomingStatus,'unverified');
 await pg.exec(migration);
 let report=await refresh();
 assert.equal(report.status,'degraded','healthy worker and outgoing delivery cannot hide unverified incoming');
 assert.equal(report.components.worker.status,'ok');assert.equal(report.components.maintenance.status,'ok');
 assert.equal(report.snapshot.issueCount,1);assert.equal(report.snapshot.incomingTexts.warningCount,1);
 assert.deepEqual(report.snapshot.incomingTexts.lines.map(l=>l.phone),[live],'disabled and idle lines excluded');
 assert.equal(report.snapshot.incomingTexts.lines[0].propertyDelivered24h,1);
 report=await refresh();assert.equal(report.snapshot.issueCount,1,'repeated refresh does not inflate the count');
 await q("insert into icash_lifecycle_text_inbox(event_id,recipient,sender,body,created_at) values('carrier-notice',$1,'+12145550123','Free Msg: Message Blocking is active',now())",[live]);
 report=await refresh();assert.equal(report.snapshot.incomingTexts.warningCount,1,'a blocking notice cannot disappear from reliability');
 assert.equal(report.snapshot.incomingTexts.lines[0].incomingStatus,'blocking_reported');
 await one("select icash_refresh_reliability_incident('ready')");
 assert.deepEqual(await one('select reasons from icash_reliability_private.incidents where recovered_at is null'),['workflows'],'existing incident mechanism sees the warning');
 const prior=report.snapshot.incomingTexts;
 await pg.exec("update fixture_base set health_mode='failed',issue_count=3,affected_accounts=3");
 report=await refresh();assert.equal(report.snapshot.issueCount,4,'independent account observations still advance');
 assert.equal(report.snapshot.accountProgress.affectedAccounts,3);assert.equal(reliabilityPriority(report),'critical','existing critical account outage stays critical');
 assert.equal(report.snapshot.incomingTexts.fresh,false);assert.equal(report.snapshot.incomingTexts.checkedAt,prior.checkedAt);
 assert.deepEqual(report.snapshot.incomingTexts.lines,prior.lines);
 assert.equal((await refresh()).snapshot.issueCount,4,'unavailable checks do not compound warnings');
 await q("insert into icash_lifecycle_text_inbox(event_id,recipient,sender,body,created_at) values('actual-incoming',$1,'+12145550123','Hello',now())",[live]);
 await pg.exec("update fixture_base set health_mode='stale'");
 report=await refresh();assert.equal(report.snapshot.incomingTexts.warningCount,1,'stale clean data cannot clear the warning');
 await one("select icash_refresh_reliability_incident('ready')");
 assert.equal(await one('select count(*) from icash_reliability_private.incidents where recovered_at is null'),1);
 await pg.exec("update fixture_base set health_mode='ok'");
 report=await refresh();assert.equal(report.snapshot.incomingTexts.warningCount,1,'a current blocking notice remains visible despite another received message');
 await pg.exec("delete from icash_lifecycle_text_inbox where event_id='carrier-notice'");
 report=await refresh();assert.equal(report.snapshot.incomingTexts.warningCount,0,'fresh actual incoming observation clears only this warning');
 assert.equal(report.snapshot.issueCount,3);assert.equal(reliabilityPriority(report),'critical');
 await pg.exec("update fixture_base set issue_count=0,affected_accounts=0;delete from icash_lifecycle_text_inbox;update icash_operation_spend set dispatched_at=now()-interval '25 hours'");
 report=await refresh();assert.equal(report.snapshot.issueCount,0,'idle lines create no warning');
 await pg.exec("update fixture_base set health_mode='failed'");
 report=await refresh();assert.equal(report.snapshot.issueCount,1,'unavailable initial/clean observation cannot claim recovery');
 assert.equal(report.snapshot.incomingTexts.lines.length,0);assert.equal(report.snapshot.incomingTexts.fresh,false);
 await pg.exec("update fixture_base set health_mode='ok'");
 for(let n=200;n<251;n++){
  const line='+17205550'+String(n);
  await q('insert into icash_text_senders values($1,true)',[line]);
  await q("insert into icash_text_threads(id,account_id,sender,recipient,party) values($1,$2,$3,'+12145550123','seller')",[id(n),id(11),line]);
  await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,provider_id,body,created_at) values($1,$2,$3,'outgoing','accepted',$4,'Fixture outgoing',now())",[id(1000+n),id(11),id(n),'provider-'+n]);
  await q("insert into icash_operation_spend(operation_key,account_id,state,dispatched_at) values($1,$2,'dispatched',now())",['text:'+id(1000+n),id(11)]);
 }
 report=await refresh();assert.equal(report.snapshot.incomingTexts.warningCount,51);assert.equal(report.snapshot.incomingTexts.lines.length,50);
 assert.equal(report.snapshot.issueCount,51,'bounded display retains the full count');
 assert.equal((await refresh()).snapshot.issueCount,51);
 for(const role of ['anon','authenticated'])for(const name of ['icash_refresh_account_work_snapshot()','icash_refresh_work_before_incoming_texts()'])assert.equal(await one("select has_function_privilege($1,$2,'execute')",[role,name]),false);
 assert.equal(await one('select count(*) from icash_text_messages'),53,'monitoring never creates or replays a message');
 assert.equal(await one('select count(*) from icash_text_senders where enabled'),53,'sender controls remain unchanged');
 console.log('PASS actual incoming classification feeds workflow incident; repeated refresh, disabled/idle exclusions, independent critical account work and stale/unavailable evidence preserved. No provider calls.');
}finally{await pg.close();}
