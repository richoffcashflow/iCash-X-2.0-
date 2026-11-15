// Execute real billing and claim SQL against fictional data; no provider calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const pg=await PGlite.create(),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0])[0];
const schema='icash_seller_recovery_private',release='a'.repeat(40);
let original,hash;
async function isolated(fn){await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}}
const review=()=>one(`select ${schema}.review_contact_refresh_isolation($1,$2,'Offline synthetic exact receipt review')`,[original,hash]);
const activate=()=>one(`select ${schema}.activate_contact_refresh_isolation($1,$2)`,[hash,release]);
const claim=async()=>{await pg.exec('set local role service_role');try{return await one('select public.icash_claim_seller_contact_refresh()');}finally{await pg.exec('reset role');}};
const snapshot=()=>one(`select ${schema}.contact_refresh_isolation_snapshot($1)`,[original]);
async function oldEvidence(){return one(`select jsonb_build_object('refresh',to_jsonb(f),'spend',to_jsonb(o),'request',to_jsonb(r),'wallet',to_jsonb(w),'reservation',to_jsonb(c))
 from ${schema}.contact_refreshes f join icash_operation_spend o using(operation_key) join icash_research_private.requests r on r.id=f.request_id
 join icash_wallets w on w.account_id=f.account_id join icash_credit_reservations c on c.id=o.credit_reservation_id where f.id=$1`,[original]);}
try{
 await pg.exec(read('tests/fixtures/seller-contact-refresh-native.sql'));
 await pg.exec(read('tests/fixtures/seller-contact-refresh-isolation-before.sql'));
 await pg.exec(read('config/seller-contact-refresh-isolation.sql'));
 original=await one(`select id from ${schema}.contact_refreshes limit 1`);
 hash=await one(`select encode(sha256(convert_to(${schema}.contact_refresh_isolation_snapshot($1)::text,'UTF8')),'hex')`,[original]);
 assert(hash,'Historical review is derivable from the saved independent ledgers');
 assert.equal((await snapshot()).additionalReservedMicros,12000);
 const initial=await oldEvidence(),reserve=await one('select reserved_micros from icash_operating_budget');
 await isolated(async()=>{
  assert.equal(await claim(),null,'Existing global barrier stays before review');
  assert.equal(await review(),true);assert.equal(await review(),false,'One frozen review only');
  assert.equal(await claim(),null,'Review installs inactive');
  assert.equal(await one('select reserved_micros from icash_operating_budget'),reserve,'Review does not reserve or spend');
  assert.equal(await activate(),true);assert.equal(await activate(),true,'Same activation is idempotent');
  assert.equal(await one('select reserved_micros from icash_operating_budget'),reserve+12000,'Additional platform planning reserve exactly once');
  assert.equal(await one(`select ${schema}.activate_contact_refresh_isolation($1,$2)`,[hash,'b'.repeat(40)]),false);
  const work=await claim();assert(work);assert.equal(work.phone,'+12145550234','Independent account receives the next admission');
  assert.equal(await one(`select count(*) from ${schema}.contact_refreshes where account_id='00000000-0000-4000-8000-000000000001'`),1,'Original account remains excluded');
  assert.deepEqual(await oldEvidence(),initial,'Original receipt, spend, wallet, request and reservation unchanged');
  assert.equal(await one('select count(*) from icash_credit_ledger'),0,'Isolation is not a customer charge');
  assert.equal(await claim(),null,'New unknown provider outcome stops further admissions');
 });
 await isolated(async()=>{
  await review();await activate();const work=await claim();assert(work);
  await q(`update ${schema}.contact_refreshes set requested_at=now()-interval '2 minutes',response_at=now()-interval '1 minute',state='responded',outcome=null,http_status=200,response='{}' where id=$1`,[work.id]);
  assert.equal(await claim(),null,'Saved response pending cost processing still occupies the one unresolved slot');
 });
 await isolated(async()=>{
  await review();await activate();const work=await claim();assert(work);
  await q(`update ${schema}.contact_refreshes set requested_at=now()-interval '2 minutes',response_at=now()-interval '1 minute',state='processed',outcome='cost_review',http_status=200,response='{}' where id=$1`,[work.id]);
  assert.equal(await claim(),null,'Second cost discrepancy remains a global breaker even after pacing expires');
  assert.equal(await one(`select count(*) from ${schema}.contact_refresh_isolation`),1,'No automatic quarantine expansion');
 });
 await isolated(async()=>{
  await review();await activate();
  await q(`update ${schema}.contact_refresh_isolation set enabled=false where id=1`);
  assert.equal(await claim(),null,'Disabled policy restores original global barrier');
  assert.equal(await activate(),false,'A disabled activated review cannot be rearmed');
  assert.equal(await one('select reserved_micros from icash_operating_budget'),reserve+12000,'Rollback retains extra reserve');
  await assert.rejects(q(`update ${schema}.contact_refresh_isolation set enabled=true where id=1`),/immutable/);
 });
 for(const mutation of [
  `update ${schema}.contact_refreshes set response=jsonb_set(response,'{credits,used}','3') where id='${original}'`,
  `update icash_research_private.requests set result=jsonb_set(result,'{creditsUsed}','1')`,
  `update icash_operation_spend set charge_cap_cents=charge_cap_cents+1`,
  `update icash_operation_rates set evidence_ref=evidence_ref||' changed' where operation='contact_revalidation'`,
  `update icash_data_cost_settings set credit_micros=20000`,
  `update icash_operational_contacts set phone='+12145550999' where account_id='00000000-0000-4000-8000-000000000001'`,
 ])await isolated(async()=>{await review();await activate();await pg.exec(mutation);assert.equal(await claim(),null,'Source drift restores barrier: '+mutation);});
 await isolated(async()=>{await review();await activate();await q('update icash_operation_spend set estimate_checked_at=now()');assert(await claim(),'Routine estimate polling is not altered economic evidence');});
 await isolated(async()=>{await review();await activate();await q('update icash_operating_budget set reserved_micros=0');assert.equal(await claim(),null,'Missing original plus extra reserve restores barrier');});
 await isolated(async()=>{
  await review();await activate();
  await q("update icash_operation_spend set state='settled'");
  const work=await claim();assert(work);assert.equal(work.phone,'+12145550234','State label alone does not remove original-account exclusion');
 });
 await isolated(async()=>{
  await review();await activate();
  // A separate reviewed settlement is an explicit fixture boundary. This new
  // policy does not create it, change the saved contradictory response or bill.
  const settle="select icash_settle_operation('dnc:00000000-0000-4000-8000-000000000003',14,60000,'synthetic separately verified reconciliation')";
  await q(settle);await q(settle);
  assert.equal(await one('select reserved_micros from icash_operating_budget'),12000,'Actual settlement releases original reserve once and retains extra reserve');
  assert.equal(await one('select count(*) from icash_credit_ledger'),1,'Separate real settlement is idempotent');
  const work=await claim();assert(work);assert.equal(work.phone,'+12145550123','Genuine later settlement ends the original-account isolation');
 });
 await isolated(async()=>{await review();await q('update icash_operating_budget set funded_micros=0');assert.equal(await activate(),false,'Existing company reserve mode is enforced');assert.equal(await one('select reserved_micros from icash_operating_budget'),reserve);});
 await isolated(async()=>{await review();await q('update icash_operating_budget set daily_limit_micros=0');assert.equal(await activate(),false,'Existing daily company cap is enforced');});
 for(const mutation of [
  "update icash_operation_rates set evidence_ref=evidence_ref||' changed' where operation='contact_revalidation'",
  "update icash_data_cost_settings set credit_micros=20000",
  `do $$declare d text;begin d:=pg_get_functiondef('public.icash_claim_seller_contact_refresh()'::regprocedure);execute replace(d,'visited:=true;','visited:=true; -- synthetic changed claim body');end$$;`,
 ])await isolated(async()=>{await review();await pg.exec(mutation);assert.equal(await activate(),false,'Preactivation source and code drift refuses activation');assert.equal(await one('select reserved_micros from icash_operating_budget'),reserve);});
 await isolated(async()=>{await review();await q('update icash_operating_budget set require_company_reserve=false,funded_micros=0,daily_limit_micros=null');assert.equal(await activate(),true,'Preserve existing customer-funded platform mode');assert.equal(await one('select reserved_micros from icash_operating_budget'),reserve+12000);});
 for(const mutation of [
  `update ${schema}.contact_refreshes set response_at=null,http_status=null,state='requested',outcome=null`,
  `update icash_research_private.requests set finished_at=null`,
  `update ${schema}.contact_refreshes set requested_at=now()`,
  `update ${schema}.contact_refreshes set successor_contact_id='00000000-0000-4000-8000-000000000099'`,
 ])await isolated(async()=>{await pg.exec(mutation);assert.equal(await snapshot(),null,'Unknown, future or already-applied work cannot be isolated');assert.equal(await review(),false);});
 await isolated(async()=>{assert.equal(await one(`select ${schema}.review_contact_refresh_isolation($1,$2,'Exact synthetic review')`,[original,'0'.repeat(64)]),false,'Exact expected fingerprint required');});
 await isolated(async()=>{await review();await q('set local timezone=\'America/Chicago\'');assert.deepEqual(await snapshot(),(await one(`select snapshot from ${schema}.contact_refresh_isolation`)),'Fingerprint is timezone-independent');});
 for(const role of ['anon','authenticated','service_role']){
  for(const fn of ['contact_refresh_isolation_snapshot(uuid)','contact_refresh_isolated(uuid)','review_contact_refresh_isolation(uuid,text,text)','activate_contact_refresh_isolation(text,text)'])
   assert.equal(await one('select has_function_privilege($1,$2,\'execute\')',[role,schema+'.'+fn]),false,role+' cannot bypass review');
  assert.equal(await one('select has_table_privilege($1,$2,\'insert,update,delete\')',[role,schema+'.contact_refresh_isolation']),false);
 }
 console.log('PASS exact one-receipt isolation, unchanged original billing, extra company reserve, independent account admission, new-ambiguity breaker, source drift, rollback and private controls.');
}finally{await pg.close();}
