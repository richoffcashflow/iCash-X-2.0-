import assert from 'node:assert/strict';
import {baseSql,stepSql,continuationSql,checkingSql,read} from './owner-expired-checking-fixture.mjs';
export {read};
export const captured=JSON.parse(read('tests/fixtures/continued-owner-scheduling-before.json'));
export const signature='public.icash_next_acquisition()';
export const value=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]??{})[0];

// Actual production selector/candidate/retry/source/recorder functions run on
// synthetic original tickets. Only unrelated provider/service boundaries are
// fixtures; no recreated JavaScript ranking or scheduler substitutes are used.
export async function installContinuedSchedulingFixture(db){
 const exec=sql=>db.exec?db.exec(sql):db.query(sql);
 await exec(baseSql);
 await exec(`create table icash_work_private.dispatch_policy(id integer primary key,enabled boolean);
 insert into icash_work_private.dispatch_policy values(1,true);
 create table icash_work_private.acquisition_export_waits(account_id uuid primary key references public.icash_discovery_configs(account_id) on delete cascade,
  waiting_since timestamptz not null,updated_at timestamptz not null default clock_timestamp());
 alter table icash_work_private.acquisition_export_waits enable row level security;
 revoke all on icash_work_private.acquisition_export_waits from public,anon,authenticated;
 create table icash_research_private.acquisition_headroom_policy(id integer primary key,enabled boolean not null default true,
  capacity_hash text not null default '',activated_at timestamptz,release_sha text,acquisition_hash text not null default '',resume_hash text not null default '');
 insert into icash_research_private.acquisition_headroom_policy(id,activated_at,release_sha) values(1,now()-interval '1 day',repeat('a',40));
 create function icash_work_private.warm_seller_due(uuid) returns boolean language sql stable as $$select false$$;
 create function public.icash_new_user_request_reserve_eligible(uuid) returns boolean language sql stable as $$select false$$;
 create or replace function icash_research_private.request_reserve_state(timestamptz default now()) returns jsonb language sql stable as $$
  select jsonb_build_object('ordinaryRemaining',ordinary,'reserveRemaining',starter,'pacingActive',true,'ordinaryUnpacedRemaining',1000) from public.fixture_cleanup_policy$$;
 alter table icash_work_private.continuation_policy add column release_sha text,add column activated_at timestamptz,
  add column scheduler_hash text not null default '',add column due_hash text not null default '',add column recorder_hash text not null default '';
 create table icash_work_private.continuation_decisions(
  ticket_id uuid not null references public.icash_automation_tickets(id),account_id uuid not null,screening_id uuid,preflight_id uuid,
  continuation boolean not null,turn bigint primary key,recorded_at timestamptz not null default clock_timestamp(),
  issue_token_hash text not null check(issue_token_hash~'^[a-f0-9]{64}$'),unique(ticket_id,issue_token_hash));
 alter table icash_work_private.continuation_policy enable row level security;
 alter table icash_work_private.continuation_decisions enable row level security;
 create function icash_work_private.preserve_continuation_decision() returns trigger
 language plpgsql set search_path='' as $$begin raise exception 'Continuation decisions are append-only';end$$;
 create trigger preserve_continuation_decision before update or delete or truncate on icash_work_private.continuation_decisions
  for each statement execute function icash_work_private.preserve_continuation_decision();`);
 const headroom=read('config/acquisition-headroom-scheduler-scope.sql'),retry=read('config/owner-retry-fair-priority.sql');
 await exec(headroom.slice(headroom.indexOf('create function public.icash_acquisition_capacity_available'),headroom.indexOf('\ndo $$\ndeclare s text;',headroom.indexOf('create function public.icash_acquisition_capacity_available'))));
 await exec(retry.slice(retry.indexOf('create function public.icash_owner_retry_due_at'),retry.indexOf('\ndo $patch$')));
 await exec('begin;'+stepSql+continuationSql+checkingSql+'commit;');
 // Captured current production definitions must agree with the source-bound
 // manifests. Installing the fixtures cannot bless a mismatched dependency.
 for(const f of captured)await exec(f.definition);
 for(const f of JSON.parse(read('tests/fixtures/owner-wait-admission-before.json')))await exec(f.definition);
 await exec('begin;'+read('config/owner-expired-ticket-deadlines.sql')+'commit;');
 for(const fn of ['icash_work_private.activate_preflight_step_capacity','icash_research_private.activate_expired_preflight_ticket_continuation','icash_research_private.activate_expired_checking_continuation']){
  assert.equal(await value(db,`select ${fn}(repeat('b',40))`),true);
 }
 // Preserve the original activation manifest hashes, which predate later
 // independently reviewed selector overlays. The upgrade pins both these
 // historical receipts and the complete current function definitions.
 await exec(`update icash_work_private.continuation_policy set enabled=true,release_sha=repeat('a',40),activated_at=now()-interval '1 day',
  scheduler_hash='af79d3cf17140cf94eff5ade974d9c84',due_hash='5af0c8dd0a364999f031a76ea8fa89a2',
  recorder_hash=md5(pg_get_functiondef('icash_work_private.record_continuation_decision(uuid,uuid,uuid,boolean)'::regprocedure));
 update icash_research_private.acquisition_headroom_policy set acquisition_hash='f18773412034944d2eb90b7f6d94202f',
  capacity_hash=md5(pg_get_functiondef('public.icash_dealmachine_capacity_available(integer,uuid)'::regprocedure));
 grant usage on schema public,icash_private,icash_research_private,icash_work_private to service_role;
 grant select,insert,update,delete on all tables in schema public to service_role;
 grant select on all tables in schema icash_private,icash_research_private,icash_work_private to service_role;
 grant insert,update,delete on icash_work_private.acquisition_export_waits to service_role;
 revoke all on function public.icash_next_acquisition(),icash_work_private.record_continuation_decision(uuid,uuid,uuid,boolean),icash_work_private.record_export_wait(uuid,timestamptz) from public,anon,authenticated;
 grant execute on function public.icash_next_acquisition(),icash_work_private.record_continuation_decision(uuid,uuid,uuid,boolean),icash_work_private.record_export_wait(uuid,timestamptz) to service_role;`);
}

async function moveFixtureSource(db,c,account){
  // Fixture construction only: place a second original on one account before
  // its immutable journal exists, then restore every source guard before any
  // production continuation/cleanup/selector function runs.
  await db.query('alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable');
  await db.query('update icash_research_private.owner_export_preflights set account_id=$1 where id=$2',[account,c.preflight]);
  await db.query('alter table icash_research_private.owner_export_preflights enable trigger owner_preflight_immutable');
  for(const table of ['icash_research_private.owner_export_preflight_items','public.icash_screening_jobs','public.icash_automation_tickets','icash_research_private.requests']){
   await db.query(`update ${table} set account_id=$1 where account_id=$2`,[account,c.account]);
  }
  await db.query('update public.icash_automation_tickets t set owner_preview_screening_hash=public.icash_owner_enrichment_screening_hash(s) from public.icash_screening_jobs s where t.screening_id=s.id and t.id=$1',[c.ticket]);
  await db.query('delete from public.icash_discovery_configs where account_id=$1',[c.account]);
  c.account=account;c.rate=await value(db,'select contact_rate_id from public.icash_discovery_configs where account_id=$1',[account]);
}
export async function seedContinued(db,n,{checking=true,deadlineMinutes=20,cleanup=true,account=null}={}){
 const c=await value(db,`select public.${checking?'fixture_expired_checking_seed':'fixture_expired_ticket_seed'}($1)`,[n]);
 if(account)await moveFixtureSource(db,c,account);
 await db.query('update public.icash_automation_tickets set owner_preview_retry_until=now()+make_interval(mins=>$2) where id=$1',[c.ticket,deadlineMinutes]);
 assert.equal((await value(db,'select public.icash_continue_expired_owner_preflight_ticket()')).ticketId,c.ticket);
 if(cleanup){
  const claim=checking?await value(db,'select public.icash_admit_expired_checking_cleanup($1,$2,gen_random_uuid())',[c.account,c.preflight]):await value(db,'select public.icash_claim_owner_preflight_cleanup($1)',[c.preflight]);
  assert(claim?.token,'Original cleanup must be admitted');
  assert.equal(await value(db,'select public.icash_record_owner_preflight_cleanup($1,$2,$3)',[c.preflight,claim.token,JSON.stringify({httpStatus:200,raw:{data:{deleted:true}},rawText:'{"data":{"deleted":true}}'})]),true);
 }
 await db.query("update public.icash_discovery_configs set next_run_at=now()-interval '1 minute' where account_id=$1",[c.account]);
 return c;
}
export const seedOrdinary=(db,n)=>value(db,"select public.fixture_preflight_seed($1,false,interval '20 minutes')",[n]);
export async function seedLive(db,n,minutesLeft=20,account=null){
 const c=await value(db,'select public.fixture_preflight_seed($1,true)',[n]);
 if(account)await moveFixtureSource(db,c,account);
 await db.query('alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable');
 await db.query("update icash_research_private.owner_export_preflights set created_at=now()-make_interval(mins=>30-$2),started_at=now()-make_interval(mins=>30-$2) where id=$1",[c.preflight,minutesLeft]);
 await db.query('alter table icash_research_private.owner_export_preflights enable trigger owner_preflight_immutable');
 return c;
}
export async function seedReady(db,n,minutesLeft=8){
 const c=await value(db,'select public.fixture_ready_seed($1)',[n]);
 await db.query('alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable');
 await db.query("update icash_research_private.owner_export_preflights set checked_at=now()-make_interval(mins=>30-$2),started_at=now()-make_interval(mins=>30-$2)-interval '10 seconds',deleted_at=now()-make_interval(mins=>30-$2)+interval '1 second' where id=$1",[c.preflight,minutesLeft]);
 await db.query('alter table icash_research_private.owner_export_preflights enable trigger owner_preflight_immutable');
 return c;
}
export async function issue(db){
 const result=await value(db,'select public.icash_next_acquisition()');
 return result?value(db,'select to_jsonb(t) from public.icash_automation_tickets t where token=$1',[result.token]):null;
}
export const source=(db,c)=>value(db,'select to_jsonb(p) from icash_research_private.owner_export_preflights p where id=$1',[c.preflight]);
export const original=(db,c)=>value(db,'select to_jsonb(t) from public.icash_automation_tickets t where id=$1',[c.ticket]);
export const decisions=db=>value(db,"select coalesce(jsonb_agg(to_jsonb(d) order by turn),'[]'::jsonb) from icash_work_private.continuation_decisions d");
