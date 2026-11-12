import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),sql=read('config/completion-reliability.sql');
assert.equal(sql,read('supabase/migrations/20261112210539_completion_reliability.sql'));
const pg=await PGlite.create(),v=async s=>Object.values((await pg.query(s)).rows[0]??{})[0];
try{
 await pg.exec(read('tests/fixtures/learning-refresh-concurrency.sql')+read('config/learning-refresh-concurrency.sql'));
 await pg.exec(`create schema cron;create table cron.job(jobid int,jobname text,schedule text,active boolean,command text);
 insert into cron.job values(1,'icash-shared-learning-refresh','15 seconds',true,'set lock_timeout=''1s'';set statement_timeout=''12s'';select public.icash_refresh_shared_learning(2);');
 create function cron.alter_job(job_id integer,command text) returns void language sql as $$update cron.job set command=$2 where jobid=$1$$;
 insert into icash_accounts select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,30) i;
 insert into fixture_outcomes(account_id) select id from icash_accounts;
 insert into icash_learning_queue(account_id,due_at) select id,now()+interval '1 hour' from icash_accounts;`);
 await pg.exec(sql.split('-- BEGIN learning catchup')[1].split('-- END learning catchup')[0]);
 assert.match(await v('select command from cron.job'),/icash_refresh_learning_due\(\)/);
 assert.deepEqual(await v('select icash_refresh_learning_due()'),{refreshed:0,failed:0,due:0});
 await pg.exec("update icash_learning_queue set due_at=now() where account_id in(select id from icash_accounts order by id limit 3)");
 assert.deepEqual(await v('select icash_refresh_learning_due()'),{refreshed:2,failed:0,due:1});
 await pg.exec("update icash_learning_queue set due_at=now()-interval '6 minutes' where due_at<=now()");
 assert.deepEqual(await v('select icash_refresh_learning_due()'),{refreshed:1,failed:0,due:0});
 await pg.exec('update icash_learning_queue set due_at=now()');
 assert.deepEqual(await v('select icash_refresh_learning_due()'),{refreshed:5,failed:0,due:25});
 await pg.exec("set fixture.fail='true'");
 assert.deepEqual(await v('select icash_refresh_learning_due()'),{refreshed:0,failed:5,due:20});
 assert.equal(await v('select count(*)::int from icash_learning_queue where last_error_at is not null'),5,'Original per-account failure isolation survives catch-up');
 for(const role of ['anon','authenticated'])assert.equal(await v(`select has_function_privilege('${role}','icash_refresh_learning_due()','execute')`),false);
 console.log('PASS bounded learning catch-up: idle/small/large/old queues, existing locks, per-account failures, private ACL and unchanged 15-second schedule.');
}finally{await pg.close();}
