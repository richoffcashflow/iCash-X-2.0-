import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export function followupCheckpointSetup(){
 const base=read('config/parallel-work-throughput.sql');
 const schema=base.slice(base.indexOf('create table icash_work_private.account_followups('),base.indexOf('create index account_followups_due'));
 const efficiency=read('config/runtime-cost-efficiency.sql');
 const finish=efficiency.slice(efficiency.indexOf('create or replace function public.icash_finish_account_followup('),efficiency.indexOf('revoke all',efficiency.indexOf('create or replace function public.icash_finish_account_followup(')));
 return [read('tests/fixtures/account-work-repair.sql'),
  `create schema icash_work_private;grant usage on schema icash_work_private to service_role;
   alter table public.icash_automation_tickets add column id uuid primary key default gen_random_uuid(),add column completed_at timestamptz,add column outcome text;`,schema,
  `alter table icash_work_private.account_followups add column unchanged_attempts integer not null default 0,add column failure_attempts integer not null default 0;`,
  read('tests/fixtures/followup-context-20261114.sql'),
  // Capture only the original finisher, not the unrelated notification helper.
  finish.slice(0,finish.indexOf('end $function$;')+'end $function$;'.length),
  `grant select,insert,update on icash_work_private.account_followups to service_role;
   grant usage on schema public to anon,authenticated,service_role;
   revoke all on function icash_account_followup_context(uuid,uuid),icash_finish_account_followup(uuid,uuid,boolean) from public,anon,authenticated;
   grant execute on function icash_account_followup_context(uuid,uuid),icash_finish_account_followup(uuid,uuid,boolean) to service_role;`].join('\n;\n');
}
