import {readFileSync} from 'node:fs';
import {setupSql,seedSql,migration as timeoutMigration,id,refreshDefinition} from './learning-timeout-fixture.mjs';
export {id,refreshDefinition};
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const migration=read('config/learning-completion-lock-isolation.sql');
export const setup=setupSql+timeoutMigration+seedSql;
export const screeningSetup=`
 alter table public.icash_accounts add column bot_paused boolean not null default false;
 create table public.icash_wallets(account_id uuid primary key,balance_cents bigint not null,reserved_cents bigint not null);
 insert into public.icash_wallets select id,1000,0 from public.icash_accounts;
 create schema icash_research_private;
`+read('supabase/migrations/20260928220238_screening_job_queue.sql')+read('config/financial-screening-recovery.sql')+`
 create trigger icash_learning_change after insert or delete or update on public.icash_screening_jobs
 for each row execute function public.icash_learning_changed();
`;
export const value=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]??{})[0];
export const sourceHash=db=>value(db,"select md5(pg_get_functiondef('public.icash_refresh_shared_learning(integer)'::regprocedure))");
export const reset=`
 update public.fixture_outcomes set value=0;
 update public.icash_learning_queue set generation=1,due_at=now()-interval '4 minutes'+substring(account_id::text from 25)::integer*interval '1 second',last_attempt_at=null,last_success_at=null,last_error_at=null,last_error_code=null,last_refreshed_at=null;
 update public.icash_learning_conversion_cache set updated_at=now();
 delete from icash_learning_private.components;
 delete from icash_learning_private.refresh_runs;
`;
