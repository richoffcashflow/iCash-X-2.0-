// Compose the original capacity-recovery functions with the real request limiter.
// Used only by disposable PGlite/PostgreSQL tests; no provider transport.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
export function starterExportFixtureSql(){
 let foundation=read('tests/fixtures/automatic-export-foundation.sql')
  .replace(/create role (anon|authenticated|service_role);/g,'')
  .replace('create schema icash_research_private;','')
  .replace(/^create table icash_research_private.requests\(.*\);$/m,'');
 const start=foundation.indexOf('create function public.icash_dealmachine_capacity_available');
 const end=foundation.indexOf('create function public.icash_owner_active_export_capacity',start);
 foundation=foundation.slice(0,start)+foundation.slice(end);
 let late=read('tests/fixtures/unknown-export-late-foundation.sql')
  .replace(/^create table icash_research_private.targeting_settings.*$/m,'alter table icash_research_private.targeting_settings add column mobile_verified boolean default false;')
  .replace(/^insert into icash_research_private.targeting_settings.*$/m,'')
  .replace(/^create function public.icash_dealmachine_capacity_available.*$/m,'');
 return [foundation,...[
  'config/owner-export-capacity-recovery.sql','supabase/migrations/20261030012215_owner_export_capacity_precision.sql',
  'config/automatic-export-capacity.sql','config/gateway-export-capacity.sql','config/empty-export-capacity.sql',
  'config/empty-export-immediate-capacity.sql','tests/fixtures/unknown-export-foundation.sql',
 ].map(read),late,...[
  'tests/fixtures/unknown-export-late-live-functions.sql','tests/fixtures/unknown-export-late-batch-function.sql',
  'config/unknown-export-capacity.sql','config/unknown-export-late-evidence.sql',
 ].map(read),`alter table public.icash_discovery_configs add column contacts_enabled boolean default true,
  add column next_run_at timestamptz default now(),add column fixture_candidate boolean default true;
 create function public.icash_enrichment_before_provider_quota(p_account uuid) returns uuid language sql stable
  set search_path='' as $$select c.account_id from public.icash_discovery_configs c where c.account_id=p_account and c.fixture_candidate$$;`
 ].join('\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.stdout.write(starterExportFixtureSql());
