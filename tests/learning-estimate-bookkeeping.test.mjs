import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {setup,migration,read,id,value,sourceHash,metadata,progress} from './helpers/learning-estimate-fixture.mjs';
const db=new PGlite(),q=(s,a=[])=>db.query(s,a),v=(s,a=[])=>value(db,s,a);
try{
 await db.exec(setup);
 assert.equal(await sourceHash(db),'821d84ea09d109cfdd5b1272a0745509');
 const original=await v("select pg_get_functiondef('public.icash_learning_changed()'::regprocedure)"),beforeMetadata=await metadata(db);
 const originalProgress=await progress(db);
 await q("update icash_operation_spend set estimate_checked_at=now() where operation_key='synthetic-operation'");
 assert.equal((await progress(db)).queue.generation,originalProgress.queue.generation+1,'Reproduces the cursor-only false outcome');
 await db.exec('begin;'+migration);
 await assert.rejects(q('select 1/0'),/division by zero/);
 await db.exec('rollback');
 assert.equal(await sourceHash(db),'821d84ea09d109cfdd5b1272a0745509','Migration rolls back with its outer schema-ledger transaction');
 await db.exec('begin;'+migration+'commit;');
 assert.deepEqual(await metadata(db),beforeMetadata,'All function metadata and privileges remain unchanged');
 const migrationFile=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_learning_estimate_bookkeeping.sql'));
 assert(migrationFile);assert.equal(read('supabase/migrations/'+migrationFile),migration);
 const fixed=await v("select pg_get_functiondef('public.icash_learning_changed()'::regprocedure)");
 const boundary=" if tg_table_name='icash_discovery_configs' then ignored:=ignored||array['next_run_at'];end if;";
 assert.equal(fixed,original.replace(boundary,boundary+"\n if tg_table_schema='public' and tg_table_name='icash_operation_spend' then ignored:=ignored||array['estimate_checked_at'];end if;"),'Only the exact table-scoped exclusion changes the installed function');
 console.log('Installed trigger MD5:',await sourceHash(db));
 const fixedProgress=await progress(db);
 await q("update icash_operation_spend set estimate_checked_at=estimate_checked_at where operation_key='synthetic-operation'");
 assert.deepEqual(await progress(db),fixedProgress,'An unchanged UPDATE remains ignored');
 for(const cursor of ["now()+interval '1 minute'",'null',"now()+interval '2 minutes'"]){
  await q(`update icash_operation_spend set estimate_checked_at=${cursor},updated_at=now(),lease_until=now()+interval '1 minute' where operation_key='synthetic-operation'`);
  assert.deepEqual(await progress(db),fixedProgress,'Cursor-only polling does not invalidate the queue or workspace');
 }
 for(const change of ["state='settled'","actual_micros=123","charged_cents=2","settlement_evidence='synthetic original receipt'","cost_basis='verified'","receipt='{\"received\":true}'","financial_checked_at=now()"]){
  const before=await progress(db);
  await q(`update icash_operation_spend set ${change},estimate_checked_at=now() where operation_key='synthetic-operation'`);
  const after=await progress(db);
  assert.equal(after.queue.generation,before.queue.generation+1,change);
  assert.equal(after.revision.revision,before.revision.revision+1,change);
 }
 // A new receipt during an earlier generation's refresh stays due; polling
 // in the same transaction neither invents a generation nor hides the receipt.
 const generation=(await progress(db)).queue.generation;
 await db.exec("begin;update icash_operation_spend set estimate_checked_at=clock_timestamp() where operation_key='synthetic-operation';update icash_operation_spend set receipt='{\"received\":\"new\"}',estimate_checked_at=clock_timestamp() where operation_key='synthetic-operation';commit;");
 await q('update icash_learning_queue set due_at=case when generation=$1 then now()+interval \'1 hour\' else due_at end,last_refreshed_at=case when generation=$1 then now() else last_refreshed_at end where account_id=$2',[generation,id(1)]);
 assert.equal((await progress(db)).queue.generation,generation+1);
 assert.equal((await progress(db)).queue.last_refreshed_at,null,'A concurrent receipt cannot be acknowledged by an older refresh');
 assert(await v('select due_at<=now() from icash_learning_queue where account_id=$1',[id(1)]));
 // Inserts/deletes and same-named columns on other tables/schemas remain meaningful.
 for(const table of ['public.fixture_learning_source','fixture_other.icash_operation_spend']){
  const before=await progress(db);
  await q(`insert into ${table}(id,account_id) values(1,$1)`,[id(1)]);
  await q(`update ${table} set estimate_checked_at=now() where id=1`);
  await q(`delete from ${table} where id=1`);
  assert.equal((await progress(db)).queue.generation,before.queue.generation+3,table);
 }
 await q('insert into icash_discovery_configs(account_id,next_run_at) values($1,now())',[id(1)]);
 const beforeDiscovery=await progress(db);
 await q("update icash_discovery_configs set next_run_at=now()+interval '1 minute'");
 assert.deepEqual(await progress(db),beforeDiscovery,'Existing discovery cursor exclusion remains');
 await q('update icash_discovery_configs set enabled=false');
 assert.equal((await progress(db)).queue.generation,beforeDiscovery.queue.generation+1);
 const beforeInsert=await progress(db);
 await q("insert into icash_operation_spend(operation_key,account_id,estimate_checked_at) values('synthetic-added-operation',$1,now())",[id(1)]);
 assert.equal((await progress(db)).queue.generation,beforeInsert.queue.generation+1,'A new operation remains a learning outcome');
 assert.equal((await progress(db)).revision.revision,beforeInsert.revision.revision+1);
 const beforeDelete=await progress(db);
 await q("delete from icash_operation_spend where operation_key='synthetic-operation'");
 assert.equal((await progress(db)).queue.generation,beforeDelete.queue.generation+1);
 for(const role of ['anon','authenticated'])assert.equal(await v(`select has_function_privilege('${role}','public.icash_learning_changed()','execute')`),false);
 assert.equal(await v("select has_function_privilege('service_role','public.icash_learning_changed()','execute')"),true);
 await assert.rejects(db.exec('begin;'+migration+'commit;'),/predecessor changed/);await db.exec('rollback');
 assert.equal(await v("select pg_get_functiondef('public.icash_learning_changed()'::regprocedure)"),fixed);
 await db.exec(original.replace('begin\n','begin\n -- synthetic source drift\n'));
 await assert.rejects(db.exec('begin;'+migration+'commit;'),/predecessor changed/);await db.exec('rollback');
 await db.exec(original+';grant execute on function public.icash_learning_changed() to anon;');
 await assert.rejects(db.exec('begin;'+migration+'commit;'),/privileges changed/);await db.exec('rollback');
 console.log('PASS learning estimate bookkeeping: old false wake reproduced; cursor-only changes ignored; concurrent receipts, real money/state/evidence changes, unrelated fields/tables, original discovery semantics, inserts/deletes, generation retention, ACLs and source/privilege drift verified.');
}finally{await db.close();}
