import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createObservation,renderCohortQuery} from '../scripts/work-cohort.mjs';

// Synthetic sources exercise the entire captured query. The small function
// stubs keep eligibility identical between both reads; they do not verify live
// admission or authorize provider work.
const db=new PGlite();
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const baseline={cohortId:'synthetic-363',accounts:Array.from({length:363},(_,i)=>({id:id(i+1)}))};
const before=readFileSync(new URL('./fixtures/observe-work-cohort-before-voice-aggregation.sql',import.meta.url),'utf8')
 .replace('__ICASH_COHORT_IDS__',JSON.stringify(baseline.accounts.map(a=>a.id)));
const after=renderCohortQuery(baseline);
const select=sql=>sql.slice(sql.indexOf('with fixed_members'),sql.lastIndexOf('commit;')).trim();
const sourceSql=`
create schema icash_reliability_private;
create function public.synthetic_id(n integer) returns uuid language sql immutable as $$ select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create table public.icash_accounts(id uuid primary key,created_at timestamptz,bot_paused boolean,workspace_ack_version text);
create table public.icash_wallets(account_id uuid primary key,balance_cents bigint,reserved_cents bigint);
create table public.icash_discovery_configs(account_id uuid primary key,enabled boolean,auto_enabled boolean,contacts_enabled boolean,data_rights_until timestamptz,next_run_at timestamptz,rate_id uuid,contact_rate_id uuid);
create table public.icash_operation_rates(id uuid primary key,enabled boolean,expires_at timestamptz,charge_cents bigint);
create table icash_reliability_private.account_work_states(account_id uuid primary key,reason text,since timestamptz,checked_at timestamptz);
create table public.icash_control_events(id uuid,account_id uuid,property_id text,action text,created_at timestamptz);
create table public.icash_billing_reviews(account_id uuid,resolved_at timestamptz);
create table public.icash_support_cancel_requests(account_id uuid,confirmed_at timestamptz);
create table public.icash_funding_orders(account_id uuid,mode text,state text,credited_at timestamptz);
create table public.icash_operation_spend(account_id uuid,operation_key text,state text,charge_cap_cents bigint,actual_micros bigint,charged_cents bigint,created_at timestamptz,dispatched_at timestamptz,settled_at timestamptz,settlement_evidence jsonb);
create table public.icash_discovery_results(account_id uuid,operation_key text,result jsonb,created_at timestamptz);
create table public.icash_automation_tickets(account_id uuid,kind text,state text,outcome text,created_at timestamptz,completed_at timestamptz);
create table public.icash_operational_contacts(account_id uuid,revoked_at timestamptz,eligibility_until timestamptz,timezone text,timezone_basis text);
create table public.icash_text_messages(id uuid,account_id uuid,provider_id text,request_key text,event_id text,thread_id uuid,state text,direction text,body text,attachments jsonb,created_at timestamptz,updated_at timestamptz,last_delivery_at timestamptz);
create table public.icash_voice_jobs(id uuid primary key,account_id uuid,operation_key text,provider_call_sid text,conversation_id text,state text,outcome text,created_at timestamptz,updated_at timestamptz);
create table public.icash_call_recordings(id uuid primary key,account_id uuid,voice_job_id uuid,operation_key text,call_sid text,created_at timestamptz,dial_claimed_at timestamptz,provider_started_at timestamptz);
create index on public.icash_call_recordings(voice_job_id);
create function public.icash_membership_work_allowed(a uuid) returns boolean language sql stable as $$select a<>public.synthetic_id(3)$$;
create function public.icash_prospecting_available(a uuid) returns bigint language sql stable as $$select balance_cents-reserved_cents from public.icash_wallets where account_id=a$$;
create function public.icash_research_admission_quote(a uuid,k text,p bigint) returns bigint language sql stable as $$select p+10$$;
create function public.icash_enrichment_before_prospecting_budget(a uuid) returns uuid language sql stable as $$select case when a=public.synthetic_id(1) then public.synthetic_id(10000) end$$;
create function public.icash_outreach_window_open(z text,b text,t timestamptz) returns boolean language sql stable as $$select z='America/Chicago'$$;
insert into public.icash_accounts select public.synthetic_id(n),now()-interval '30 days',n=2,case when n<>4 then 'current' end from generate_series(1,362)n;
insert into public.icash_wallets select id,1000,100 from public.icash_accounts where id<>public.synthetic_id(8);
insert into public.icash_operation_rates values(public.synthetic_id(500),true,now()+interval '1 day',100),(public.synthetic_id(501),true,now()+interval '1 day',50);
insert into public.icash_discovery_configs select id,true,true,true,now()+interval '1 day',now()-interval '1 hour',public.synthetic_id(500),public.synthetic_id(501) from public.icash_accounts where id<>public.synthetic_id(7);
insert into public.icash_control_events values(public.synthetic_id(1),public.synthetic_id(2),null,'pause',now()-interval '1 day');
insert into public.icash_support_cancel_requests values(public.synthetic_id(5),now()-interval '1 hour');
insert into public.icash_billing_reviews values(public.synthetic_id(6),null);
insert into public.icash_funding_orders select id,'live','paid',now()-interval '2 days' from public.icash_accounts;
insert into icash_reliability_private.account_work_states values(public.synthetic_id(1),'pending_work',now()-interval '2 hours',now());
insert into public.icash_operation_spend values(public.synthetic_id(1),'original-pending','dispatched',100,null,null,now()-interval '2 days',now()-interval '2 days',null,null),(public.synthetic_id(1),'original-settled','settled',20,10000,1,now()-interval '1 day',now()-interval '1 day',now()-interval '1 hour','{"receipt":"original"}');
insert into public.icash_discovery_results values(public.synthetic_id(1),'original-research','{"result":"original"}',now()-interval '10 minutes');
insert into public.icash_automation_tickets values(public.synthetic_id(1),'voice','held','original_hold',now()-interval '2 days',now()-interval '1 day'),(public.synthetic_id(1),'contacts','issued',null,now()-interval '1 hour',null);
insert into public.icash_operational_contacts values(public.synthetic_id(1),null,now()+interval '1 day','America/Chicago','recipient'),(public.synthetic_id(2),null,now()-interval '1 day',null,'recipient');
insert into public.icash_text_messages values(public.synthetic_id(1),public.synthetic_id(1),'message-original','request-original','event-original',public.synthetic_id(1),'accepted','outgoing','synthetic only','[]',now()-interval '1 hour',now(),null);
-- Deliberately no account index, matching the observed live plan. Most history
-- is outside both windows; some accounts are outside the fixed membership.
insert into public.icash_voice_jobs select public.synthetic_id(n),public.synthetic_id(1+n%400),'operation-'||n,'provider-'||n,null,'complete','unanswered',now()-interval '30 days',now()-interval '30 days' from generate_series(1,12000)n;
insert into public.icash_voice_jobs select public.synthetic_id(20000+n),public.synthetic_id(n),'recent-'||n,'recent-provider-'||n,null,'complete','unanswered',now()-interval '1 hour',now()-interval '1 hour' from generate_series(1,400)n where n<>362;
insert into public.icash_voice_jobs values
 (public.synthetic_id(90001),public.synthetic_id(1),'created-only',null,null,'held','held',now(),now()-interval '2 days'),
 (public.synthetic_id(90002),public.synthetic_id(1),'updated-only','exact-sid',null,'complete','unanswered',now()-interval '2 days',now()),
 (public.synthetic_id(90003),public.synthetic_id(1),'old-dispatch',null,null,'dispatching',null,now()-interval '2 days',now()-interval '2 days'),
 (public.synthetic_id(90004),public.synthetic_id(1),'boundary','boundary-sid',null,'complete','unanswered',now()-interval '24 hours',now()-interval '24 hours'),
 (public.synthetic_id(90005),public.synthetic_id(1),'future',null,null,'held','held',now()+interval '1 hour',now()+interval '1 hour'),
 (public.synthetic_id(90006),public.synthetic_id(1),'old-terminal','old-sid',null,'complete','unanswered',now()-interval '2 days',now()-interval '2 days'),
 (public.synthetic_id(90007),public.synthetic_id(1),'null-times',null,null,'dispatching',null,null,null);
insert into public.icash_call_recordings values
 (public.synthetic_id(91001),public.synthetic_id(2),public.synthetic_id(90002),'updated-only','exact-sid',now()-interval '5 hours',now()-interval '5 hours',null),
 (public.synthetic_id(91002),public.synthetic_id(1),public.synthetic_id(90002),'wrong-operation','exact-sid',now()-interval '4 hours',now()-interval '4 hours',null),
 (public.synthetic_id(91003),public.synthetic_id(1),public.synthetic_id(90002),'updated-only','wrong-sid',now()-interval '3 hours',now()-interval '3 hours',null),
 (public.synthetic_id(91005),public.synthetic_id(1),public.synthetic_id(90002),'updated-only','exact-sid',now()-interval '2 hours',now()-interval '2 hours',null),
 (public.synthetic_id(91004),public.synthetic_id(1),public.synthetic_id(90002),'updated-only','exact-sid',now()-interval '2 hours',now()-interval '2 hours',now()-interval '1 hour'),
 (public.synthetic_id(91006),public.synthetic_id(1),public.synthetic_id(90002),'updated-only','exact-sid',now()-interval '1 hour',now()-interval '1 hour',null),
 (public.synthetic_id(91007),public.synthetic_id(1),public.synthetic_id(90007),'null-times',null,now(),null,null);
analyze;
`;
try{
 await db.exec('begin');
 await db.exec(sourceSql);
 await db.exec('commit');
 // Both versions see precisely the same snapshot and now(), including the
 // inclusive 24-hour boundary. No partial query can become an observation.
 await db.exec("begin isolation level repeatable read read only;set local statement_timeout='20s'");
 // The boundary fixtures were inserted in the prior transaction. Rebase now()
 // in both captured SELECTs to that immutable fixture timestamp, not wall time.
 const fixtureAt=(await db.query("select created_at::text t from public.icash_voice_jobs where operation_key='created-only'")).rows[0].t;
 const query=sql=>select(sql).replaceAll('now()',`'${fixtureAt}'::timestamptz`);
 // Match the connector's serialized timestamp transport (PGlite uses Date for
 // top-level timestamptz values, while jsonb timestamps are already strings).
 const original=JSON.parse(JSON.stringify((await db.query(query(before))).rows));
 const optimized=JSON.parse(JSON.stringify((await db.query(query(after))).rows));
 assert.deepEqual(optimized,original,'Every original evidence field, null, array order, and observed_at must remain identical');
 assert.equal(optimized.length,363);
 const a=optimized.find(r=>r.evidence.id===id(1)).evidence;
 const receipt=op=>a.call_receipts.find(r=>r.operationId===op);
 assert.equal(receipt('updated-only').recordingId,id(91004),'Earliest exact recording and deterministic ID tie-break remain unchanged');
 assert.equal(receipt('null-times').recordingId,id(91007),'Null-safe exact call identity is preserved');
 assert.equal(receipt('created-only'),undefined);assert.equal(receipt('old-terminal'),undefined);
 assert(receipt('old-dispatch'));assert(receipt('boundary'));assert(receipt('future'));
 const missing=optimized.find(r=>r.evidence.id===id(363)).evidence;
 assert.equal(missing.created_at,null);assert.deepEqual(missing.calls_24h,{complete:1});assert.equal(missing.call_receipts.length,1,'An absent account never removes its original orphaned evidence');
 const empty=optimized.find(r=>r.evidence.id===id(362)).evidence;
 assert.equal(empty.calls_24h,null);assert.deepEqual(empty.call_receipts,[]);
 assert.equal(optimized.find(r=>r.evidence.id===id(2)).evidence.bot_paused,true);
 assert.equal(optimized.find(r=>r.evidence.id===id(3)).evidence.membership_allowed,false);
 assert.deepEqual(createObservation(baseline,optimized),createObservation(baseline,original),'Schema-2 classifications and full observation hash remain identical');
 const plans=[];
 for(const sql of [before,after]){
  const root=(await db.query('explain (analyze,format json,timing off) '+query(sql))).rows[0]['QUERY PLAN'][0].Plan;
  const scans=[];const visit=p=>{if(p['Relation Name']==='icash_voice_jobs')scans.push(p);for(const c of p.Plans??[])visit(c)};visit(root);plans.push(scans);
 }
 const loops=plans.map(p=>p.reduce((sum,node)=>sum+node['Actual Loops'],0));
 assert.equal(loops[0],726,'Captured query scans the entire voice history twice per fixed member');
 assert.equal(loops[1],1,'Optimized query reads the voice table once for the whole cohort');
 await db.exec('rollback');
 console.log(`PASS fixed cohort query: 363 identical rows/hashes; exact source and window boundaries; voice-history scans ${loops[0]} → ${loops[1]}.`);
}finally{await db.close();}
