// Actual SQL over synthetic accounts; no provider requests or production data.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {setupSql,seedSql,migration,id,refreshDefinition,cancelSecond} from './helpers/learning-timeout-fixture.mjs';
const db=new PGlite(),q=(sql,args=[])=>db.query(sql,args),v=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const values=()=>v('select array_agg(value order by account_id) from public.fixture_outcomes');
const reset=()=>db.exec("update public.fixture_outcomes set value=0;update public.icash_learning_queue set due_at=now()-interval '1 minute',last_attempt_at=null,last_success_at=null,last_error_at=null,last_error_code=null;update public.icash_learning_conversion_cache set updated_at=now();delete from icash_learning_private.components;");
try{
 await db.exec(setupSql+seedSql+cancelSecond);
 await assert.rejects(q('select icash_refresh_shared_learning(3)'),e=>e.code==='57014');
 assert.deepEqual(await values(),[0,0,0],'Old timeout rolls back earlier successful accounts');
 assert.equal(await v('select count(*)::int from icash_learning_private.refresh_runs'),0);
 await db.exec(migration);
 const file=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_learning_timeout_isolation.sql'));
 assert(file,'Forward migration is registered');assert.equal(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'),migration);
 assert.deepEqual(await v('select icash_refresh_shared_learning(3)'),{refreshed:1,failed:1,due:1,canceled:true});
 assert.deepEqual(await values(),[1,0,0],'Prior account persists, canceled account rolls back, later account waits');
 assert.equal(await v('select last_error_code from icash_learning_queue where account_id=$1',[id(2)]),'57014');
 assert.equal(await v("select last_error_code from icash_learning_private.components where component='refresh'"),'57014');
 assert.equal(await v("select last_success_at from icash_learning_private.components where component='refresh'"),null);
 // A fresh source generation remains due, but cannot spin on the same canceled account.
 await q("update icash_learning_queue set generation=generation+1,due_at=now()-interval '1 minute' where account_id=$1",[id(2)]);
 await db.exec(refreshDefinition());
 assert.deepEqual(await v('select icash_refresh_shared_learning(3)'),{refreshed:1,failed:0,due:1});
 assert.deepEqual(await values(),[1,0,1]);
 await q("update icash_learning_queue set last_error_at=now()-interval '6 minutes' where account_id=$1",[id(2)]);
 assert.deepEqual(await v('select icash_refresh_shared_learning(3)'),{refreshed:1,failed:0,due:0});
 assert.equal(await v('select generation from icash_learning_queue where account_id=$1',[id(2)]),2);
 assert.equal(await v('select last_error_code from icash_learning_queue where account_id=$1',[id(2)]),null);
 // Ordinary per-account errors retain existing independent-account continuation.
 await reset();await db.exec(refreshDefinition(`if p_account='${id(2)}' then raise exception 'Synthetic ordinary failure';end if;`));
 assert.deepEqual(await v('select icash_refresh_shared_learning(3)'),{refreshed:2,failed:1,due:0});
 assert.deepEqual(await values(),[1,0,1]);
 // Canceled optional conversion work gets a visible bounded backoff; next run can progress.
 await reset();await db.exec(refreshDefinition());await v('select icash_refresh_shared_learning(3)');
 assert.equal((await v('select icash_learning_health()')).status,'ok');
 await db.exec("update icash_learning_queue set due_at=now();update icash_learning_conversion_cache set updated_at=now()-interval '6 minutes';create or replace function public.icash_usage_loop_report(uuid,boolean) returns jsonb language plpgsql as $$begin raise exception using errcode='57014',message='Synthetic cancellation';end$$;");
 assert.deepEqual(await v('select icash_refresh_shared_learning(3)'),{refreshed:0,failed:1,due:3,canceled:true});
 assert.deepEqual(await values(),[1,1,1]);
 assert.equal(await v("select last_error_code from icash_learning_private.components where component='conversion'"),'57014');
 assert.equal((await v('select icash_learning_health()')).status,'degraded','A recent cache with a failed refresh is not healthy');
 assert.deepEqual(await v('select icash_refresh_shared_learning(3)'),{refreshed:3,failed:0,due:0});
 assert.equal(await v("select last_error_code from icash_learning_private.components where component='conversion'"),'57014','Independent success cannot erase failed conversion');
 assert.equal((await v('select icash_learning_health()')).status,'degraded');
 await db.exec("update icash_learning_private.components set last_error_at=now()-interval '6 minutes' where component='conversion';create or replace function public.icash_usage_loop_report(uuid,boolean) returns jsonb language sql as $$select '{}'::jsonb$$;");
 await v('select icash_refresh_shared_learning(3)');assert.equal((await v('select icash_learning_health()')).status,'ok','Successful original phase clears its own error');
 // A late review cancellation also preserves the already completed account work.
 await reset();await db.exec("create or replace function public.icash_review_learning_operations() returns jsonb language plpgsql as $$begin raise exception using errcode='57014',message='Synthetic cancellation';end$$;");
 assert.deepEqual(await v('select icash_refresh_shared_learning(3)'),{refreshed:3,failed:1,due:0,canceled:true});
 assert.deepEqual(await values(),[1,1,1]);
 assert.equal(await v("select last_error_code from icash_learning_private.components where component='review'"),'57014');
 assert.equal(await v("select last_success_at from icash_learning_private.components where component='refresh'"),null);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await v("select has_function_privilege($1,'public.icash_refresh_shared_learning(integer)','execute')",[role]),role==='service_role');
 await assert.rejects(db.exec(migration),/predecessor changed/);await db.exec('rollback');
 console.log('Learning cancellation: reproduced lost batch, isolated rollback, fair retry, generation preservation, cache/review errors, private grants and drift guard passed.');
}finally{await db.close();}
