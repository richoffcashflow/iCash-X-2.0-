import {readFileSync} from 'node:fs';
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const signature='icash_work_private.live_owner_preflight_deadline(uuid,uuid)';
export const migration=read('config/collector-preflight-deadline-plan.sql');
export const original=read('tests/fixtures/collector-live-deadline-before.sql');
export const marker='  from icash_research_private.owner_export_preflights p\n';
export const replacement=`  from (
   select * from icash_research_private.owner_export_preflights
   where p_screening is null
   union all
   select * from icash_research_private.owner_export_preflights
   where p_screening is not null and items->0->>'screeningId'=p_screening::text
  ) p
`;
export const value=async(pg,sql,args=[])=>Object.values((await pg.query(sql,args)).rows[0]??{})[0];
export const catalog=pg=>value(pg,`select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'security',prosecdef,'volatility',provolatile,'config',proconfig,'definition',pg_get_functiondef(oid)) from pg_proc where oid='${signature}'::regprocedure`);
export const policy=pg=>value(pg,'select to_jsonb(p) from icash_work_private.continuation_policy p where id=1');
export const history=pg=>value(pg,`select jsonb_build_object('screenings',(select jsonb_agg(s order by id) from public.icash_screening_jobs s),'tickets',(select jsonb_agg(t order by id) from public.icash_automation_tickets t),'preflights',(select jsonb_agg(p order by id) from icash_research_private.owner_export_preflights p),'spend',(select jsonb_agg(o order by operation_key) from public.icash_operation_spend o),'settings',(select to_jsonb(f) from public.fixture_settings f))`);
export const deadlines=pg=>pg.query(`select n,icash_work_private.live_owner_preflight_deadline(public.fid(100000),case when n=0 then null else public.fid(n) end)::text deadline from generate_series(0,120)n` ).then(r=>r.rows);
export async function installCollectorDeadlineFixture(pg){
 await pg.exec(`do $$begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;
 end$$;`);
 await pg.exec(read('tests/fixtures/collector-deadline-foundation.sql'));
 await pg.exec(original);
 await pg.exec(`revoke all on function ${signature} from public,anon,authenticated,service_role;
 grant execute on function ${signature} to service_role;
 grant usage on schema icash_work_private to service_role;
 create table public.icash_operating_budget(id integer primary key,enabled boolean);insert into public.icash_operating_budget values(1,true);
 create function icash_work_private.continued_owner_preflight_source(uuid,uuid,uuid) returns boolean language sql stable as $$select false$$;
 create function icash_work_private.continued_owner_preflight_deadline(uuid,uuid) returns timestamptz language sql stable as $$select null::timestamptz$$;
 create function public.icash_enrichment_before_prospecting_budget(uuid) returns uuid language sql stable as $$select null::uuid$$;
 create table icash_work_private.continuation_policy(id integer primary key,enabled boolean,activated_at timestamptz,release_sha text,issued bigint,scheduler_hash text,recorder_hash text,continued_original_hashes jsonb,other_state jsonb);
 insert into icash_work_private.continuation_policy values(1,true,now()-interval '1 day',repeat('a',40),19,'untouched-scheduler','untouched-recorder',
  (select jsonb_object_agg(s,md5(pg_get_functiondef(s::regprocedure))) from unnest(array[
  '${signature}','icash_work_private.continued_owner_preflight_source(uuid,uuid,uuid)',
  'icash_work_private.continued_owner_preflight_deadline(uuid,uuid)','public.icash_enrichment_before_prospecting_budget(uuid)'])s),'{"unrelated":"preserved"}');
 alter table icash_work_private.continuation_policy enable row level security;
 revoke all on icash_work_private.continuation_policy from public,anon,authenticated,service_role;`);
}
export const edgeCases=[
 ['waiting',`update icash_research_private.owner_export_preflights set state='waiting',created_at=now()-interval '1 minute',next_check_at=now()-interval '1 second' where id=public.fid(1)`],
 ['waiting_future',`update icash_research_private.owner_export_preflights set state='waiting',created_at=now()-interval '1 minute',next_check_at=now()+interval '1 second' where id=public.fid(1)`],
 ['waiting_expired',`update icash_research_private.owner_export_preflights set state='waiting',created_at=now()-interval '30 minutes',next_check_at=now()-interval '1 second' where id=public.fid(1)`],
 ['ready_boundary',`update icash_research_private.owner_export_preflights set checked_at=now()-interval '30 minutes' where id=public.fid(1)`],
 ['ready_future',`update icash_research_private.owner_export_preflights set checked_at=now()+interval '1 second' where id=public.fid(1)`],
 ['unknown_list',`update icash_research_private.owner_export_preflights set known=false where id=public.fid(1)`],
 ['ready_source_rejected',`update icash_research_private.owner_export_preflights set ready_current=false where id=public.fid(1)`],
 ['held_source',`update icash_research_private.owner_export_preflights set state='held' where id=public.fid(1)`],
 ['deleted_waiting',`update icash_research_private.owner_export_preflights set state='waiting',created_at=now()-interval '1 minute',next_check_at=now()-interval '1 second',deleted_at=now() where id=public.fid(1)`],
 ['cleanup_waiting',`update icash_research_private.owner_export_preflights set state='waiting',created_at=now()-interval '1 minute',next_check_at=now()-interval '1 second',cleanup_attempts=1 where id=public.fid(1)`],
 ['ticket_retry_future',`update public.icash_automation_tickets set owner_preview_retry_after=now()+interval '1 second' where id=public.fid(1)`],
 ['ticket_retry_expired',`update public.icash_automation_tickets set owner_preview_retry_until=now() where id=public.fid(1)`],
 ['ticket_deferrals_zero',`update public.icash_automation_tickets set owner_preview_deferrals=0 where id=public.fid(1)`],
 ['ticket_deferrals_eight',`update public.icash_automation_tickets set owner_preview_deferrals=8 where id=public.fid(1)`],
 ['ticket_source_changed',`update public.icash_automation_tickets set owner_preview_screening_hash='changed' where id=public.fid(1)`],
 ['wrong_ticket_account',`update public.icash_automation_tickets set account_id=public.fid(100002) where id=public.fid(1)`],
 ['cohort_mismatch',`update icash_research_private.owner_export_preflights set items=items||jsonb_build_array(jsonb_build_object('screeningId',public.fid(2)::text)) where id=public.fid(1)`],
 ['no_capacity',`update public.fixture_settings set capacity3=false,capacity2=false`],
 ['two_step_only',`update public.fixture_settings set capacity3=false`],
 ['two_step_rejected',`update public.fixture_settings set capacity3=false;update icash_research_private.owner_export_preflights set two_step=false where id=public.fid(1)`],
 ['retry_source_rejected',`update public.fixture_settings set retry_current=false`],
 ['original_dispatched',`insert into public.icash_operation_spend values('owners:'||public.fid(100000)||':'||public.fid(1),public.fid(100000),'dispatched')`],
 ['nullable_known',`update icash_research_private.owner_export_preflights set known=null where id=public.fid(1)`],
 ['nullable_ready',`update icash_research_private.owner_export_preflights set ready_current=null where id=public.fid(1)`],
 ['nullable_retry',`update public.fixture_settings set retry_current=null`],
 ['nullable_capacity',`update public.fixture_settings set capacity3=null,capacity2=false`],
 ['null_items',`update icash_research_private.owner_export_preflights set items=null where id=public.fid(1)`],
 ['missing_primary',`update icash_research_private.owner_export_preflights set items='[{}]'::jsonb where id=public.fid(1)`],
 ['missing_fetched_at',`update public.icash_screening_jobs set snapshot=snapshot-'fetchedAt' where id=public.fid(1);update public.icash_automation_tickets set owner_preview_screening_hash=(select md5(snapshot::text) from public.icash_screening_jobs where id=public.fid(1)) where id=public.fid(1)`],
 ['malformed_fetched_at',`update public.icash_screening_jobs set snapshot=jsonb_set(snapshot,'{fetchedAt}','"not-a-timestamp"'::jsonb) where id=public.fid(1);update public.icash_automation_tickets set owner_preview_screening_hash=(select md5(snapshot::text) from public.icash_screening_jobs where id=public.fid(1)) where id=public.fid(1)`],
 ['null_completed_at',`update public.icash_screening_jobs set completed_at=null where id=public.fid(1)`],
];
// FetchedAt/completedAt NULL behavior below intentionally reflects PostgreSQL
// LEAST and the permissive retry stub, NOT a claim of real-source admission.
export const positiveEdges=new Set(['waiting','two_step_only','missing_fetched_at','malformed_fetched_at','null_completed_at']);
