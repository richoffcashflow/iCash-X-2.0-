import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
// Shared with native PostgreSQL: compile and execute exact captured production
// selector/retry bodies. Only unrelated service boundaries use synthetic data.
export function continuationSetup(){
 const before=JSON.parse(read('tests/fixtures/owner-preflight-priority-before.json'));
 const live=JSON.parse(read('tests/fixtures/stalled-work-production-20261114.json'));
 const retries=JSON.parse(read('tests/fixtures/stalled-work-retry-20261114.json'));
 let deferral=read('config/owner-enrichment-deferral.sql');
 let preflight=read('config/owner-export-preflight.sql');
 return [read('tests/fixtures/opportunity-schema.sql'),read('tests/fixtures/owner-cleanup-ticket-recovery-native.sql'),
  deferral.slice(0,deferral.indexOf('create function public.icash_defer_owner_enrichment'))+'commit;',
  preflight.slice(0,preflight.indexOf('create function public.icash_claim_owner_preflight'))+'commit;',
  read('tests/fixtures/owner-preflight-priority-foundation.sql'),
  ...['icash_research_private.owner_preflight_cohort(uuid,uuid)','public.icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid)',
   'public.icash_enrichment_before_prospecting_budget(uuid)','public.icash_enrichment_before_provider_quota(uuid)',
   'public.icash_enrichment_candidate(uuid)','public.icash_next_acquisition()'].map(k=>before[k]),
  read('config/owner-preflight-priority.sql'),read('tests/fixtures/stalled-work-continuation.sql'),
  ...['owner_preflight_ready_current','owner_preflight_list_known','owner_preflight_cohort'].map(name=>JSON.parse(read('tests/fixtures/stalled-work-preflight-20261114.json')).find(x=>x.proname===name).definition),
  retries.find(x=>x.proname==='icash_owner_enrichment_retry_current').definition,
  live.icash_owner_preflight_due_at,live.icash_next_acquisition,
  `update icash_research_private.owner_export_settings set preflight_enabled=true;
   grant select,insert,update,delete on all tables in schema public to service_role;
   grant usage on schema icash_private,icash_work_private to service_role;
   grant select on all tables in schema icash_private,icash_work_private to service_role;
   grant insert,update,delete on icash_work_private.acquisition_export_waits to service_role;
   revoke all on function icash_next_acquisition(),icash_owner_preflight_due_at(uuid,uuid) from public,anon,authenticated;
   grant execute on function icash_next_acquisition(),icash_owner_preflight_due_at(uuid,uuid) to service_role;`].join('\n;\n');
}
