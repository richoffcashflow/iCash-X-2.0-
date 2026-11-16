// Actual source-pinned SQL; synthetic accounts and no providers.
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {setup,migration,read,id,refreshDefinition,value,reset,sourceHash} from './helpers/learning-completion-fixture.mjs';
const db=new PGlite(),v=(sql,args=[])=>value(db,sql,args);
try{
 await db.exec(setup);
 assert.equal(await sourceHash(db),'62d7625004e807cd463088b173dbba5d');
 const predecessor=await v("select pg_get_functiondef('icash_refresh_shared_learning(integer)'::regprocedure)");
 const metadata=()=>v("select jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'volatile',provolatile) from pg_proc where oid='icash_refresh_shared_learning(integer)'::regprocedure");
 const before=await metadata();
 await db.exec('begin;'+migration);
 await assert.rejects(db.query('select 1/0 as synthetic_ledger_failure'),/division by zero/);
 await db.exec('rollback');
 assert.equal(await sourceHash(db),'62d7625004e807cd463088b173dbba5d','An outer ledger failure rolls back the function change');
 assert.deepEqual(await metadata(),before);
 await db.exec('begin;'+migration+'commit;');
 assert.deepEqual(await metadata(),before,'Function rights and metadata stay identical');
 const file=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_learning_completion_lock_isolation.sql'));
 assert(file);assert.equal(read('supabase/migrations/'+file),migration);
 const fixed=await v("select pg_get_functiondef('icash_refresh_shared_learning(integer)'::regprocedure)");
 assert(fixed.indexOf('for completion in')>fixed.indexOf('perform public.icash_review_learning_operations()'));
 assert(fixed.indexOf('for completion in')>fixed.indexOf('delete from icash_learning_private.refresh_runs'));
 assert.equal((fixed.match(/update public.icash_learning_queue/g)||[]).length,2);
 for(const [name,statement,expected,values] of [
  ['success','',{refreshed:3,failed:0,due:0},[1,1,1]],
  ['failure',`if p_account='${id(2)}' then raise exception 'Synthetic failure';end if;`,{refreshed:2,failed:1,due:0},[1,0,1]],
  ['cancellation',`if p_account='${id(2)}' then raise exception using errcode='57014',message='Synthetic cancellation';end if;`,{refreshed:1,failed:1,due:1,canceled:true},[1,0,0]],
  ['notification',`if p_account='${id(2)}' then update public.icash_learning_queue set generation=generation+1 where account_id='${id(1)}';end if;`,{refreshed:3,failed:0,due:1},[1,1,1]],
 ]){
  await db.exec(reset+refreshDefinition(statement));
  assert.deepEqual(await v('select icash_refresh_shared_learning(3)'),expected,name);
  assert.deepEqual(await v('select array_agg(value order by account_id) from fixture_outcomes'),values,name);
  if(name==='notification')assert.equal(await v('select generation from icash_learning_queue where account_id=$1',[id(1)]),2);
  if(name==='cancellation')assert.equal(await v('select last_error_code from icash_learning_queue where account_id=$1',[id(2)]),'57014');
 }
 // Global operation review still runs, but before any completion row is locked.
 await db.exec(reset+refreshDefinition()+`create or replace function public.icash_review_learning_operations() returns jsonb language plpgsql as $$begin
  update public.icash_learning_queue set generation=generation+1 where account_id='${id(1)}';
  return '{}'::jsonb;end$$;`);
 assert.deepEqual(await v('select icash_refresh_shared_learning(3)'),{refreshed:3,failed:0,due:1});
 assert.equal(await v('select last_refreshed_at from icash_learning_queue where account_id=$1',[id(1)]),null);
 await db.exec(reset+`create or replace function public.icash_review_learning_operations() returns jsonb language plpgsql as $$begin raise exception using errcode='57014';end$$;`);
 assert.deepEqual(await v('select icash_refresh_shared_learning(3)'),{refreshed:3,failed:1,due:0,canceled:true});
 assert.equal(await v("select last_error_code from icash_learning_private.components where component='refresh'"),'57014');
 for(const invalid of ['null','0','6'])await assert.rejects(v(`select icash_refresh_shared_learning(${invalid})`),/Invalid learning batch/);
 await assert.rejects(db.exec('begin;'+migration+'commit;'),/predecessor changed/);await db.exec('rollback');
 assert.equal(await v("select pg_get_functiondef('icash_refresh_shared_learning(integer)'::regprocedure)"),fixed);
 // Guard mismatch cannot partially alter a function or its metadata.
 await db.exec(predecessor.replace('due integer;','due integer;unused integer;'));
 await assert.rejects(db.exec('begin;'+migration+'commit;'),/predecessor changed/);await db.exec('rollback');
 assert.deepEqual(await metadata(),before);
 console.log('Learning completion: bounded deferred checkpoints, success/error/cancel preservation, concurrent generation semantics, unchanged rights and drift refusal passed.');
}finally{await db.close();}
