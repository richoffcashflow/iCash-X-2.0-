import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const fn=(file,name)=>{
 const s=read(file),at=s.toLowerCase().search(new RegExp('create (?:or replace )?function public\\.'+name+'\\('));
 assert(at>=0,name);const start=s.slice(at),delimiter=start.match(/\bas\s+(\$[a-z_]*\$)/i)?.[1]??'$$';
 const body=start.indexOf(delimiter);return start.slice(0,start.indexOf(delimiter,body+delimiter.length)+delimiter.length+1);
};
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const acct=id(1),rate=id(2),ac='AC'+'a'.repeat(32),sid=n=>'CA'+n.toString(16).padStart(32,'0');
const one=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]??{})[0];
const now='2026-10-15T17:00:00.000Z';
const categories=['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'];
const costs=Object.fromEntries(categories.map(k=>[k,k==='elevenlabs'?600000:k==='twilio'?100000:k==='other'?100000:0]));
const components=Object.fromEntries(categories.map(k=>[k,k==='elevenlabs'?{kind:'duration',unitSeconds:1,microsPerUnit:1000,minimumUnits:0,rounding:'exact',evidenceRef:'Synthetic enforced agent ceiling'}:k==='twilio'?{kind:'duration',unitSeconds:60,microsPerUnit:10000,minimumUnits:1,rounding:'up',evidenceRef:'Synthetic carrier minute tariff'}:{kind:'fixed',amountMicros:costs[k],evidenceRef:'Synthetic fixed cost allocation'}]));
const enforcement={kind:'provider_inclusive_hard_cap',boundVersion:'inclusive-conversation-cap-v1',scope:'platform_and_llm_per_conversation',agentId:'agent_fixture',branchId:'agtbrch_fixture',versionId:'agtvrsn_fixture',configurationHash:'a'.repeat(64),controlReceiptHash:'b'.repeat(64),cumulativeCeilingsMicros:Array.from({length:600},(_,n)=>(n+1)*1000)};
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table public.icash_accounts(id uuid primary key,bot_paused boolean default false);
 create table public.icash_wallets(account_id uuid primary key,balance_cents bigint not null check(balance_cents>=0),reserved_cents bigint not null default 0);
 create table public.icash_credit_reservations(id uuid primary key default gen_random_uuid(),account_id uuid,operation_key text unique,amount_cents bigint,status text default 'reserved',settled_cents bigint,created_at timestamptz default now());
 create table public.icash_credit_ledger(id uuid primary key default gen_random_uuid(),account_id uuid,event_key text unique,kind text,delta_cents bigint check(delta_cents<>0),evidence_ref text,created_at timestamptz default now(),check((kind in ('grant','purchase') and delta_cents>0) or (kind in ('usage','refund') and delta_cents<0)));
 create table public.icash_usage_coverage(operation_key text primary key,account_id uuid,gross_cents bigint,customer_cents bigint,covered_cents bigint,evidence_ref text);
 create table public.icash_operating_budget(id integer primary key,reserved_micros bigint not null default 0 check(reserved_micros>=0));insert into public.icash_operating_budget(id) values(1);
 create table public.icash_operation_rates(id uuid primary key,operation text,version text,voice_max_duration_seconds integer,charge_cents bigint,costs_micros jsonb,buffer_bps integer,enabled boolean,verified_at timestamptz,expires_at timestamptz);
 create table public.icash_operation_spend(operation_key text primary key,account_id uuid,rate_id uuid,credit_reservation_id uuid,state text default 'dispatched',charge_cap_cents bigint,standard_cost_multiplier numeric default 3,elevenlabs_cost_multiplier numeric default 3,charged_cents bigint,actual_micros bigint,settlement_evidence text,cost_basis text default 'estimated',reserved_micros bigint not null default 960000,settled_at timestamptz);
 create table public.icash_cost_observations(provider text,event_key text,source_ref text,amount numeric,units text);
 create table public.icash_cost_manifests(operation_key text primary key,charge_cents bigint,actual_micros bigint,components jsonb,evidence_ref text);
 create table public.icash_question_usage(account_id uuid,question_id uuid,state text);
 create function public.icash_membership_work_allowed(uuid) returns boolean language sql as $$select true$$;
 create function public.icash_general_reception_pause_exempt(uuid,text,bigint) returns boolean language sql as $$select false$$;
 create function public.icash_customer_text_operation(uuid,text) returns boolean language sql as $$select false$$;
 create function public.icash_spending_day() returns date language sql as $$select current_date$$;
 create table public.icash_call_recordings(id uuid primary key,account_id uuid,operation_key text,rate_id uuid,provider_account_sid text,call_sid text,from_phone text,to_phone text,max_total_seconds integer,dial_claimed_at timestamptz,start_claimed_at timestamptz,created_at timestamptz);
 alter table public.icash_call_recordings add column state text not null default 'consent_pending',add column charge_cap_cents bigint not null default 1000,
  add column recording_sid text,add column conversation_id text,add column provider_started_at timestamptz,add column recording_authorized_at timestamptz,
  add column consent_at timestamptz,add column ended_at timestamptz,add column duration_seconds integer,add column call_ended_at timestamptz,
  add column end_requested_at timestamptz,add column provider_recording_price_micros bigint;
 create schema icash_recorded_reception_private;
 create table icash_recorded_reception_private.sessions(id uuid primary key,account_id uuid,operation_key text,rate_id uuid,provider_account_sid text,call_sid text,from_phone text,to_phone text,max_total_seconds integer,setup_claimed_at timestamptz,start_claimed_at timestamptz,created_at timestamptz);
 alter table public.icash_call_recordings add column agent_id text default 'agent_fixture',add column branch_id text default 'agtbrch_fixture',add column version_id text default 'agtvrsn_fixture';
 alter table icash_recorded_reception_private.sessions add column agent_id text default 'agent_fixture',add column branch_id text default 'agtbrch_fixture',add column version_id text default 'agtvrsn_fixture';
 create function public.icash_transition_recorded_reception(p_id uuid,p_account uuid,p_operation text,p_expected_version bigint,p_action text,p_payload jsonb) returns jsonb language plpgsql as $$declare r icash_recorded_reception_private.sessions;begin select * into strict r from icash_recorded_reception_private.sessions where id=p_id;if p_payload->'timeLimitSeconds' is distinct from to_jsonb(r.max_total_seconds) then return null;end if;return to_jsonb(r);end$$;
 create function public.icash_claim_operation(p_operation text) returns boolean language plpgsql as $$begin update public.icash_operation_spend set state='dispatched' where operation_key=p_operation and state='reserved';return found;end$$;
 create table public.icash_live_conversations(id uuid,account_id uuid,operation_key text,party text,state text,completed_at timestamptz);
 grant all on all tables in schema public to service_role;`);
 for(const name of ['icash_reserve_credit','icash_finish_credit','icash_daily_allowance'])await db.exec(fn('supabase/migrations/20261008182808_available_credit_usage.sql',name));
 await db.exec(fn('supabase/migrations/20260928015153_icash_atomic_credits_and_engine_evidence.sql','icash_post_credit'));
 await db.exec(fn('config/outbound-billing-queue.sql','icash_get_outbound_usage_settlement'));
 const sql=read('config/live-voice-metering.sql');await db.exec(sql);await db.exec(read('config/live-voice-metering-tickets.sql'));
 await db.exec(`create table public.fixture_clock(t timestamptz);insert into public.fixture_clock values('${now}');create or replace function icash_voice_meter_private.clock_now() returns timestamptz language sql volatile as $$select t from public.fixture_clock$$;`);
 await db.query('insert into public.icash_accounts values($1,false);',[acct]);
 await db.query('insert into public.icash_wallets values($1,1000,0)',[acct]);
 await db.query("insert into public.icash_operation_rates values($1,'seller_call','synthetic-test-rate-v1',600,1000,$2,2000,true,'2026-10-01','9999-12-31')",[rate,costs]);
 const add=async(n,{kind='outbound',legacy=false,callBound=true,balance}={})=>{
  const op=kind==='outbound'?'voice:'+id(n):'recorded-reception:'+sid(n),session=id(n),call=callBound?sid(n):null,callRate=kind==='outbound'?rate:id(3);
  if(kind==='inbound'){
   await db.query("insert into public.icash_operation_rates select $1,'incoming_call','synthetic-inbound-rate-v1',voice_max_duration_seconds,charge_cents,costs_micros,buffer_bps,enabled,verified_at,expires_at from public.icash_operation_rates where id=$2 on conflict do nothing",[callRate,rate]);
   await db.query("insert into icash_voice_meter_private.policies(rate_id,version,enabled,rate_snapshot,components,enforcement,reviewed_at,valid_until,upper_bound_evidence) select r.id,'synthetic-inbound-meter-v1',p.enabled,to_jsonb(r)-'enabled',p.components,p.enforcement,p.reviewed_at,p.valid_until,p.upper_bound_evidence from public.icash_operation_rates r cross join icash_voice_meter_private.policies p where r.id=$1 and p.rate_id=$2 on conflict do nothing",[callRate,rate]);
  }
  if(balance!==undefined)await db.query('update public.icash_wallets set balance_cents=$1',[balance]);
  await db.query("insert into public.icash_credit_reservations(account_id,operation_key,amount_cents,created_at) values($1,$2,1000,$3)",[acct,op,legacy?'2026-10-14':now]);
  await db.query("insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents) select $1,$2,$3,id,1000 from public.icash_credit_reservations where operation_key=$1",[op,acct,callRate]);
  await db.query('update public.icash_operating_budget set reserved_micros=reserved_micros+960000 where id=1');
  await db.query(`insert into ${kind==='outbound'?'public.icash_call_recordings':'icash_recorded_reception_private.sessions'}(id,account_id,operation_key,rate_id,provider_account_sid,call_sid,from_phone,to_phone,max_total_seconds,created_at) values($1,$2,$3,$4,$5,$6,'+12025550100','+12025550101',600,$7)`,[session,acct,op,callRate,ac,call,legacy?'2026-10-14':now]);
  return {op,session,call,kind,n};
 };
 const cancel=(x,account=acct,session=x.session)=>one('select public.icash_cancel_unstarted_voice_meter($1,$2,$3)',[account,x.op,session]);
 const prepare=x=>one('select public.icash_prepare_voice_meter($1,$2,$3,$4)',[acct,x.op,x.kind,x.session]);
 const call=(x,seconds=0,extra={})=>({sid:sid(x.n),account_sid:ac,from:'+12025550100',to:'+12025550101',direction:x.kind==='outbound'?'outbound-api':'inbound',status:'in-progress',start_time:now,duration:String(seconds),...extra});
 const clock=seconds=>db.query("update public.fixture_clock set t=$1::timestamptz+make_interval(secs=>$2)",[now,seconds]);
 const tick=(x,c=call(x))=>one('select public.icash_advance_voice_meter($1,$2)',[x.op,c]);
 const confirm=(x,version=1,seconds=120,c=call(x))=>one('select public.icash_confirm_voice_meter_limit($1,$2,$3,$4)',[x.op,version,seconds,c]);
 const wallet=()=>one('select balance_cents::integer from public.icash_wallets');
 const scenario=async(name,f)=>{await db.exec('begin');try{await f();console.log('PASS '+name);}finally{await db.exec('rollback');}};
 const rejects=async(f,pattern)=>{await db.exec('savepoint rejection');await assert.rejects(f(),pattern);await db.exec('rollback to savepoint rejection');};
 await scenario('disabled rollout does not backfill or change legacy usage',async()=>{
  const x=await add(10,{legacy:true});assert.equal((await prepare(x)).status,'disabled');assert.equal((await tick(x)).status,'disabled');assert.equal(await one('select count(*)::int from icash_voice_meter_private.meters'),0);assert.equal(await wallet(),1000);
  assert.equal(await one('select public.icash_next_voice_metering()'),null);
 });
 await db.exec(`update icash_voice_meter_private.settings set enabled=true,enabled_at='${now}';`);
 await scenario('missing enforced inclusive policy fails only new provider admission',async()=>{
  const x=await add(10);assert.equal((await prepare(x)).reason,'reviewed_upper_bound_required');
  await assert.rejects(db.query('update public.icash_call_recordings set dial_claimed_at=now() where id=$1',[x.session]),/Funded voice meter/);
 });
 const insertPolicy=(rules=components,bound=enforcement)=>db.query("insert into icash_voice_meter_private.policies(rate_id,version,enabled,rate_snapshot,components,enforcement,reviewed_at,valid_until,upper_bound_evidence) select id,'synthetic-meter-policy-v1',true,to_jsonb(r)-'enabled',$2,$3,'2026-10-02','9999-12-31','Synthetic enforced bound fixture, not provider evidence' from public.icash_operation_rates r where id=$1",[rate,rules,bound]);
 await assert.rejects(insertPolicy(components,{}),/Enforced inclusive/);await insertPolicy();
 await scenario('structured policy cannot self-certify an unsupported provider control',async()=>{
  const x=await add(10);assert.equal((await prepare(x)).reason,'enforced_cost_control_unavailable');assert.equal(await one('select count(*)::int from icash_voice_meter_private.meters'),0);
 });
 // Explicitly synthetic test-only provider control. Production code keeps this
 // gate false until an actual enforceable inclusive ceiling is implemented.
 await db.exec("create or replace function icash_voice_meter_private.enforcement_supported(p jsonb) returns boolean language sql immutable as $$select p->>'controlReceiptHash'=repeat('b',64)$$");
 await scenario('initial 120 second funding is internal, not max-call hold or debit',async()=>{
  const x=await add(10,{balance:96});const p=await prepare(x);assert.equal(p.status,'ready');assert.equal(p.meter.committedCents,96);assert.equal(p.meter.authorizedSeconds,120);assert.equal(await wallet(),96);assert.equal(await one('select reserved_cents::int from public.icash_wallets'),0);assert.equal(await one('select count(*)::int from public.icash_credit_ledger'),0);assert.deepEqual(await prepare(x),p);
 });
 await scenario('one cent below funded minimum refuses provider claim',async()=>{
  const x=await add(10,{balance:95});assert.equal((await prepare(x)).reason,'funded_minimum_unavailable');
 });
 await scenario('stale pre-dial funding cannot start a new provider call',async()=>{
  const x=await add(10);await prepare(x);await clock(61);await rejects(()=>db.query('update public.icash_call_recordings set dial_claimed_at=now() where id=$1',[x.session]),/Funded voice meter/);assert.equal(await one('select committed_cents::int from icash_voice_meter_private.meters'),96);
 });
 await scenario('exact unclaimed outbound cancellation releases only internal exposure once',async()=>{
  const x=await add(10,{callBound:false});await prepare(x);
  const before=await one('select to_jsonb(r) from public.icash_call_recordings r where id=$1',[x.session]);
  const original=await one('select to_jsonb(c) from public.icash_credit_reservations c where operation_key=$1',[x.op]);
  assert.equal(await one('select reserved_micros::int from public.icash_operating_budget'),960000);
  const a=await cancel(x);assert.equal(a.status,'cancelled');assert.equal(a.cancelled,true);assert.equal(a.alreadyCancelled,false);assert.equal(a.meter.committedCents,0);
  assert.equal((await cancel(x)).alreadyCancelled,true);assert.equal(await one('select reserved_micros::int from public.icash_operating_budget'),0);
  assert.equal(await wallet(),1000);assert.equal(await one('select reserved_cents::int from public.icash_wallets'),0);
  assert.equal(await one('select count(*)::int from public.icash_credit_ledger'),0);assert.equal(await one('select count(*)::int from public.icash_cost_manifests'),0);
  assert.deepEqual(await one('select to_jsonb(r) from public.icash_call_recordings r where id=$1',[x.session]),before,'Original session evidence is unchanged');
  assert.deepEqual(await one('select to_jsonb(c) from public.icash_credit_reservations c where operation_key=$1',[x.op]),{...original,status:'released'});
  assert.equal(await one("select cancellation_evidence->>'kind' from icash_voice_meter_private.meters"),'database_proven_unclaimed_outbound');
  assert.equal((await prepare(x)).reason,'meter_cancelled');assert.equal((await tick(x)).reason,'meter_cancelled');assert.equal(await confirm(x),false);
  assert.deepEqual(await one('select public.icash_voice_meter_due()'),[]);
  await db.exec('update icash_voice_meter_private.settings set enabled=false');
  await rejects(()=>db.query('update public.icash_call_recordings set dial_claimed_at=now() where id=$1',[x.session]),/Funded voice meter/);
  assert.equal(await one('select public.icash_claim_operation($1)',[x.op]),false);
 });
 await scenario('claim winning first, including lost acknowledgment, cannot be cancelled by timeout',async()=>{
  const x=await add(10,{callBound:false});await prepare(x);
  await db.query('update public.icash_call_recordings set dial_claimed_at=now() where id=$1',[x.session]);
  assert.equal((await cancel(x)).reason,'provider_start_not_disproved');await clock(86400);
  assert.equal((await cancel(x)).cancelled,false);assert.equal(await one('select public.icash_next_voice_metering()'),null);
  assert.equal(await one("select state from icash_voice_meter_private.meters"),'active');assert.equal(await one('select committed_cents::int from icash_voice_meter_private.meters'),96);
  assert.equal(await one('select reserved_micros::int from public.icash_operating_budget'),960000);assert.equal(await wallet(),1000);
 });
 await scenario('cancellation requires exact account, session and a new outbound meter',async()=>{
  const x=await add(10,{callBound:false});await prepare(x);
  assert.equal((await cancel(x,id(99))).cancelled,false);assert.equal((await cancel(x,acct,id(99))).cancelled,false);
  const legacy=await add(11,{legacy:true,callBound:false});assert.equal((await cancel(legacy)).cancelled,false);
  assert.equal(await one('select count(*)::int from icash_voice_meter_private.meters'),1);assert.equal(await one('select reserved_micros::int from public.icash_operating_budget'),1920000);
 });
 await scenario('a bound outbound or inbound carrier leg is not proven unstarted',async()=>{
  const x=await add(10,{balance:10000});await prepare(x);assert.equal((await cancel(x)).cancelled,false);
  const inbound=await add(11,{kind:'inbound'});await prepare(inbound);assert.equal((await cancel(inbound)).reason,'exact_new_outbound_meter_required');
  await clock(61);assert.equal(await one('select icash_voice_meter_private.recover_unstarted()'),0);
  assert.equal(await one('select sum(committed_cents)::int from icash_voice_meter_private.meters'),192);
 });
 await scenario('usage, provider evidence and broken reservation bindings never release reserve',async()=>{
  const x=await add(10,{callBound:false});await prepare(x);
  for(const mutation of [
   "update public.icash_credit_reservations set amount_cents=999",
   "update public.icash_credit_reservations set status='released'",
   "update public.icash_operation_spend set credit_reservation_id='"+id(99)+"'",
   "update public.icash_operation_spend set actual_micros=1",
   "update public.icash_operating_budget set reserved_micros=959999",
   "insert into public.icash_cost_observations values('twilio','fixture','"+x.op+"',0,'usd')",
   "insert into public.icash_cost_manifests values('"+x.op+"',0,0,'{}','Synthetic conflicting receipt')"
  ]){await db.exec('savepoint mutation');await db.exec(mutation);assert.equal((await cancel(x)).reason,'unspent_accounting_binding_required');await db.exec('rollback to savepoint mutation');}
  for(const mutation of [
   "update public.icash_call_recordings set recording_authorized_at=now()",
   "update public.icash_call_recordings set conversation_id='conv_fixture'",
   "update public.icash_call_recordings set duration_seconds=0",
   "update icash_voice_meter_private.meters set provisional_cents=1",
   "update icash_voice_meter_private.meters set confirmed_seconds=120",
   "update icash_voice_meter_private.meters set elapsed_seconds=1"
  ]){await db.exec('savepoint mutation');await db.exec(mutation);assert.equal((await cancel(x)).reason,'provider_start_not_disproved');await db.exec('rollback to savepoint mutation');}
  assert.equal(await one('select reserved_micros::int from public.icash_operating_budget'),960000);assert.equal(await one('select committed_cents::int from icash_voice_meter_private.meters'),96);
 });
 await scenario('bounded crash recovery filters claimed rows before pagination and preserves historical authorizations',async()=>{
  const legacy=await add(100,{legacy:true,callBound:false,balance:100000});
  for(let i=10;i<31;i++){const x=await add(i,{callBound:false});await prepare(x);if(i<30)await db.query('update public.icash_call_recordings set dial_claimed_at=now() where id=$1',[x.session]);}
  const another=await add(31,{callBound:false});await prepare(another);
  await clock(60);assert.equal(await one('select icash_voice_meter_private.recover_unstarted(1)'),0,'At exactly 60s claim can still be eligible');
  await clock(61);assert.equal(await one('select icash_voice_meter_private.recover_unstarted(1)'),1);
  assert.equal(await one("select count(*)::int from icash_voice_meter_private.meters where state='cancelled'"),1);
  assert.equal(await one('select public.icash_next_voice_metering()'),null);
  assert.equal(await one("select count(*)::int from icash_voice_meter_private.meters where state='cancelled'"),2);
  assert.equal(await one("select count(*)::int from icash_voice_meter_private.meters where state='active'"),20);
  assert.equal(await one('select status from public.icash_credit_reservations where operation_key=$1',[legacy.op]),'reserved');
  assert.equal(await one('select reserved_micros::int from public.icash_operating_budget'),21*960000);assert.equal(await one('select count(*)::int from public.icash_credit_ledger'),0);
  await rejects(()=>one('select icash_voice_meter_private.recover_unstarted(0)'),/Invalid recovery batch/);
 });
 await scenario('pending legacy usage remains read-only exposure',async()=>{
  const legacy=await add(11,{legacy:true}),x=await add(10,{balance:1050});assert.equal((await prepare(x)).reason,'funded_minimum_unavailable');assert.equal((await tick(legacy)).status,'disabled');assert.equal(await one('select count(*)::int from public.icash_credit_ledger'),0);
 });
 await scenario('serial admission contenders cannot fund the same 96 cents',async()=>{
  const a=await add(10,{balance:191});await prepare(a);const b=await add(11);assert.equal((await prepare(b)).reason,'funded_minimum_unavailable');assert.equal(await one('select count(*)::int from icash_voice_meter_private.meters'),1);
 });
 await scenario('cumulative rounding, duplicate ticks, fixed allocations and net final debit',async()=>{
  const x=await add(10);await prepare(x);assert.equal(await confirm(x),true);await clock(1);let a=await tick(x);assert.equal(a.meter.provisionalCents,34);assert.equal(await wallet(),966);assert.equal((await tick(x)).meter.provisionalCents,34);await clock(2);a=await tick(x);assert.equal(a.meter.provisionalCents,34,'ceil only cumulative charge, not per tick');await clock(10);a=await tick(x);assert.equal(a.meter.provisionalCents,36);assert.equal(await wallet(),964);
  const terminal=call(x,10,{status:'completed',end_time:new Date(Date.parse(now)+10000).toISOString()});await tick(x,terminal);await tick(x,terminal);
  await db.query('insert into public.icash_cost_manifests values($1,40,133333,$2,$3)',[x.op,{},'Verified final synthetic receipt']);
  assert.equal(await one('select public.icash_finish_credit($1,$2,40,$3)',[acct,x.op,'Verified final synthetic receipt']),'settled');assert.equal(await wallet(),960);assert.equal(await one('select public.icash_finish_credit($1,$2,40,$3)',[acct,x.op,'Verified final synthetic receipt']),'settled');assert.equal(await wallet(),960);assert.equal(await one('select public.icash_voice_meter_settlement_valid($1,$2,40,$3)',[acct,x.op,'Verified final synthetic receipt']),true);
 });
 await scenario('provisional overestimate refunds exact excess without inventing purchase or debt',async()=>{
  const x=await add(10);await prepare(x);await confirm(x);await clock(20);await tick(x);await tick(x,call(x,20,{status:'completed',end_time:new Date(Date.parse(now)+20000).toISOString()}));await db.query('insert into public.icash_cost_manifests values($1,20,60000,$2,$3)',[x.op,{},'Verified lower synthetic receipt']);await one('select public.icash_finish_credit($1,$2,20,$3)',[acct,x.op,'Verified lower synthetic receipt']);assert.equal(await wallet(),980);assert.equal(await one('select sum(delta_cents)::int from public.icash_credit_ledger'),-20);assert.equal(await one('select count(*)::int from public.icash_usage_coverage'),0);
 });
 await scenario('renewal funds the next slice before command and waits for exact acknowledgment',async()=>{
  const x=await add(10);await prepare(x);await confirm(x);await clock(60);const a=await tick(x);assert.equal(a.desiredTimeLimit,180);assert.equal(a.meter.version,2);assert.equal(a.meter.confirmedSeconds,120);assert.equal(await confirm(x,1,180),false);assert.equal(await confirm(x,2,180),true);assert.equal((await tick(x)).meter.authorizedSeconds,180);
 });
 await scenario('unknown extension never releases committed funds',async()=>{
  const x=await add(10);await prepare(x);await confirm(x);await clock(60);const a=await tick(x);await clock(121);const b=await tick(x);assert.equal(b.terminate,true);assert.equal(b.meter.committedCents,a.meter.committedCents);assert.equal(b.meter.state,'stopping');assert.equal(await one('select reserved_cents::int from public.icash_wallets'),0);
 });
 await scenario('last funded segment cannot be reused by text or refund-out',async()=>{
  const x=await add(10,{balance:100});await prepare(x);await db.exec('savepoint expected_error');await assert.rejects(one('select public.icash_reserve_credit($1,$2,5)',[acct,'text:fixture']),/committed/);await db.exec('rollback to savepoint expected_error');
  await assert.rejects(one("select public.icash_post_credit($1,'withdrawal','refund',-5,'Synthetic refund authorization')",[acct]),/committed/);
 });
 await scenario('shortfall never posts unlimited platform coverage or partial settlement',async()=>{
  const x=await add(10);await prepare(x);await clock(10);await tick(x,call(x,10,{status:'completed',end_time:new Date(Date.parse(now)+10000).toISOString()}));await db.query('insert into public.icash_cost_manifests values($1,97,323333,$2,$3)',[x.op,{},'Synthetic out of bound receipt']);await assert.rejects(one('select public.icash_finish_credit($1,$2,97,$3)',[acct,x.op,'Synthetic out of bound receipt']),/funded ceiling/);
 });
 await scenario('inbound cap attests 120, not its 600 second business limit',async()=>{
  const x=await add(10,{kind:'inbound'});await prepare(x);assert.equal(await confirm(x),true);assert(await one('select public.icash_transition_recorded_reception($1,$2,$3,1,$4,$5)',[x.session,acct,x.op,'bounded',{timeLimitSeconds:120}]));assert.equal(await one('select public.icash_transition_recorded_reception($1,$2,$3,1,$4,$5)',[x.session,acct,x.op,'bounded',{timeLimitSeconds:600}]),null);
 });
 await scenario('lost dial response recovers only exact saved session call SID',async()=>{
  const x=await add(10,{callBound:false});await prepare(x);await db.query('update public.icash_call_recordings set call_sid=$1 where id=$2',[sid(10),x.session]);const due=await one('select public.icash_voice_meter_due()');assert.equal(due[0].callSid,sid(10));assert.equal(await confirm(x),true);
 });
 await scenario('one-use capability exact binding, lease expiry and disabling admission preserve exposure',async()=>{
  const x=await add(10);const p=await prepare(x);const claim=await one('select public.icash_next_voice_metering()');assert(claim.token);assert.equal(await one('select public.icash_next_voice_metering()'),null);
  const ticket=await one('select public.icash_consume_voice_metering($1)',[claim.token]);assert.equal(ticket.meter.operationKey,x.op);assert.equal(ticket.meter.sessionId,x.session);assert.equal(await one('select public.icash_consume_voice_metering($1)',[claim.token]),null);
  await clock(31);const next=await one('select public.icash_next_voice_metering()');assert(next.token&&next.token!==claim.token);await clock(62);assert.equal(await one('select public.icash_consume_voice_metering($1)',[next.token]),null);
  await db.exec('update icash_voice_meter_private.settings set enabled=false');assert((await one('select public.icash_next_voice_metering()')).token);assert.equal(await one('select committed_cents::int from icash_voice_meter_private.meters'),p.meter.committedCents);assert.equal(await wallet(),1000);
 });
 await scenario('twenty unknown dial admissions do not starve a canonically bound call',async()=>{
  for(let i=10;i<30;i++){const x=await add(i,{callBound:false,balance:100000});assert.equal((await prepare(x)).status,'ready');}
  const bound=await add(30);assert.equal((await prepare(bound)).status,'ready');const due=await one('select public.icash_voice_meter_due(20)');assert.equal(due.length,1);assert.equal(due[0].operationKey,bound.op);
  const claim=await one('select public.icash_next_voice_metering()');const ticket=await one('select public.icash_consume_voice_metering($1)',[claim.token]);assert.equal(ticket.meter.operationKey,bound.op);assert.equal(await one("select count(*)::int from icash_voice_meter_private.meters where call_sid is null"),20,'Unknown admission exposure is retained, not silently released');
 });
 await scenario('wrong tenant, SID, number, direction and future observations cannot debit',async()=>{
  const x=await add(10);await prepare(x);await clock(10);
  for(const patch of [{sid:sid(99)},{account_sid:'AC'+'f'.repeat(32)},{from:'+12025550199'},{to:'+12025550199'},{direction:'inbound'},{start_time:'2026-10-15T18:00:00Z'}])await rejects(()=>tick(x,call(x,0,patch)),/binding|start required/);
  await rejects(()=>one('select public.icash_advance_voice_meter($1,$2,$3)',[x.op,call(x),'2026-10-15T18:00:00Z']),/Fresh canonical/);assert.equal(await wallet(),1000);
 });
 await scenario('late receipts cannot move start or resurrect a terminal meter',async()=>{
  const x=await add(10);await prepare(x);await confirm(x);await clock(10);await tick(x);
  await rejects(()=>tick(x,call(x,0,{start_time:'2026-10-15T16:59:59Z'})),/Immutable carrier start/);
  const terminal=call(x,10,{status:'completed',end_time:new Date(Date.parse(now)+10000).toISOString()});await tick(x,terminal);
  await rejects(()=>tick(x),/Terminal call receipt conflict/);await rejects(()=>tick(x,{...terminal,duration:'11'}),/Terminal call receipt conflict/);assert.equal(await confirm(x),false);
 });
 await scenario('zero final receipt returns all provisional credit once',async()=>{
  const x=await add(10);await prepare(x);await clock(10);await tick(x);await tick(x,call(x,10,{status:'completed',end_time:new Date(Date.parse(now)+10000).toISOString()}));await db.query('insert into public.icash_cost_manifests values($1,0,0,$2,$3)',[x.op,{},'Verified zero synthetic receipt']);
  assert.equal(await one('select public.icash_finish_credit($1,$2,0,$3)',[acct,x.op,'Verified zero synthetic receipt']),'released');assert.equal(await wallet(),1000);assert.equal(await one('select public.icash_voice_meter_settlement_valid($1,$2,0,$3)',[acct,x.op,'Verified zero synthetic receipt']),true);
 });
 await scenario('existing paid nonvoice claims and receipts cannot consume a funded voice interval',async()=>{
  const x=await add(10,{balance:200});await prepare(x);
  await db.query("insert into public.icash_credit_reservations(account_id,operation_key,amount_cents,created_at) values($1,'text:prior',150,'2026-10-14')",[acct]);await db.query("insert into public.icash_operation_spend(operation_key,account_id,rate_id,state,charge_cap_cents) values('text:prior',$1,$2,'reserved',150)",[acct,rate]);
  assert.equal(await one("select public.icash_claim_operation('text:prior')"),false);await rejects(()=>one("select public.icash_finish_credit($1,'text:prior',150,'Verified synthetic text receipt')",[acct]),/committed to active calls/);assert.equal(await wallet(),200);
 });
 await scenario('fixed costs cannot be prorated and policy edits cannot rewrite evidence',async()=>{
  await rejects(()=>db.exec("update icash_voice_meter_private.policies set upper_bound_evidence='Changed synthetic pricing approval'"),/Version metering policies/);
  await rejects(()=>db.exec("update icash_voice_meter_private.policies set components=jsonb_set(components,'{other,amountMicros}','1')"),/Version metering policies/);
 });
 await scenario('pricing enforcement must bind the exact immutable agent version',async()=>{
  const x=await add(10);await db.query("update public.icash_call_recordings set version_id='agtvrsn_other' where id=$1",[x.session]);assert.equal((await prepare(x)).reason,'enforced_provider_configuration_mismatch');
 });
 await scenario('original outbound settlement readback accepts summed debit, not a duplicate full debit',async()=>{
  const x=await add(10);await prepare(x);await clock(10);await tick(x,call(x,10,{status:'completed',end_time:new Date(Date.parse(now)+10000).toISOString()}));
  const parts=Object.fromEntries(categories.map(k=>[k,{amountMicros:k==='elevenlabs'?133333:0,evidenceRef:'Verified synthetic final provider costs'}]));
  await db.query('insert into public.icash_cost_manifests values($1,40,133333,$2,$3)',[x.op,parts,'Verified final synthetic receipt']);await one('select public.icash_finish_credit($1,$2,40,$3)',[acct,x.op,'Verified final synthetic receipt']);
  await db.query("update public.icash_operation_spend set state='settled',charged_cents=40,actual_micros=133333,settlement_evidence='Verified final synthetic receipt' where operation_key=$1",[x.op]);
  await db.query("insert into public.icash_live_conversations values($1,$2,$3,'seller','complete',$4)",[x.session,acct,x.op,now]);
  const result=await one('select public.icash_get_outbound_usage_settlement($1,$2)',[acct,x.session]);assert.equal(result.settled,true);assert.equal(result.chargedCents,40);assert.equal(await wallet(),960);assert.equal(await one("select delta_cents::int from public.icash_credit_ledger where event_key='usage:'||$1",[x.op]),-4);
 });
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);await assert.rejects(db.query('select * from icash_voice_meter_private.meters'),/permission denied/);await assert.rejects(db.query('select icash_voice_meter_private.recover_unstarted()'),/permission denied/);await assert.rejects(db.query('select public.icash_finish_credit_before_meter($1,$2,0,$3)',[acct,'missing','Cannot bypass metering']),/permission denied/);await db.exec('reset role');
  if(role!=='service_role'){await db.exec('set role '+role);await assert.rejects(cancel({op:'voice:missing',session:id(99)}),/permission denied/);await assert.rejects(db.query('select public.icash_next_voice_metering()'),/permission denied/);await assert.rejects(db.query('select public.icash_consume_voice_metering($1)',['invalid']),/permission denied/);await db.exec('reset role');}
 }
 console.log('PASS no production calls, tariff activation, or historical ledger mutation. PGlite verifies serial claim/cancel orders only; no native PostgreSQL binaries/runtime are available, so actual multi-session debit/admission/receipt contention and deadlock behavior remain unverified.');
}finally{await db.close();}
