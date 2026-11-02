import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(name=>name.endsWith('_learning_refresh_concurrency.sql'));
assert.equal(read('supabase/migrations/'+migration),read('config/learning-refresh-concurrency.sql'));
const db=new PGlite(),q=(sql,args=[])=>db.query(sql,args),value=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const account='00000000-0000-4000-8000-000000000001';
try{
 await db.exec(read('tests/fixtures/learning-refresh-concurrency.sql'));
 await db.exec(read('supabase/migrations/'+migration));
 await db.exec('create trigger learning_change after insert or update on public.icash_discovery_configs for each row execute function public.icash_learning_changed();');
 await q('insert into icash_accounts values($1)',[account]);
 await q('insert into fixture_outcomes(account_id) values($1)',[account]);
 await q('insert into icash_discovery_configs(account_id) values($1)',[account]);
 const snapshot=()=>value('select to_jsonb(q) from icash_learning_queue q where account_id=$1',[account]);
 const revision=()=>value('select revision from icash_workspace_revisions where account_id=$1',[account]);
 const before=await snapshot(),rev=await revision();
 await q("update icash_discovery_configs set next_run_at=now()+interval '1 minute',updated_at=now() where account_id=$1",[account]);
 assert.deepEqual(await snapshot(),before,'Scheduling-only changes do not enqueue learning');
 assert.equal(await revision(),rev,'Scheduling-only changes do not invalidate the workspace');
 await q('update icash_discovery_configs set enabled=false where account_id=$1',[account]);
 assert.equal(Number((await snapshot()).generation),2);
 assert.equal(Number(await revision()),Number(rev)+1,'Real configuration changes still wake readers');
 let result=await value('select icash_refresh_shared_learning(1)');
 assert.deepEqual(result,{refreshed:1,failed:0,due:0});
 assert(await value("select due_at>now()+interval '59 minutes' from icash_learning_queue"));
 assert.equal(await value('select value from fixture_outcomes'),1);
 for(const invalid of ['null','0','6'])await assert.rejects(value(`select icash_refresh_shared_learning(${invalid})`),/Invalid learning batch/);
 // A new notification during refresh must not be pushed back one hour.
 await q("update icash_learning_queue set due_at=now()-interval '1 minute'");
 await q("set fixture.wake='true'");
 result=await value('select icash_refresh_shared_learning(1)');
 assert.deepEqual(result,{refreshed:1,failed:0,due:1});
 assert.equal(Number((await snapshot()).generation),3);
 await q("set fixture.wake='false'");
 result=await value('select icash_refresh_shared_learning(1)');
 assert.deepEqual(result,{refreshed:1,failed:0,due:0});
 // Failed aggregates roll back and retry after five minutes, without changing
 // source receipts, privacy, paid work or the public API's grants.
 await q("update icash_learning_queue set due_at=now()-interval '1 minute'");
 await q("set fixture.fail='true'");
 const count=await value('select value from fixture_outcomes');
 result=await value('select icash_refresh_shared_learning(1)');
 assert.deepEqual(result,{refreshed:0,failed:1,due:0});
 assert.equal(await value('select value from fixture_outcomes'),count);
 assert(await value("select last_error_at is not null and due_at between now()+interval '4 minutes' and now()+interval '6 minutes' from icash_learning_queue"));
 for(const role of ['anon','authenticated'])assert.equal(await value(`select has_function_privilege('${role}','icash_refresh_shared_learning(integer)','execute')`),false);
 assert.equal(await value("select has_function_privilege('service_role','icash_refresh_shared_learning(integer)','execute')"),true);
 console.log('Learning refresh: generation-bound completion, fresh wakeups, bounded retries, scheduling-only updates and ACLs passed. Native contention is checked separately in CI.');
}finally{await db.close();}
