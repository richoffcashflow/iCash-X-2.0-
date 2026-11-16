import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {account,rate,release,before,ledger,read,migrationPath,baseSQL,syntheticGates,seedSQL,
 replacePoolDigest,poolSQL,selectedSQL,stageSQL,activateSQL,admissionSQL,accountingSQL} from './helpers/reviewed-planning-relief-20261116-fixture.mjs';

const db=new PGlite();
const val=async sql=>Object.values((await db.query(sql)).rows[0]??{})[0];
const available=()=>val(`select public.icash_prospecting_total_available('${account}')`);
const policy='icash_reliability_private.pending_work_relief_policy_20261116';
const rows='icash_reliability_private.pending_work_relief_20261116';
const decisions='icash_reliability_private.pending_work_relief_activation_20261116';
const refusal=/invalid|mismatch|changed|bound|stage|source|review|selection|pool|control|eligible|cutoff|snapshot|isolation|original|release|already|sealed|private|immutable|terminal|activation/i;
const refuse=sql=>assert.rejects(val(sql),refusal);
async function temporary(sql,run){await db.exec('begin');try{await db.exec(sql);await run();}finally{await db.exec('rollback');}}
try{
 await db.exec(baseSQL());
 const pool=await val(poolSQL);
 const accounting=await val(accountingSQL);
 const originalMigration=read(migrationPath);
 await assert.rejects(db.exec('begin;'+replacePoolDigest(originalMigration,pool)+"do $$begin raise exception 'SYNTHETIC migration ledger failure';end$$;commit;"),/SYNTHETIC migration ledger failure/);
 await db.exec('rollback');
 assert.equal(await val(`select to_regclass('${rows}')`),null,'canonical outer ledger failure rolls back raw shipped migration, without stripping transaction statements');
 assert.deepEqual(await val(accountingSQL),accounting);
 await db.exec('begin;'+replacePoolDigest(originalMigration,pool)+'commit;');
 assert.equal(Number(await val(`select count(*) from ${rows}`)),0,'installation captures no live rows');
 assert.equal(Number(await val(`select count(*) from ${policy}`)),0,'installation leaves no activated or staged policy');
 assert.deepEqual(await val(accountingSQL),accounting,'installation preserves old policies, operations, controls and all ledgers');
 assert.equal(Number(await available()),900);
 const controls=`select icash_reliability_private.pending_work_relief_controls_20261116('${account}')`;
 assert.equal(await val(controls),false,'shipped controls reject missing acknowledgment/configuration');
 await temporary(`update public.icash_accounts set workspace_ack_version='SYNTHETIC accepted workspace' where id='${account}';
  insert into public.icash_discovery_configs(account_id,enabled,auto_enabled,contacts_enabled,zip,rate_id,property_credit_micros,data_rights_until,seller_cost_reserve_cents)
  values('${account}',true,true,true,'90210','${rate}',10000,now()+interval '1 day',0)`,async()=>{
  assert.equal(await val(controls),true,'shipped controls accept current synthetic funding/configuration');
  for(const mutation of [`update public.icash_accounts set bot_paused=true where id='${account}'`,
   `update public.icash_accounts set workspace_ack_version=null where id='${account}'`,
   `update public.icash_wallets set balance_cents=0 where account_id='${account}'`,
   `update public.icash_wallets set reserved_cents=1 where account_id='${account}'`,
   ...['enabled','auto_enabled','contacts_enabled'].map(flag=>`update public.icash_discovery_configs set ${flag}=false where account_id='${account}'`),
   `update public.icash_discovery_configs set data_rights_until=now()-interval '1 second' where account_id='${account}'`,
   `delete from public.icash_prospecting_budgets where account_id='${account}'`,
   `delete from public.icash_wallets where account_id='${account}'`,
   "create or replace function public.icash_membership_work_allowed(uuid) returns boolean language sql as $$select false$$"]){
   await db.exec('savepoint control_case');await db.exec(mutation);assert.equal(await val(controls),false,mutation);await db.exec('rollback to control_case');
  }
 });
 // These controlled external gates exercise the lifecycle only. Production
 // per-kind source proof is tested separately; no permissive gate ships.
 await db.exec(syntheticGates);
 const selected=await val(selectedSQL);
 const stage=(p=pool,s=selected,sha=release)=>stageSQL(p,s,sha);
 for(const p of [null,{},[],[...pool,...pool],Array.from({length:190},()=>pool[0]),pool.map(x=>({...x,source_sha256:'0'.repeat(64)})),pool.map(x=>({...x,account_id:'10000000-0000-4000-8000-000000000002'})),pool.map(x=>({...x,operation_key:'unreviewed'}))])await refuse(stage(p));
 for(const s of [null,{},[],[...selected,...selected],[{operation_key:'not-in-pool',idle_source_sha256:'0'.repeat(64)}],selected.map(x=>({...x,idle_source_sha256:'0'.repeat(64)}))])await refuse(stage(pool,s));
 for(const sha of ['',null,'main','B'.repeat(40),'b'.repeat(39)])await refuse(stage(pool,selected,sha));
 assert.equal(Number(await val(`select count(*) from ${policy}`)),0,'rejected requests cannot consume or partially stage the review');

 for(const change of ["charge_cap_cents=99","reserved_micros=1","state='reserved'","account_id='10000000-0000-4000-8000-000000000002'",
  "permission_until='2028-01-01'","credit_reservation_id=gen_random_uuid()","actual_micros=1","charged_cents=1",
  "created_at='2026-11-15T23:00Z'","dispatched_at='2026-11-15T23:00Z'","dispatched_at=null"]){
  await temporary(`update public.icash_operation_spend set ${change} where operation_key='fixture-original'`,()=>refuse(stage()));
 }
 for(const change of ["status='released'","amount_cents=101","status='settled',settled_cents=1","account_id='10000000-0000-4000-8000-000000000002'","operation_key='wrong-credit-binding'"])
  await temporary(`update public.icash_credit_reservations set ${change} where operation_key='fixture-original'`,()=>refuse(stage()));
 for(const change of ["eligible=false","lease_expires_at=now()+interval '1 hour'","source_version=2"])
  await temporary(`update public.fixture_relief_sources set ${change} where operation_key='fixture-original'`,()=>refuse(stage()));
 for(const change of [`update public.icash_accounts set bot_paused=true where id='${account}'`,
  `update public.icash_wallets set balance_cents=0 where account_id='${account}'`,
  `update public.fixture_relief_controls set allowed=false where account_id='${account}'`])await temporary(change,()=>refuse(stage()));
 await temporary('set transaction isolation level repeatable read',()=>refuse(stage()));
 await temporary(`update public.icash_operation_spend set estimate_checked_at=now() where operation_key='fixture-original'`,async()=>{
  await val(stage());assert.equal(Number(await val(`select count(*) from ${rows}`)),1,'receipt polling remains excluded from the original snapshot');
 });
 await db.exec("create function public.fixture_reject_relief_seal() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC seal failure';end$$;create trigger fixture_reject_relief_seal before insert on "+policy+" for each row execute function public.fixture_reject_relief_seal();");
 await assert.rejects(val(stage()),/SYNTHETIC seal failure/);
 assert.equal(Number(await val(`select count(*) from ${rows}`)),0,'failure sealing a review rolls back every captured row');
 assert.equal(Number(await val(`select count(*) from ${policy}`)),0);
 await db.exec('drop trigger fixture_reject_relief_seal on '+policy+';drop function public.fixture_reject_relief_seal();');
 await val(stage());
 assert.equal(Number(await val(`select count(*) from ${rows}`)),1);
 assert.equal(Number(await available()),900,'staging itself gives no relief');
 assert.deepEqual(await val(accountingSQL),accounting,'staging only stores independent review evidence');
 await refuse(stage());
 for(const sql of [`insert into ${rows} select 'late-key',account_id,operation_snapshot,source_snapshot from ${rows}`,
  `update ${rows} set source_snapshot='{}'::jsonb`,`delete from ${rows}`,`truncate ${rows} cascade`])await refuse(sql);
 for(const sql of [`delete from ${policy}`,`truncate ${policy}`,`update ${policy} set reviewed_release_sha=repeat('c',40)`,
  `update ${policy} set operation_count=operation_count+1`,`update ${policy} set enabled=true`])await refuse(sql);
 const manifest=await val(`select manifest_sha256 from ${policy}`);
 await refuse(activateSQL('0'.repeat(64)));
 await refuse(activateSQL(manifest,'c'.repeat(40)));
 const excluded=async reason=>{
  const result=await val(activateSQL(manifest));
  assert.equal(result.eligibleOperations,0);assert.equal(result.excludedOperations,1);assert.equal(result.enabled,false);
  assert.equal(await val(`select reason from ${decisions} where operation_key='fixture-original'`),reason);
 };
 for(const change of ["eligible=false","source_version=2","lease_expires_at=now()+interval '1 hour'"])
  await temporary(`update public.fixture_relief_sources set ${change} where operation_key='fixture-original'`,async()=>{
   await excluded('source_changed');
   await db.exec("update public.fixture_relief_sources set eligible=true,source_version=1,lease_expires_at=null where operation_key='fixture-original'");
   assert.equal(Number(await val("select icash_reliability_private.pending_planning_cents(o) from public.icash_operation_spend o where operation_key='fixture-original'")),100,'excluded source never becomes an active member after later recovery');
  });
 await temporary(`update public.icash_operation_spend set charge_cap_cents=99 where operation_key='fixture-original'`,()=>excluded('original_changed'));
 await temporary(`update public.icash_accounts set bot_paused=true where id='${account}'`,()=>excluded('controls_closed'));
 await temporary("update public.icash_credit_reservations set status='released' where operation_key='fixture-original'",()=>excluded('authorization_changed'));
 await temporary('set transaction isolation level repeatable read',()=>refuse(activateSQL(manifest)));
 await val(activateSQL(manifest));
 assert.equal(await val(`select enabled from ${policy}`),true);
 assert.equal(Number(await available()),1000);
 assert.deepEqual(await val(accountingSQL),accounting,'activation does not release supplier reserves, credit, replay, or change Pause');
 await val(activateSQL(manifest));
 assert.equal(Number(await val(`select count(*) from ${policy}`)),1,'exact replay creates no second activation');
 for(const sql of [`update ${decisions} set eligible=false,reason='source_changed'`,`delete from ${decisions}`,`truncate ${decisions}`,
  `insert into ${decisions} select * from ${decisions}`])await refuse(sql);
 for(const change of ["charge_cap_cents=99","reserved_micros=1","state='reserved'","dispatched_at=now()"])
  await temporary(`update public.icash_operation_spend set ${change} where operation_key='fixture-original'`,async()=>{
   assert.equal(Number(await val("select icash_reliability_private.pending_planning_cents(o) from public.icash_operation_spend o where operation_key='fixture-original'")),change.startsWith('charge')?99:100,'changed original restores its planning deduction');
  });

 // Actual captured reserve chain, not the legacy fixture_relief_admit shortcut.
 for(const [a,pattern] of [['10000000-0000-4000-8000-000000000003',/Bot paused/],['10000000-0000-4000-8000-000000000004',/Insufficient credits/]])
  await assert.rejects(val(admissionSQL('blocked-'+a,a)),pattern);
 await temporary('update public.icash_operating_budget set require_company_reserve=true,funded_micros=0',()=>assert.rejects(val(admissionSQL('company-cash-block')),/Company budget exhausted/));
 await temporary('update public.icash_operating_budget set require_company_reserve=true,funded_micros=10000000,daily_limit_micros=1',()=>assert.rejects(val(admissionSQL('company-day-block')),/Company daily limit/));
 await temporary(`update public.icash_operation_rates set costs_micros=costs_micros-'other' where id='${rate}'`,()=>assert.rejects(val(admissionSQL('missing-cost')),/Unknown cost/));
 await temporary(`update public.icash_operation_rates set enabled=false where id='${rate}'`,()=>assert.rejects(val(admissionSQL('disabled-rate')),/Verified rate/));
 const budgetBefore=Number(await val('select reserved_micros from public.icash_operating_budget'));
 for(let n=0;n<5;n++)assert.equal((await val(admissionSQL('fresh-admission-'+n))).state,'reserved');
 await assert.rejects(val(admissionSQL('over-budget')),/Prospecting budget reached/);
 assert.equal(Number(await available()),0);
 assert.equal(Number(await val('select reserved_micros from public.icash_operating_budget')),budgetBefore+50000,'new work records five real supplier reserves');
 assert.equal(Number(await val("select count(*) from public.icash_credit_reservations where operation_key like 'fresh-admission-%'")),5);
 await val(admissionSQL('fresh-admission-0'));
 assert.equal(Number(await val('select reserved_micros from public.icash_operating_budget')),budgetBefore+50000,'exact existing admission creates no second reserve');

 // Real original settlement transfers supplier reserve to spent once, including
 // explicit coverage when independently completed work consumed the wallet.
 await db.exec(`update public.icash_wallets set balance_cents=20 where account_id='${account}'`);
 const supplierBefore=await val('select jsonb_build_object(\'reserved\',reserved_micros,\'spent\',spent_micros) from public.icash_operating_budget');
 const settle=`select public.icash_settle_operation('fixture-original',100,10000,'SYNTHETIC exact original provider receipt')`;
 await val(settle);await val(settle);
 assert.equal(Number(await val(`select balance_cents from public.icash_wallets where account_id='${account}'`)),0);
 assert.deepEqual(await val("select jsonb_build_object('gross',gross_cents,'customer',customer_cents,'covered',covered_cents) from public.icash_usage_coverage where operation_key='fixture-original'"),{gross:100,customer:20,covered:80});
 assert.equal(Number(await val("select count(*) from public.icash_credit_ledger where event_key in ('usage:fixture-original','usage-coverage:fixture-original')")),2);
 assert.equal(Number(await val('select reserved_micros from public.icash_operating_budget')),supplierBefore.reserved-50000);
 assert.equal(Number(await val('select spent_micros from public.icash_operating_budget')),supplierBefore.spent+10000);
 await assert.rejects(val("select public.icash_settle_operation('fixture-original',99,10000,'SYNTHETIC conflicting receipt')"),/Settlement conflict/);
 assert.equal(Number(await available()),0);
 for(const [name,definition] of Object.entries(before).filter(([k])=>['icash_guard_prospecting_spend','icash_finish_credit'].includes(k)))
  assert.equal(await val(`select pg_get_functiondef(oid) from pg_proc where proname='${name}'`),definition,'billing and final financial guard preserved');
 for(const [sig,{md5}] of Object.entries(ledger))assert.equal(await val(`select md5(pg_get_functiondef('public.${sig}'::regprocedure))`),md5);
 for(const role of ['anon','authenticated','service_role']){
  for(const sig of ['stage_pending_work_relief_20261116(jsonb,jsonb,text)','activate_pending_work_relief_20261116(text,text)','rollback_pending_work_relief_20261116(text,text)'])
   assert.equal(await val(`select has_function_privilege('${role}','icash_reliability_private.${sig}','execute')`),false);
  for(const table of [rows,policy,decisions])for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES'])
   assert.equal(await val(`select has_table_privilege('${role}','${table}','${privilege}')`),false);
 }
 await val(`select icash_reliability_private.rollback_pending_work_relief_20261116('${manifest}','${release}')`);
 await refuse(activateSQL(manifest));
 await refuse(`update ${policy} set enabled=true`);
 assert.equal(await val(`select enabled from ${policy}`),false,'rollback is terminal even for exact activation replay');
 const overrunBefore=await val("select jsonb_build_object('reserved',reserved_micros,'spent',spent_micros) from public.icash_operating_budget");
 const overrun="select public.icash_settle_operation('other-old',1,60000,'SYNTHETIC evidenced supplier overrun')";
 await val(overrun);await val(overrun);
 assert.equal(await val('select enabled from public.icash_operating_budget'),false,'real cost above original reserve disables subsequent work');
 assert.equal(await val("select bot_paused from public.icash_accounts where id='10000000-0000-4000-8000-000000000002'"),true,'real margin failure retains account Pause');
 assert.equal(Number(await val('select reserved_micros from public.icash_operating_budget')),overrunBefore.reserved-50000);
 assert.equal(Number(await val('select spent_micros from public.icash_operating_budget')),overrunBefore.spent+60000);
 await assert.rejects(val(admissionSQL('after-supplier-overrun')),/Automation on hold/);
 for(const [mutation,reason] of [
  ["select public.icash_settle_operation('fixture-original',25,10000,'SYNTHETIC actual receipt before activation')",'original_changed'],
  ["update public.fixture_relief_sources set eligible=false where operation_key='fixture-original'",'source_changed']]){
  const peerDb=new PGlite();
  const peerVal=async sql=>Object.values((await peerDb.query(sql)).rows[0]??{})[0];
  try{
   await peerDb.exec(baseSQL()+seedSQL('fixture-peer'));
   const peerPool=await peerVal(poolSQL);
   await peerDb.exec('begin;'+replacePoolDigest(originalMigration,peerPool)+'commit;'+syntheticGates);
   await peerVal(stageSQL([...peerPool].reverse(),[...await peerVal(selectedSQL)].reverse()));
   const peerManifest=await peerVal(`select manifest_sha256 from ${policy}`);
   await peerDb.exec(mutation);
   const result=await peerVal(activateSQL(peerManifest));
   assert.equal(result.eligibleOperations,1);assert.equal(result.excludedOperations,1);assert.equal(result.enabled,true);
   assert.equal(await peerVal(`select reason from ${decisions} where operation_key='fixture-original'`),reason);
   assert.equal(await peerVal(`select eligible from ${decisions} where operation_key='fixture-peer'`),true);
   if(reason==='source_changed'){
    await peerDb.exec("update public.fixture_relief_sources set eligible=true where operation_key='fixture-original'");
    assert.equal(Number(await peerVal("select icash_reliability_private.pending_planning_cents(o) from public.icash_operation_spend o where operation_key='fixture-original'")),100);
   }
   assert.equal(Number(await peerVal("select icash_reliability_private.pending_planning_cents(o) from public.icash_operation_spend o where operation_key='fixture-peer'")),0);
   const sealed=await peerVal(`select activation_manifest_sha256 from ${policy}`);
   await peerVal(activateSQL(peerManifest));assert.equal(await peerVal(`select activation_manifest_sha256 from ${policy}`),sealed);
  }finally{await peerDb.close();}
 }
 // Authenticate each synthetic pool anew so these reach the actual fixed
 // financial/cutoff boundaries rather than merely failing an original hash.
 for(const mutation of [
  "update public.icash_operation_spend set charge_cap_cents=27208 where operation_key='fixture-original';update public.icash_credit_reservations set amount_cents=27208 where operation_key='fixture-original';",
  "update public.icash_operation_spend set reserved_micros=122405041 where operation_key='fixture-original';",
  "update public.icash_operation_spend set created_at='2026-11-15T23:00Z' where operation_key='fixture-original';",
  "update public.icash_operation_spend set dispatched_at='2026-11-15T23:00Z' where operation_key='fixture-original';",
  `insert into public.fixture_relief_sources(operation_key,account_id) values('old-call','${account}');`,
  Array.from({length:189},(_,n)=>seedSQL('cap-operation-'+n,1)).join('\n'),
  Array.from({length:37},(_,n)=>{
   const a=`10000000-0000-4000-8000-${String(100+n).padStart(12,'0')}`;
   return `insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused) values('${a}','${a}','Fixture',false);
    insert into public.icash_wallets(account_id,balance_cents) values('${a}',1000);
    insert into public.icash_prospecting_budgets(account_id,baseline_cents) values('${a}',1000);
    insert into public.fixture_relief_controls(account_id) values('${a}');`+seedSQL('cap-account-'+n,100,a);
  }).join('\n'),
 ]){
  const capDb=new PGlite();const capVal=async sql=>Object.values((await capDb.query(sql)).rows[0]??{})[0];
  try{
   await capDb.exec(baseSQL()+mutation);const capPool=await capVal(poolSQL);
   await capDb.exec('begin;'+replacePoolDigest(originalMigration,capPool)+'commit;'+syntheticGates);
   await assert.rejects(capVal(stageSQL(capPool,await capVal(selectedSQL))),/check constraint|cutoff|changed|Malformed/i);
   assert.equal(Number(await capVal(`select count(*) from ${rows}`)),0,'bounded capture rolls back completely');
   assert.equal(Number(await capVal(`select count(*) from ${policy}`)),0);
  }finally{await capDb.close();}
 }
 assert.doesNotMatch(originalMigration,/DEVELOPMENT BLOCKER|Reviewed source lock proof is not implemented/,'fail-closed development seams must be replaced before this suite can pass release validation');
 const name=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_reviewed_planning_relief_20261116.sql'));
 assert.ok(name,'canonical migration exists');assert.equal(read('supabase/migrations/'+name),originalMigration);
 console.log('PASS reviewed November 16 planning relief: exact synthetic pool/source lifecycle, empty install, sealed one-use capture, immutable old policies, terminal rollback, real reserve chain, supplier accounting, Pause and covered once-only late billing. No provider requests.');
}catch(error){console.error(error.message,error.where??'',error.stack?.split('\n').slice(1,4).join('\n')??'');process.exitCode=1;}finally{await db.close();}
