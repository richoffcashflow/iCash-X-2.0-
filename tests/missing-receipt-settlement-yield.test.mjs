import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {setup,migration,read,signature,predecessor,wrappers,seed,receipt,value,sourceHash,metadata,financialState,sourceState,id} from './helpers/missing-receipt-settlement-fixture.mjs';
const db=new PGlite(),call=async key=>{
 const sources=await sourceState(db);
 try{return await value(db,'select public.icash_settle_estimate_before_sms_tokens($1)',[key]);}
 finally{assert.deepEqual(await sourceState(db),sources,'Every settlement preserves original receipts and observations');}
};
try{
 await db.exec(setup);
 assert.equal(await sourceHash(db),'d463afb80ef551b673a1f7c43710117f');
 for(const wrapper of wrappers)assert.equal(await value(db,'select md5(pg_get_functiondef($1::regprocedure))',[wrapper.signature]),wrapper.hash);
 const beforeMetadata=await metadata(db),researchHash=await value(db,"select md5(pg_get_functiondef('public.icash_settle_dealmachine_usage(text)'::regprocedure))");
 await db.exec('begin;'+migration);
 await assert.rejects(db.query('select 1/0'),/division by zero/);await db.exec('rollback');
 assert.equal(await sourceHash(db),'d463afb80ef551b673a1f7c43710117f','Schema-history failure rolls back the patch');
 await db.exec('begin;'+migration+'commit;');
 assert.deepEqual(await metadata(db),beforeMetadata);
 assert.equal(await value(db,"select md5(pg_get_functiondef('public.icash_settle_dealmachine_usage(text)'::regprocedure))"),researchHash,'Original observed-credit adapter is unchanged');
 for(const wrapper of wrappers)assert.equal(await value(db,'select md5(pg_get_functiondef($1::regprocedure))',[wrapper.signature]),wrapper.hash,'Outer wrapper source stays unchanged');
 const fixed=await value(db,'select pg_get_functiondef($1::regprocedure)',[signature]);
 const replacement=migration.match(/replacement text:=\$replacement\$([\s\S]*?)\$replacement\$/)[1];
 assert.equal(fixed,predecessor.replace('begin\n perform 1 from public.icash_operating_budget where id=1 for update;',replacement),'All locked settlement behavior remains byte-for-byte unchanged');
 console.log('Installed settlement MD5:',await sourceHash(db));
 let n=0;
 for(const kind of ['owner_enrichment','property_search','buyer_discovery']){
  const item=await seed(db,++n,kind),before=await financialState(db);
  assert.equal(await call(item.operation),false);assert.deepEqual(await financialState(db),before);
  // A receipt from a different account or source cannot bypass the absence check.
  await receipt(db,item,{account:id(8000+n),source:false});
  assert.equal(await call(item.operation),false);assert.deepEqual(await financialState(db),before);
  await receipt(db,item);
  assert.equal(await call(item.operation),true);
  assert.equal(await value(db,'select charged_cents from icash_operation_spend where operation_key=$1',[item.operation]),80);
  assert.equal(await value(db,'select balance_cents from icash_wallets where account_id=$1',[item.account]),920);
  const settled=await financialState(db);assert.equal(await call(item.operation),true);assert.deepEqual(await financialState(db),settled);
 }
 // Missing, malformed or mismatched evidence remains unknown under original rules.
 for(const options of [{credits:null},{credits:'24'},{observed:23},{source:false}]){
  const item=await seed(db,++n);await receipt(db,item,options);const before=await financialState(db);
  assert.equal(await call(item.operation),false);assert.deepEqual(await financialState(db),before);
 }
 const cursor=await seed(db,++n),beforeCursor=await financialState(db);
 assert.deepEqual(await value(db,'select icash_settle_pending_estimates($1,25)',[cursor.account]),{settled:0,held:1,costBasis:'estimated'});
 assert(await value(db,'select estimate_checked_at is not null from icash_operation_spend where operation_key=$1',[cursor.operation]));
 assert.deepEqual(await financialState(db),beforeCursor);
 await db.exec('set role service_role;');
 assert.equal(await call(cursor.operation),false,'Direct service role keeps its existing table/function authority');
 await assert.rejects(value(db,'select icash_settle_estimate_before_contact_refresh($1)',[cursor.operation]),e=>e.code==='42501','The private intermediate wrapper is not directly executable by service role');
 assert.equal(await value(db,'select icash_settle_estimated_operation($1)',[cursor.operation]),false,'Original SECURITY DEFINER wrapper chain retains held semantics');
 await db.exec('reset role');
 for(const state of ['reserved','cancelled','settled']){
  const item=await seed(db,++n,'owner_enrichment',state),before=await financialState(db);
  assert.equal(await call(item.operation),state==='settled');assert.deepEqual(await financialState(db),before);
 }
 for(const kind of ['seller_call','incoming_call','sms_send']){
  const item=await seed(db,++n,kind),before=await financialState(db);
  assert.equal(await call(item.operation),false);assert.deepEqual(await financialState(db),before);
 }
 assert.equal(await call('synthetic:missing-operation'),false);
 const badRate=await seed(db,++n);await db.query('delete from icash_operation_rates where id=$1',[badRate.rate]);
 await assert.rejects(call(badRate.operation),e=>e.code==='P0002','Missing original rates retain strict refusal');
 for(const role of ['anon','authenticated'])assert.equal(await value(db,'select has_function_privilege($1,$2,\'EXECUTE\')',[role,signature]),false);
 assert.equal(await value(db,'select has_function_privilege($1,$2,\'EXECUTE\')',['service_role',signature]),true);
 await assert.rejects(db.exec('begin;'+migration+'commit;'),/predecessor changed/);await db.exec('rollback');
 assert.equal(await value(db,'select pg_get_functiondef($1::regprocedure)',[signature]),fixed);
 await db.exec(predecessor.replace('begin\n','begin\n -- synthetic drift\n'));
 await assert.rejects(db.exec('begin;'+migration+'commit;'),/predecessor changed/);await db.exec('rollback');
 await db.exec(predecessor+';grant execute on function '+signature+' to anon;');
 await assert.rejects(db.exec('begin;'+migration+'commit;'),/privileges changed/);await db.exec('rollback');
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('_missing_receipt_settlement_yield.sql'));
 assert.equal(files.length,1);assert.equal(read('supabase/migrations/'+files[0]),migration);
 console.log('PASS missing receipt settlement: exact locked-body/source/ACL preservation, all three research receipt bindings, immutable unknown holds, normal retry cursors, observed-credit settlement, states/other kinds, idempotency, rollback and drift rejection.');
}finally{await db.close();}
