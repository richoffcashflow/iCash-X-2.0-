import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('config/scheduler-reliability.sql');
assert.equal(sql,read('supabase/migrations/20261030194040_scheduler_reliability.sql'));
const before=read('tests/fixtures/scheduler-reliability-before.sql');
const definitions=before.split(/(?=CREATE OR REPLACE FUNCTION )/).filter(s=>s.startsWith('CREATE'));
const originalHolds=definitions.find(s=>s.startsWith('CREATE OR REPLACE FUNCTION public.icash_voice_contact_holds()'));
const db=await PGlite.create(),q=(s,a=[])=>db.query(s,a),val=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=id(1),other=id(2),zero=id(3);
const capacity=(a,contact,incoming=false,op='new')=>val("select icash_voice_capacity_available($1,'agent_fixture',$2,$3,$4)",[a,op,contact,incoming]);
const rows=()=>val("select coalesce(jsonb_agg(to_jsonb(s) order by operation_key,account_id,agent_id,contact_key),'[]') from icash_active_voice_slots() s");
const all=()=>val(`select jsonb_build_object('jobs',(select jsonb_agg(to_jsonb(j) order by id) from icash_voice_jobs j),
 'spend',(select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o),
 'tickets',(select jsonb_agg(to_jsonb(t) order by id) from icash_automation_tickets t),
 'wallets',(select jsonb_agg(to_jsonb(w) order by account_id) from icash_wallets w))`);
async function instrument(){
 await db.exec(`create or replace function public.icash_voice_contact_holds() returns table(operation_key text,account_id uuid,agent_id text,contact_key text)
 language plpgsql set search_path='' as $$begin perform nextval('public.fixture_scans');return query select * from public.fixture_original_holds();end$$;`);
}
async function selectionScans(){
 await db.exec('begin');
 await db.exec("select setval('fixture_scans',1,false)");
 const ticket=await val('select icash_issue_ready_voice_ticket()');
 assert.equal(typeof ticket?.token,'string');
 assert.equal(await val("select count(*)::integer from icash_voice_jobs where state='issued' and id=$1",[id(1040)]),1,'Later eligible account reaches selection');
 const count=await val("select last_value::integer from fixture_scans");
 await db.exec('rollback');
 return count;
}
try{
 await db.exec(read('tests/fixtures/stalled-voice-capacity-schema.sql'));
 await db.exec(`
 alter table icash_voice_capacity_policy add credit_state text;
 alter table icash_voice_jobs add due_at timestamptz default now(),add created_at timestamptz default now(),add callback_id uuid,add sms_source_message_id uuid,add cancellation_notice_id uuid,add meta_offer_lead_id uuid,add meta_followup_lead_id uuid;
 alter table icash_voice_contact_targets add timezone text default 'America/Chicago';
 alter table icash_automation_tickets add token text default 'fixture-token',add prospecting_quote_cents bigint,add screening_id uuid,add opener_message_id uuid;
 alter table icash_automation_tickets alter id set default gen_random_uuid();
 alter table icash_automation_tickets alter state set default 'issued';
 alter table icash_automation_tickets alter created_at set default now();
 alter table icash_automation_tickets alter expires_at set default now()+interval '2 minutes';
 alter table icash_live_conversations add id uuid,add screening_id uuid,add party text,add result jsonb,add completed_at timestamptz;
 create table icash_recording_private.capacity_quarantines(operation_key text primary key,account_id uuid,voice_job_id uuid,contact_key text);
 create table icash_voice_scheduler(id integer primary key,last_dispatch_at timestamptz);
 insert into icash_voice_scheduler values(1,null);
 create table icash_operational_contacts(id uuid,account_id uuid,channel text,timezone_basis text);
 create table icash_contact_permissions(id uuid,account_id uuid,screening_id uuid,seller_intake_id uuid);
 create table icash_meta_leads(id uuid,account_id uuid,screening_id uuid,voice_job_id uuid,lead_id uuid);
 create table icash_screening_jobs(id uuid,account_id uuid,state text);
 create table icash_live_callbacks(id uuid,account_id uuid,conversation_id uuid,screening_id uuid,state text,due_at timestamptz);
 create table icash_text_messages(id uuid,account_id uuid,state text,provider_id text,last_delivery_at timestamptz);
 create table icash_discovery_configs(account_id uuid,revision int,next_page int);
 create function icash_queue_voice_jobs() returns void language sql as $$select$$;
 create function icash_outreach_window_open(text,text,timestamptz) returns boolean language sql as $$select true$$;
 create function icash_requested_seller_call_current(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_cancellation_voice_current(uuid,text) returns boolean language sql as $$select false$$;
 create function icash_call_has_seller_response(jsonb) returns boolean language sql as $$select false$$;
 create function icash_prospecting_available(uuid) returns bigint language sql stable as $$select balance_cents from public.icash_wallets where account_id=$1$$;
 create function icash_membership_work_allowed(uuid) returns boolean language sql stable as $$select true$$;
 create function icash_research_waiting_on_outreach(uuid) returns boolean language sql stable as $$select false$$;
 create function icash_dealmachine_capacity_available() returns boolean language sql stable as $$select true$$;
 create function icash_wake_funded_outreach(uuid) returns void language sql as $$select$$;
 create sequence fixture_scans;
 grant usage on schema icash_recording_private to service_role;
 `);
 await db.exec(before);
 await db.exec(originalHolds.replace('public.icash_voice_contact_holds()','public.fixture_original_holds()'));
 await db.exec(`insert into icash_accounts values('${account}',false),('${other}',false),('${zero}',false);
 insert into icash_voice_configs(account_id,agent_id) values('${account}','agent_fixture'),('${other}','agent_fixture');
 insert into icash_wallets values('${account}',30000,0),('${other}',30000,0),('${zero}',0,0);
 insert into icash_operating_budget values(1,0,0,true,null);
 insert into icash_voice_capacity_policy values(1,20,now(),null);
 insert into icash_voice_agent_capacity values('agent_fixture',20,now());`);
 // Unknown operations, duplicate evidence, quarantine, late identities and
 // terminal receipts retain precisely the old capacity and recipient meaning.
 for(let n=10;n<30;n++){
  const a=n%2?account:other,op='voice:'+id(n);
  await q("insert into icash_voice_jobs(id,account_id,operational_contact_id,state,outcome,updated_at) values($1,$2,$1,'held','provider_outcome_unknown_no_retry',now())",[id(n),a]);
  await q('insert into icash_voice_contact_targets(id,account_id,contact_key) values($1,$2,$3)',[id(n),a,'contact-'+n]);
  await q("insert into icash_call_recordings(id,account_id,operation_key,voice_job_id,agent_id,contact_key,state,call_sid,call_ended_at) values($1,$2,$3,$1,'agent_fixture',$4,'consent_pending',$5,$6)",[id(n),a,op,'contact-'+n,n%3===0?'CA'+n:null,n%5===0?new Date().toISOString():null]);
  if(n%4===0)await q('insert into icash_recording_private.capacity_quarantines values($1,$2,$3,$4)',[op,a,id(n),'original-'+n]);
  if(n%3===0)await q("insert into icash_recorded_gate_terminal_receipts values($1,$2,$3,'{\"status\":\"completed\"}')",[id(n),a,'CA'+n]);
 }
 await q("insert into icash_live_conversations(operation_key,account_id,agent_id,contact_key,state) values('busy-candidate',$1,'agent_fixture','blocked-candidate','waiting')",[other]);
 const cases=[];
 for(const a of [account,other,zero])for(const contact of [null,'new',...Array.from({length:20},(_,n)=>'contact-'+(n+10)),'original-16'])for(const incoming of [false,true])cases.push({a,contact,incoming,result:await capacity(a,contact,incoming)});
 const beforeSlots=await rows(),beforeState=await all();
 // Exercise the actual issuer with forty older candidates that cannot proceed.
 for(let n=1000;n<=1040;n++){
  await q("insert into icash_voice_jobs(id,account_id,operational_contact_id,state,due_at) values($1,$2,$1,'ready',now()-interval '1 hour'+$3*interval '1 second')",[id(n),zero,n-1000]);
  await q('insert into icash_voice_contact_targets(id,account_id,contact_key) values($1,$2,$3)',[id(n),zero,n===1040?'candidate-'+n:'blocked-candidate']);
 }
 // Use a fresh account with capacity, outside the existing unknown operations.
 await q('insert into icash_voice_configs(account_id,agent_id) values($1,\'agent_fixture\')',[zero]);
 await q('update icash_wallets set balance_cents=30000 where account_id=$1',[zero]);
 await instrument();
 const originalScans=await selectionScans();
 await db.exec(originalHolds);
 // Both actual held-state and original-operation checks happen after the old
 // LIMIT. Twenty stale rows used to hide this unrelated eligible text.
 for(let n=2000;n<2025;n++){
  await q("insert into icash_automation_tickets(id,account_id,kind,state,outcome,voice_job_id,prospecting_quote_cents,created_at,expires_at) values($1,$2,'voice_dispatch','held','prospecting_budget_held',$3,100,now()-interval '2 hours',now()-interval '1 hour')",[id(n),account,id(1000+n-2000)]);
  await q('update icash_voice_jobs set account_id=$1 where id=$2',[account,id(1000+n-2000)]);
  await q('update icash_voice_contact_targets set account_id=$1 where id=$2',[account,id(1000+n-2000)]);
 }
 await q("insert into icash_text_messages values($1,$2,'ready',null,null)",[id(3000),other]);
 await q("insert into icash_automation_tickets(id,account_id,kind,state,outcome,opener_message_id,prospecting_quote_cents,created_at,expires_at) values($1,$2,'seller_opener','held','prospecting_budget_held',$1,3,now()-interval '1 hour',now()-interval '1 minute')",[id(3000),other]);
 assert.equal(await val('select icash_resume_prospecting_ticket()'),null,'Reproduces blocked batch on the original function');
 const installState=await all();
 await db.exec(sql);
 assert.deepEqual(await all(),installState,'Installation never changes jobs, money or original capabilities');
 assert.deepEqual(await rows(),beforeSlots);
 // Restore the zero-wallet fixture for before/after capacity comparison.
 await q('update icash_wallets set balance_cents=0 where account_id=$1',[zero]);
 for(const c of cases)assert.equal(await capacity(c.a,c.contact,c.incoming),c.result,JSON.stringify(c));
 await q('update icash_wallets set balance_cents=30000 where account_id=$1',[zero]);
 await instrument();
 const optimizedScans=await selectionScans();
 assert.equal(optimizedScans,2,'One global shortcut plus one snapshot, independent of candidate count');
 assert(originalScans>40,`Original repeated scans reproduced: ${originalScans}`);
 await db.exec("select setval('fixture_scans',1,false)");
 await capacity(zero,'fresh');
 assert.equal(await val('select last_value::integer from fixture_scans'),1,'Final admission reads holds once');
 await db.exec(originalHolds);
 const snapshot=await val('select icash_recording_private.voice_capacity_snapshot()');
 await q("insert into icash_recorded_reception_private.sessions values('recorded-reception:new',$1,'agent_fixture','fresh',null)",[account]);
 assert.equal(await capacity(zero,'fresh'),false,'Final admission sees new calls after the scheduler snapshot');
 assert.equal(await val("select icash_recording_private.voice_capacity_from_snapshot($1,'agent_fixture','new','fresh',false,$2::jsonb)",[zero,JSON.stringify(snapshot)]),true);
 const resumed=await val('select icash_resume_prospecting_ticket()');
 assert.equal(typeof resumed?.token,'string');
 assert.equal(await val('select state from icash_automation_tickets where id=$1',[id(3000)]),'issued');
 assert.equal(await val("select count(*)::integer from icash_automation_tickets where outcome='prospecting_budget_held'"),25,'Stale jobs stay held with their evidence');
 // A held job with any original money operation is not resumable either.
 // The batch must pass it without resetting that operation or its ticket.
 for(let n=2000;n<2025;n++){
  const job=id(1000+n-2000);
  await q("update icash_voice_jobs set state='held',outcome='prospecting_budget_held' where id=$1",[job]);
  await q("insert into icash_operation_spend(operation_key,account_id,state,charge_cap_cents) values($1,$2,'dispatched',137)",['voice:'+job,account]);
 }
 await q("insert into icash_text_messages values($1,$2,'ready',null,null)",[id(3001),zero]);
 await q("insert into icash_automation_tickets(id,account_id,kind,state,outcome,opener_message_id,prospecting_quote_cents,created_at,expires_at) values($1,$2,'seller_recovery','held','prospecting_budget_held',$1,3,now()-interval '1 hour',now()-interval '1 minute')",[id(3001),zero]);
 assert.equal(typeof (await val('select icash_resume_prospecting_ticket()'))?.token,'string');
 assert.equal(await val('select state from icash_automation_tickets where id=$1',[id(3001)]),'issued');
 assert.equal(await val("select count(*)::integer from icash_operation_spend where state='dispatched'"),25);
 assert.equal(await val("select count(*)::integer from icash_automation_tickets where outcome='prospecting_budget_held'"),25);
 assert.equal(await val('select icash_resume_prospecting_ticket()'),null,'No blocked original operation can be replayed');
 // Existing financial/channel limits remain in force.
 await db.exec("update icash_voice_capacity_policy set credit_state='exhausted'");
 await instrument();
 await db.exec("select setval('fixture_scans',1,false)");
 assert.equal(await capacity(zero,'unrelated'),false);
 assert.equal(await val('select is_called from fixture_scans'),false,'Exhausted provider skips the snapshot');
 await db.exec(originalHolds);
 await db.exec("update icash_voice_capacity_policy set credit_state=null,workspace_limit=1");
 assert.equal(await capacity(zero,'unrelated',true),false);
 for(const role of ['anon','authenticated','service_role'])for(const signature of [
  'icash_recording_private.voice_capacity_snapshot()',
  'icash_recording_private.voice_capacity_from_snapshot(uuid,text,text,text,boolean,jsonb)',
  'icash_recording_private.voice_queue_slot_from_snapshot(uuid,uuid,jsonb)'])
  assert.equal(await val('select has_function_privilege($1,$2,\'EXECUTE\')',[role,signature]),role==='service_role');
 console.log(`Scheduler reliability: ${cases.length} capacity equivalence cases, fresh final admission, private ACL, unchanged installation, blocked recovery batch and ${originalScans}->${optimizedScans} hold scans passed.`);
}finally{await db.close();}
