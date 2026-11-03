import {readFileSync} from 'node:fs';
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const reviewed=JSON.parse(read('tests/fixtures/owner-preflight-indexing-before.json'));
export async function setupIndexingFixture(pg){
 await pg.exec(read('tests/fixtures/opportunity-schema.sql'));
 await pg.exec(read('tests/fixtures/owner-cleanup-ticket-recovery-native.sql'));
 let src=read('config/owner-enrichment-deferral.sql');await pg.exec(src.slice(0,src.indexOf('create function public.icash_defer_owner_enrichment'))+'commit;');
 await pg.exec(src.slice(src.indexOf('create function public.icash_defer_owner_enrichment'),src.indexOf('-- A delayed response')));
 src=read('config/owner-export-preflight.sql');await pg.exec(src.slice(0,src.indexOf('create function public.icash_claim_owner_preflight'))+'commit;');
 src=read('config/owner-preflight-renewal.sql');await pg.exec(src.slice(0,src.indexOf('create function icash_research_private.guard_owner_preflight_generation'))+'commit;');
 await pg.exec(read('tests/fixtures/owner-preflight-priority-foundation.sql'));
 const before=JSON.parse(read('tests/fixtures/owner-preflight-priority-before.json'));
 for(const name of ['icash_research_private.owner_preflight_cohort(uuid,uuid)','public.icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid)',
  'public.icash_enrichment_before_prospecting_budget(uuid)','public.icash_enrichment_before_provider_quota(uuid)','public.icash_enrichment_candidate(uuid)','public.icash_next_acquisition()'])await pg.exec(before[name]);
 await pg.exec(read('config/owner-preflight-priority.sql'));
 await pg.exec(read('tests/fixtures/owner-preflight-ready-foundation.sql'));
 const ready=JSON.parse(read('tests/fixtures/owner-preflight-ready-before.json'));
 for(const name of ['public.icash_owner_batch_candidates(uuid,uuid)','public.icash_admit_owner_active_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)'])await pg.exec(ready[name].definition);
 await pg.exec(reviewed['icash_research_private.owner_preflight_ready_current(uuid)'].definition);
 for(const {definition} of Object.values(reviewed))await pg.exec(definition);
 src=read('config/owner-export-preflight.sql');await pg.exec(src.slice(src.indexOf('create function public.icash_record_owner_preflight_cleanup'),src.indexOf('-- Keep final purchase authority')));
 await pg.exec(`update icash_research_private.owner_export_settings set preflight_enabled=true;
  revoke all on all functions in schema public from public,anon,authenticated;
  grant execute on all functions in schema public to service_role;
  grant select,insert,update on all tables in schema public to service_role;
  grant usage on schema icash_private to service_role;grant select on all tables in schema icash_private to service_role;`);
}
