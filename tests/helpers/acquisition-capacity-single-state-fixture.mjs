import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installHeadroomFixture} from './acquisition-headroom-fixture.mjs';
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const migration=read('config/acquisition-capacity-single-state.sql');
export const migrationPath='supabase/migrations/20261117040822_acquisition_capacity_single_state.sql';
export const sources=JSON.parse(read('tests/fixtures/acquisition-capacity-single-state-before.json'));
export const value=async(db,s,a=[])=>Object.values((await db.query(s,a)).rows[0]??{})[0];
export const signature='public.icash_acquisition_capacity_available(uuid)';
export const definition=db=>value(db,'select pg_get_functiondef($1::regprocedure)',[signature]);
export const policy=db=>value(db,'select to_jsonb(p) from icash_research_private.acquisition_headroom_policy p');
export const evidence=db=>value(db,`select jsonb_build_object(
 'budget',(select to_jsonb(b) from public.icash_dealmachine_request_budget b),
 'operating',(select to_jsonb(b) from public.icash_operating_budget b),
 'reserve',(select to_jsonb(p) from icash_research_private.request_reserve_policy p),
 'pacing',(select to_jsonb(p) from icash_research_private.request_pacing_policy p),
 'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from icash_research_private.requests r),
 'reserveAdmissions',(select coalesce(jsonb_agg(to_jsonb(r) order by request_id),'[]') from icash_research_private.request_reserve_admissions r),
 'maintenanceAdmissions',(select coalesce(jsonb_agg(to_jsonb(r) order by request_id),'[]') from icash_research_private.maintenance_request_admissions r))`);
export async function installSingleStateFixture(db){
 await installHeadroomFixture(db);
 await db.exec(read('config/acquisition-quota-headroom.sql'));
 await db.exec(read('config/acquisition-headroom-scheduler-scope.sql'));
 await db.exec(`create table public.icash_operating_budget(id integer primary key,enabled boolean not null default true);
 insert into public.icash_operating_budget(id) values(1);
 update public.icash_dealmachine_request_budget set day_start=now()-interval '12 hours',day_used=4669,minute_start=now(),minute_used=0;
 update icash_research_private.acquisition_headroom_policy set enabled=true,activated_at=clock_timestamp(),release_sha=repeat('a',40);`);
 // Keep the real stable reserve/capacity bodies and privilege metadata. This
 // fixture exercises actual quota arithmetic; no provider boundary is called.
 for(const s of sources){
  assert.equal(await value(db,'select md5(pg_get_functiondef($1::regprocedure))',[s.signature]),s.md5,s.signature);
 }
 const old=await definition(db);
 await db.exec(old.replace('FUNCTION public.icash_acquisition_capacity_available(p_account uuid)',
  'FUNCTION public.fixture_capacity_before(p_account uuid)'));
 await db.exec('revoke all on function public.fixture_capacity_before(uuid) from public,anon,authenticated,service_role;');
}
export async function instrumentReserveReads(db){
 const original=await value(db,"select pg_get_functiondef('icash_research_private.request_reserve_state(timestamptz)'::regprocedure)");
 await db.exec(`create sequence public.fixture_reserve_reads;`);
 await db.exec(original.replace('begin\n',"begin\n perform nextval('public.fixture_reserve_reads');\n"));
 return async()=>{await db.exec(original);await db.exec('drop sequence public.fixture_reserve_reads');};
}
export async function countReserveReads(db,fn){
 await db.exec("alter sequence public.fixture_reserve_reads restart with 1;");
 await db.query(`select bool_and(public.${fn}(('00000000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid)) from generate_series(1,100) n`);
 return await value(db,'select case when is_called then last_value else 0 end::int from public.fixture_reserve_reads');
}
