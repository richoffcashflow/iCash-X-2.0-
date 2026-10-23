import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const migration=readFileSync(new URL('../supabase/migrations/20261023160000_scheduler_nonblocking_poll.sql',import.meta.url),'utf8');
const db=new PGlite();
const value=async sql=>Object.values((await db.query(sql)).rows[0])[0];
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table fixture_calls(kind text);
 create function public.icash_resume_prospecting_ticket() returns jsonb language plpgsql as $$begin insert into public.fixture_calls values('resume');return nullif(current_setting('fixture.retry',true),'')::jsonb;end$$;
 create function public.icash_next_before_prospecting_budget() returns jsonb language plpgsql as $$begin insert into public.fixture_calls values('next');return '{"token":"normal-fixture"}'::jsonb;end$$;`);
 await db.exec(migration);
 assert.deepEqual(await value('select public.icash_next_automation()'),{token:'normal-fixture'});
 await db.exec(`set fixture.retry='{"token":"held-fixture"}';truncate fixture_calls;`);
 assert.deepEqual(await value('select public.icash_next_automation()'),{token:'held-fixture'});
 assert.equal(await value('select count(*)::int from fixture_calls'),1,'A resumed ticket must not also claim new work');
 assert.equal(await value("select has_function_privilege('anon','public.icash_next_automation()','execute')"),false);
 assert.equal(await value("select has_function_privilege('authenticated','public.icash_next_automation()','execute')"),false);
 assert.equal(await value("select has_function_privilege('service_role','public.icash_next_automation()','execute')"),true);
 // PGlite has one backend. Inject only the contested-lock result to exercise
 // the fail-fast branch without pretending to test native lock concurrency.
 await db.exec(`create function public.fixture_busy_lock(bigint) returns boolean language sql as $$select false$$;truncate fixture_calls;`);
 await db.exec(migration.replace('pg_try_advisory_xact_lock(726341927)','public.fixture_busy_lock(726341927)'));
 assert.equal(await value('select public.icash_next_automation()'),null);
 assert.equal(await value('select count(*)::int from fixture_calls'),0,'Overlapping poll neither queues nor issues duplicate work');
 console.log('Scheduler: real lock success, retry priority, restricted grants and simulated lock-contention no-op passed.');
}finally{await db.close();}
