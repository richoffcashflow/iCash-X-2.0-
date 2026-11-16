import {installContinuedSchedulingFixture,seedOrdinary,value,read} from './continued-owner-scheduling-fixture.mjs';
export {seedLive,seedReady,seedContinued,seedOrdinary,issue,source,original,decisions,value,read} from './continued-owner-scheduling-fixture.mjs';
export const exec=(db,sql)=>db.exec?db.exec(sql):db.query(sql);
// The complete captured scheduler now calls the actual original wait function.
// Install the reviewed mixed-deadline overlay, leaving only the wait correction
// unapplied so tests can reproduce both original bookkeeping failures.
export async function installOwnerWaitFixture(db){
 await installContinuedSchedulingFixture(db);
 await exec(db,'begin;'+read('config/continued-owner-scheduling.sql')+'commit;');
 await exec(db,`create sequence public.fixture_wait_score_calls;
 create or replace function public.icash_opportunity_score(uuid,jsonb,text) returns numeric language sql stable as $$
  select case when nextval('public.fixture_wait_score_calls')>0 then coalesce(($2->>'fixtureScore')::numeric,0) end$$;
 grant usage,select on sequence public.fixture_wait_score_calls to service_role;`);
}
export async function seedWaitBatch(db,n,count=200){
 const c=await seedOrdinary(db,n);
 if(count<2)throw Error('Wait batch needs the two original fixture candidates');
 await db.query(`insert into public.icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at)
  select md5('wait-candidate-'||$2||'-'||i)::uuid,s.account_id,'wait-candidate-'||$2||'-'||i,
   jsonb_set(jsonb_set(s.snapshot,'{propertyId}',to_jsonb('prop_'||($2::bigint*1000+i))),'{raw,data,dm_property_id}',to_jsonb('prop_'||($2::bigint*1000+i))),
   'complete',jsonb_build_object('financialCheck',jsonb_build_object('status','eligible'),'fixtureScore',i),s.completed_at
  from public.icash_screening_jobs s cross join generate_series(1,$3::integer-2)i where s.id=$1`,[c.screening,n,count]);
 return c;
}
export const resetScoreCalls=db=>db.query("select setval('public.fixture_wait_score_calls',1,false)");
export const scoreCalls=db=>value(db,'select case when is_called then last_value else 0 end::integer from public.fixture_wait_score_calls');
export const recordWait=(db,c)=>value(db,'select icash_work_private.record_export_wait($1,(select next_run_at from public.icash_discovery_configs where account_id=$1))',[c.account]);
export const waitRow=(db,c)=>value(db,'select to_jsonb(w) from icash_work_private.acquisition_export_waits w where account_id=$1',[c.account]);
export const candidateExists=(db,c)=>value(db,'select icash_work_private.owner_enrichment_wait_candidate($1)',[c.account]);
export const beforeCandidate=(db,c)=>value(db,'select public.icash_enrichment_before_provider_quota($1)',[c.account]);
export const evidence=db=>value(db,`select jsonb_build_object(
 'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb) from icash_research_private.requests r),
 'spend',(select coalesce(jsonb_agg(to_jsonb(o) order by operation_key),'[]'::jsonb) from public.icash_operation_spend o),
 'credits',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb) from public.icash_credit_reservations r),
 'wallets',(select coalesce(jsonb_agg(to_jsonb(w) order by account_id),'[]'::jsonb) from public.icash_wallets w))`);
