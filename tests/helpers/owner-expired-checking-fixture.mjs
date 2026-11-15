import {fixtureSql,stepPrerequisites,stepSql,continuationSql,read} from './owner-expired-ticket-fixture.mjs';
export {stepSql,continuationSql,read};
export const checkingSql=read('supabase/migrations/20261115002841_owner_expired_checking_continuation.sql');
const quota=read('config/owner-preflight-quota-recovery.sql');
const immutable=quota.slice(quota.indexOf('create function icash_research_private.guard_owner_preflight_quota_deferral'),quota.indexOf('create function public.icash_defer_owner_preflight_quota'));
const resume=quota.slice(quota.indexOf('create function icash_research_private.owner_preflight_quota_resume'),quota.indexOf('do $patch$')).replace('create function','create or replace function');
export const baseSql=fixtureSql+stepPrerequisites+`;
alter table icash_research_private.owner_preflight_quota_deferrals add column request_id uuid unique,add column step text,
 add column started_at timestamptz,add column receipts_hash text,add column created_at timestamptz default clock_timestamp();
`+immutable+resume+`;
update icash_research_private.owner_export_settings set preflight_quota_recovery_enabled=true;
create function public.fixture_expired_checking_seed(n integer) returns jsonb language plpgsql as $$
declare c jsonb;p icash_research_private.owner_export_preflights;denial uuid:=gen_random_uuid();baseline uuid:=gen_random_uuid();receipt jsonb;
begin
 c:=public.fixture_expired_ticket_seed(n);
 alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable;
 receipt:=jsonb_build_object('httpStatus',200,'raw',jsonb_build_object('total_people',1,'total_results',1,'total_properties',1),'rawText','{"total_people":1,"total_results":1,"total_properties":1}');
 update icash_research_private.owner_export_preflights set state='checking',created_at=now()-interval '2 hours',started_at=now()-interval '110 minutes',
  receipts=receipts||jsonb_build_object('baseline',receipt) where id=(c->>'preflight')::uuid returning * into p;
 alter table icash_research_private.owner_export_preflights enable trigger owner_preflight_immutable;
 update public.icash_automation_tickets set outcome='owner_preview_rate_limited',created_at=p.started_at,completed_at=p.started_at+interval '5 seconds',
  expires_at=p.started_at+interval '5 seconds',owner_preview_retry_after=p.started_at+interval '35 seconds' where id=(c->>'ticket')::uuid;
 insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result)values
 (baseline,'owner_preview',p.account_id,'owner-preflight:'||p.id||':baseline',true,p.started_at+interval '1 second',p.started_at+interval '3 seconds','{"outcome":"response","httpStatus":200}'::jsonb),
 (denial,'owner_preview',p.account_id,'owner-preflight:'||p.id||':eligible',false,p.started_at+interval '4 seconds',null,'{"outcome":"quota_wait"}'::jsonb);
 insert into icash_research_private.owner_preflight_quota_deferrals(preflight_id,lease,request_id,step,started_at,receipts_hash,created_at)
 values(p.id,p.lease,denial,'eligible',p.started_at,md5(p.receipts::text),p.started_at+interval '5 seconds');
 return c||jsonb_build_object('denial',denial,'baseline',baseline);
end$$;
`;
