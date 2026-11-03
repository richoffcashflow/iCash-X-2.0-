// Isolated PGlite PostgreSQL fixtures only; no provider traffic or production writes.
// A performance proposal, not a proof of bounded runtime or lock duration.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createOperationalContactFixture} from './helpers/operational-contact-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('config/operational-preparation-receipt-bindings.sql');
const migrationNames=['20261103211342_operational_preparation_phone_index.sql','20261103214105_operational_preparation_national_index.sql','20261103214109_operational_preparation_receipt_bindings.sql'];
const migrations=migrationNames.map(name=>({name,sql:read('supabase/migrations/'+name)}));
const indexStatements=['phone','national'].map(kind=>read('config/operational-preparation-'+kind+'-index.sql'));
assert.deepEqual(migrations.map(m=>m.sql),[...indexStatements,sql],'CLI-generated three-stage chain exactly mirrors reviewed configs');
// Only isolated fixture engines use ordinary builds; native installation below
// executes the unmodified concurrent staging statements one at a time.
const fixtureIndexStatements=indexStatements.map(statement=>statement.replace(/\bconcurrently\b/gi,''));
const original=sql.match(/old_query text:=\$old\$([\s\S]*?)\$old\$/)[1];
const replacement=sql.match(/new_query text:=\$new\$([\s\S]*?)\$new\$/)[1];
const native=process.env.PREPARATION_NATIVE_TEST==='1';
const f=await createOperationalContactFixture(native?fileURLToPath(new URL('./helpers/preparation-native-db.mjs',import.meta.url)):fileURLToPath(import.meta.resolve('@electric-sql/pglite')));
const {pg,q,rpc,one,isolated,account,user,other,newOwner,phone,screening,source,dnc,sms}=f;
const select=(query,a=account)=>(pg.nativeSelect??q)(query.replaceAll('p_account','$1::uuid'),[a]);
try{
 await q('delete from icash_dnc_verification_receipts where id=$1',[dnc]);
 await q('delete from icash_dnc_verification_sources where id=$1',[source]);
 const operation='owners:'+account+':'+screening;
 await q("update icash_owner_contacts set result=jsonb_set(result,'{fetchedAt}',to_jsonb(to_char(now()-interval '1 hour','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))),created_at=now()-interval '56 minutes' where screening_id=$1",[screening]);
 await q("update icash_operation_spend set created_at=now()-interval '59 minutes',dispatched_at=now()-interval '58 minutes',settled_at=now()-interval '57 minutes' where operation_key=$1",[operation]);
 for(const [field,amount] of [['used',1],['people',1],['properties',0],['deduplicated',0]]){
  const key=operation+(field==='used'?'':':'+field);
  await q("insert into icash_cost_observations(provider,event_key,source_ref,amount,units,observed_at) values('dealmachine',$1,'dealmachine:owners:'||$1,$2,'provider_credits',now()-interval '57 minutes')",[key,amount]);
 }
 await pg.exec(read('config/dealmachine-dnc-observations.sql'));
 await pg.exec(`create table public.icash_timezone_names(name text primary key);
 alter table public.icash_timezone_names enable row level security;
 revoke all on public.icash_timezone_names from public,anon,authenticated;
 grant select on public.icash_timezone_names to service_role;
 insert into public.icash_timezone_names(name) select name from pg_catalog.pg_timezone_names;`);
 assert.equal((await one("select has_table_privilege('service_role','public.icash_timezone_names','select') allowed")).allowed,true);
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_table_privilege($1,'public.icash_timezone_names','select') allowed",[role])).allowed,false);
 assert.equal((await one("select relrowsecurity enabled from pg_class where oid='public.icash_timezone_names'::regclass")).enabled,true);
 await pg.exec(read('tests/fixtures/operational-preparation-before-receipt-bindings.sql'));
 await q("update icash_dnc_verification_sources set enabled=true,expires_at=now()+interval '1 day' where observation_provider='dealmachine'");
 const result=await rpc('icash_ingest_dealmachine_dnc_observations',{p_account:account,p_user:user,p_screening:screening});
 assert.equal(result.observations,1);
 const before=(await one("select pg_get_functiondef('icash_prepare_operational_contacts_before_dm_observations(uuid)'::regprocedure) definition")).definition;
 const validator=(await one("select pg_get_functiondef('icash_operational_contact_current(uuid,uuid,text,boolean)'::regprocedure) definition")).definition;
 const fixtureIndexes=fixtureIndexStatements.join('\n')
  .replaceAll('icash_dnc_clear_phone_expiry','fixture_test_phone_expiry').replaceAll('icash_dnc_clear_national_screening_expiry','fixture_test_national_expiry');
 await pg.exec(fixtureIndexes);
 const dropFixtureIndexes=()=>pg.exec('drop index fixture_test_phone_expiry;drop index fixture_test_national_expiry');
 const repeatPlans=async(plan,a,b)=>{
  const oldTimes=[],newTimes=[];
  for(let i=0;i<3;i++){
   const pair=i%2?[await plan(b),await plan(a)]:[await plan(a),await plan(b)];
   for(const p of pair)assert.equal(p.Plan['Actual Rows'],1);
   oldTimes.push(pair[i%2?1:0]['Execution Time']);newTimes.push(pair[i%2?0:1]['Execution Time']);
  }
  const median=values=>[...values].sort((a,b)=>a-b)[1];
  return {originalMs:oldTimes,receiptFirstMs:newTimes,originalMedianMs:median(oldTimes),receiptFirstMedianMs:median(newTimes)};
 };
 let positiveTiming;
 const cold=(await select(original)).rows;assert.equal(cold.length,1);assert.deepEqual((await select(replacement)).rows,cold);
 assert.equal((await select(replacement,other)).rows.length,0,'account scope stays exact');
 assert.equal((await select(replacement,null)).rows.length,1,'global preparation stays available');
 await isolated(async()=>{
  // Same phone can have hundreds of national observations for other properties,
  // accounts and source versions. None may fan out past the cheap binding gate.
  // Additional correctly bound but unproven receipts must still fail the FULL
  // proof before LIMIT, leaving the one authentic new contact available.
  await q(`with template as materialized(select * from icash_dnc_verification_receipts where evidence_kind='national_provider_observation' limit 1)
   insert into icash_dnc_verification_receipts
   select cloned.* from template r cross join generate_series(1,705) n
   cross join lateral jsonb_populate_record(null::icash_dnc_verification_receipts,to_jsonb(r)||jsonb_build_object(
    'id',('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
    'provider_reference','local-fanout-receipt-'||n,
    'receipt_hash',case when n>600 then repeat('f',64) else r.receipt_hash end,
    'observation_provenance',r.observation_provenance||case
     when n>600 then '{}'::jsonb
     when n%4=0 then jsonb_build_object('accountId',$1::text)
     when n%4=1 then jsonb_build_object('screeningId',gen_random_uuid()::text)
     when n%4=2 then jsonb_build_object('operationKey','local-foreign-operation-'||n)
     else jsonb_build_object('savedResultHash',repeat('e',64)) end)) cloned`,[other]);
  assert.equal(Number((await one('select count(*) n from icash_dnc_verification_receipts')).n),706);
  const old=(await select(original)).rows;assert.deepEqual(old,cold,'one authentic candidate survives the same-phone fanout');
  assert.deepEqual((await select(replacement)).rows,old,'foreign bindings and >100 invalid proofs cannot starve the valid contact');
  assert.deepEqual((await select(replacement,null)).rows,(await select(original,null)).rows,'global candidate ordering and LIMIT remain exact');
  const candidateOnly=replacement.slice(0,replacement.indexOf(' select distinct candidate.*'))+' select count(*) n from candidates';
  assert.equal(Number((await select(candidateOnly)).rows[0].n),106,'foreign receipt bindings do not enter materialization');
  const plan=async query=>(await select('explain (analyze,format json) '+query)).rows[0]['QUERY PLAN'][0];
  const oldPlan=await plan(original),newPlan=await plan(replacement);
  assert.equal(oldPlan.Plan['Actual Rows'],1);assert.equal(newPlan.Plan['Actual Rows'],1);
  positiveTiming={originalMs:oldPlan['Execution Time'],replacementMs:newPlan['Execution Time']};
 });
 for(const [change,args] of [
  ['update icash_accounts set bot_paused=true where id=$1',[account]],
  ['update icash_accounts set owner_user_id=$2 where id=$1',[account,newOwner]],
  ['update icash_discovery_configs set contacts_enabled=false where account_id=$1',[account]],
  ["update icash_discovery_configs set data_rights_until=now()-interval '1 second' where account_id=$1",[account]],
  ['update icash_cost_observations set amount=2 where event_key=$1',[operation]],
  ['update icash_operation_spend set rate_id=$2 where operation_key=$1',[operation,sms]],
  ["update icash_operation_spend set state='reserved' where operation_key=$1",[operation]],
  ["update icash_dnc_verification_sources set enabled=false where observation_provider='dealmachine'",[]],
  ["update icash_dnc_verification_receipts set revoked_at=now() where evidence_kind='national_provider_observation'",[]],
  ["insert into icash_text_suppressions(phone,reason) values($1,'LOCAL STOP')",[phone]]
 ])await isolated(async()=>{await q(change,args);const old=(await select(original)).rows;assert.equal(old.length,0,change);assert.deepEqual((await select(replacement)).rows,old,change);});
 await isolated(async()=>{
  // Matching provenance does not establish that a receipt phone was in its source.
  // More than one batch of these must fail the original full proof BEFORE LIMIT.
  await q(`with template as materialized(select * from icash_dnc_verification_receipts where evidence_kind='national_provider_observation' limit 1)
   insert into icash_dnc_verification_receipts
   select cloned.* from template r cross join generate_series(1,105) n
   cross join lateral (select '+1214'||lpad((7000000+n)::text,7,'0') phone) absent
   cross join lateral jsonb_populate_record(null::icash_dnc_verification_receipts,to_jsonb(r)||jsonb_build_object(
    'id',('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'provider_reference','local-absent-phone-'||n,
    'phone',absent.phone,'contact_key',encode(sha256(convert_to(absent.phone,'UTF8')),'hex'))) cloned`);
  assert.deepEqual((await select(original,null)).rows,cold);
  assert.deepEqual((await select(replacement,null)).rows,cold);
 });
 await isolated(async()=>{
  const legacy=(await one("insert into icash_dnc_verification_sources(name,source_reference,enabled,expires_at) values('LOCAL legacy','LOCAL exact legacy source',true,now()+interval '1 day') returning id")).id;
  await q(`insert into icash_dnc_verification_receipts(source_id,phone,contact_key,provider_reference,receipt_hash,checked_at,expires_at,clear,contact_timezone,timezone_source_reference)
   select $1,phone,contact_key,'LOCAL legacy receipt',receipt_hash,checked_at,expires_at,clear,contact_timezone,timezone_source_reference
   from icash_dnc_verification_receipts where evidence_kind='national_provider_observation' limit 1`,[legacy]);
  const old=(await select(original,null)).rows;assert.equal(old.length,2);assert.deepEqual((await select(replacement,null)).rows,old,'legacy and national branches retain exact final ordering');
 });
 for(const [path,value] of [['{contacts}',null],['{contacts}',{}],['{contacts}',[]],['{contacts,0,phones}',{}],['{contacts,0,phones}',null],['{contacts,0,phones,0,number}',null],['{contacts,0,phones,0,number}',{}],['{requestedPersonIds}',{}],['{contacts,0,likelyOwner}',false],['{contacts,0,phones,0,doNotCall}',true]])await isolated(async()=>{
  // Deliberately malformed historical fixture only. The real source/receipt
  // immutability triggers are unchanged by the proposal and restored by rollback.
  await pg.exec('alter table icash_owner_contacts disable trigger icash_dealmachine_owner_source_immutable;alter table icash_dnc_verification_receipts disable trigger icash_dealmachine_dnc_observation_immutable');
  await q('update icash_owner_contacts set result=jsonb_set(result,$2::text[],$3::jsonb) where screening_id=$1',[screening,path,JSON.stringify(value)]);
  await q(`update icash_dnc_verification_receipts receipt set observation_provenance=jsonb_set(observation_provenance,'{savedResultHash}',to_jsonb(encode(sha256(convert_to(oc.result::text,'UTF8')),'hex')))
   from icash_owner_contacts oc where oc.screening_id=$1 and receipt.observation_provenance->>'screeningId'=oc.screening_id::text`,[screening]);
  assert.equal((await select(original)).rows.length,0,JSON.stringify({path,value}));
  assert.equal((await select(replacement)).rows.length,0,JSON.stringify({path,value}));
 });
 let oldCalls,newCalls;
 await isolated(async()=>{
  assert.equal(await rpc('icash_prepare_operational_contacts_before_dm_observations',{p_account:account}),2);
  // Counter wraps the real proof implementation, only inside this rolled-back
  // fixture. It is never part of the migration or a production helper.
  await pg.exec(`create sequence fixture_proof_calls;
alter function icash_dealmachine_credit_manifest_hash(text) rename to fixture_manifest_hash;
create function icash_dealmachine_credit_manifest_hash(operation text) returns text language plpgsql volatile as $$begin perform nextval('public.fixture_proof_calls');return public.fixture_manifest_hash(operation);end$$;`);
  await q("select setval('fixture_proof_calls',1,false)");assert.equal((await select(original)).rows.length,0);
  oldCalls=Number((await one('select case when is_called then last_value else 0 end n from fixture_proof_calls')).n);
  await q("select setval('fixture_proof_calls',1,false)");assert.equal((await select(replacement)).rows.length,0);
  newCalls=Number((await one('select case when is_called then last_value else 0 end n from fixture_proof_calls')).n);
  assert.equal(oldCalls,0);assert.equal(newCalls,0,'existing complete channels do not redo provider proof');
  await q("delete from icash_operational_contacts where account_id=$1 and channel='sms'",[account]);
  assert.deepEqual((await select(replacement)).rows,(await select(original)).rows,'one missing channel remains a candidate');
  assert.equal((await select(replacement)).rows.length,1);
 });
 let sparseTiming;
 if(process.env.PREPARATION_PERFORMANCE_TEST==='1')await isolated(async()=>{
  await dropFixtureIndexes();
  await q(`with template as materialized(select * from icash_dnc_verification_receipts where evidence_kind='national_provider_observation' limit 1)
   insert into icash_dnc_verification_receipts
   select cloned.* from template r cross join generate_series(1,15000) n
   cross join lateral (select '+1214'||lpad(n::text,7,'0') phone) unrelated
   cross join lateral jsonb_populate_record(null::icash_dnc_verification_receipts,to_jsonb(r)||jsonb_build_object(
    'id',gen_random_uuid(),'provider_reference','local-unrelated-receipt-'||n,
    'phone',unrelated.phone,'contact_key',encode(sha256(convert_to(unrelated.phone,'UTF8')),'hex'),
    'observation_provenance',r.observation_provenance||jsonb_build_object('screeningId',gen_random_uuid()::text))) cloned`);
  await pg.exec('analyze icash_dnc_verification_receipts');
  const plan=async query=>(await select('explain (analyze,format json) '+query,null)).rows[0]['QUERY PLAN'][0];
  const oldPlan=await plan(original),newUnindexed=await plan(replacement);
  assert.deepEqual((await select(replacement,null)).rows,(await select(original,null)).rows);
  await pg.exec('create index fixture_dnc_phone_expiry on icash_dnc_verification_receipts(phone,expires_at) where clear and revoked_at is null');
  const newIndexed=await plan(replacement),oldIndexed=await plan(original);
  await pg.exec("create index fixture_dnc_national_source on icash_dnc_verification_receipts((observation_provenance->>'screeningId'),expires_at) where evidence_kind='national_provider_observation' and clear and revoked_at is null");
  const sourceIndexed=await plan(replacement),originalBoth=await plan(original);
  assert.equal(sourceIndexed.Plan['Actual Rows'],1);assert.equal(originalBoth.Plan['Actual Rows'],1);
  assert.deepEqual((await select(replacement,null)).rows,cold);
  const paired=await repeatPlans(plan,original,replacement);
  writeFileSync('/tmp/icash-preparation-receipt-binding-plans.json',JSON.stringify({oldPlan,newUnindexed,newIndexed,oldIndexed,sourceIndexed,originalBoth,paired},null,2));
  assert.equal(oldPlan.Plan['Actual Rows'],1);assert.equal(newIndexed.Plan['Actual Rows'],1);
  sparseTiming={originalMs:oldPlan['Execution Time'],projectionMs:newUnindexed['Execution Time'],indexedProjectionMs:newIndexed['Execution Time'],indexOnlyMs:oldIndexed['Execution Time'],sourceIndexedMs:sourceIndexed['Execution Time'],originalBothIndexesMs:originalBoth['Execution Time'],paired,sourceIndexUsed:JSON.stringify(sourceIndexed).includes('fixture_dnc_national_source'),indexUsed:JSON.stringify(newIndexed).includes('fixture_dnc_phone_expiry')};
 });
 let warmTiming;
 if(process.env.PREPARATION_PERFORMANCE_TEST==='1')await isolated(async()=>{
  await dropFixtureIndexes();
  await q(`create temporary table fixture_preparation_sources as
   select n,gen_random_uuid() screening,gen_random_uuid() reservation,gen_random_uuid() receipt,
    'local-many-source-'||n operation,'local-property-'||n property,
    '+1214'||lpad((1000000+n)::text,7,'0') phone
   from generate_series(1,3000) n`);
  await q(`insert into icash_screening_jobs
   select cloned.* from icash_screening_jobs template cross join fixture_preparation_sources f
   cross join lateral jsonb_populate_record(null::icash_screening_jobs,to_jsonb(template)||jsonb_build_object(
    'id',f.screening,'event_key',f.operation,'snapshot',template.snapshot||jsonb_build_object('propertyId',f.property))) cloned
   where template.id=$1`,[screening]);
  await q(`insert into icash_credit_reservations
   select cloned.* from icash_credit_reservations template cross join fixture_preparation_sources f
   cross join lateral jsonb_populate_record(null::icash_credit_reservations,to_jsonb(template)||jsonb_build_object(
    'id',f.reservation,'operation_key',f.operation)) cloned where template.operation_key=$1`,[operation]);
  await q(`insert into icash_operation_spend
   select cloned.* from icash_operation_spend template cross join fixture_preparation_sources f
   cross join lateral jsonb_populate_record(null::icash_operation_spend,to_jsonb(template)||jsonb_build_object(
    'operation_key',f.operation,'credit_reservation_id',f.reservation)) cloned where template.operation_key=$1`,[operation]);
  await q(`insert into icash_owner_contacts(account_id,screening_id,operation_key,result,created_at)
   select original.account_id,f.screening,f.operation,
    jsonb_set(jsonb_set(original.result,'{propertyId}',to_jsonb(f.property)),'{contacts,0,phones}',
     to_jsonb(array_fill(jsonb_build_object('number',f.phone,'doNotCall',false,'permission','unverified'),array[4]))),original.created_at
   from icash_owner_contacts original cross join fixture_preparation_sources f where original.screening_id=$1`,[screening]);
  await q(`insert into icash_dnc_verification_receipts
   select cloned.* from icash_dnc_verification_receipts template cross join fixture_preparation_sources f
   join icash_owner_contacts oc on oc.screening_id=f.screening
   cross join lateral jsonb_populate_record(null::icash_dnc_verification_receipts,to_jsonb(template)||jsonb_build_object(
    'id',f.receipt,'phone',f.phone,'contact_key',encode(sha256(convert_to(f.phone,'UTF8')),'hex'),'provider_reference',f.operation,
    'observation_provenance',template.observation_provenance||jsonb_build_object('screeningId',f.screening::text,'operationKey',f.operation,
     'savedResultHash',encode(sha256(convert_to(oc.result::text,'UTF8')),'hex')))) cloned
   where template.evidence_kind='national_provider_observation' and template.observation_provenance->>'screeningId'=$1::text`,[screening]);
  await q(`insert into icash_cost_observations(provider,event_key,source_ref,amount,units,observed_at)
   select 'dealmachine',f.operation||field.suffix,'dealmachine:owners:'||f.operation||field.suffix,field.amount,'provider_credits',now()-interval '57 minutes'
   from fixture_preparation_sources f cross join (values('',1),(':people',1),(':properties',0),(':deduplicated',0)) field(suffix,amount)`);
  await q(`insert into icash_dealmachine_dnc_ingestions
   select cloned.* from icash_dealmachine_dnc_ingestions template cross join fixture_preparation_sources f
   join icash_operation_spend spend on spend.operation_key=f.operation
   join icash_credit_reservations reserve_rec on reserve_rec.id=f.reservation
   join icash_owner_contacts oc on oc.screening_id=f.screening
   join icash_dnc_verification_receipts receipt on receipt.id=f.receipt
   cross join lateral jsonb_populate_record(null::icash_dealmachine_dnc_ingestions,to_jsonb(template)||jsonb_build_object(
    'screening_id',f.screening,'operation_key',f.operation,'source_hash',receipt.receipt_hash,
    'provider_operation_hash',public.icash_dealmachine_operation_hash(spend,reserve_rec),
    'provider_cost_hash',public.icash_dealmachine_credit_manifest_hash(f.operation),
    'source_recorded_at',oc.created_at,'request_started_at',receipt.checked_at,'ingested_at',receipt.observation_recorded_at,'original_expires_at',receipt.expires_at)) cloned
   where template.screening_id=$1`,[screening]);
  await q(`insert into icash_operational_contacts(account_id,screening_id,channel,phone,contact_key,timezone,timezone_basis,local_start_hour,local_end_hour,owner_user_id,sending_principal,source_hash,dnc_receipt_id,eligibility_until)
   select oc.account_id,oc.screening_id,ch,f.phone,encode(sha256(convert_to(f.phone,'UTF8')),'hex'),$1,'source_record',9,18,$2,$3,
    encode(sha256(convert_to(oc.result::text,'UTF8')),'hex'),f.receipt,now()+interval '1 day'
   from fixture_preparation_sources f join icash_owner_contacts oc on oc.screening_id=f.screening cross join unnest(array['voice','sms']) ch`,[f.timezone,user,'SIMULATION business']);
  for(const table of ['icash_screening_jobs','icash_owner_contacts','icash_operation_spend','icash_credit_reservations','icash_dnc_verification_receipts','icash_operational_contacts'])await pg.exec('analyze '+table);
  const plan=async query=>(await select('explain (analyze,buffers,format json) '+query,null)).rows[0]['QUERY PLAN'][0];
  const originalWarm=await plan(original),receiptWarm=await plan(replacement);
  assert.equal(originalWarm.Plan['Actual Rows'],1);assert.equal(receiptWarm.Plan['Actual Rows'],1);
  await pg.exec('create index fixture_warm_dnc_phone on icash_dnc_verification_receipts(phone,expires_at) where clear and revoked_at is null');
  const indexWarm=await plan(original);
  await pg.exec("create index fixture_warm_national_source on icash_dnc_verification_receipts((observation_provenance->>'screeningId'),expires_at) where evidence_kind='national_provider_observation' and clear and revoked_at is null");
  const sourceIndexedWarm=await plan(replacement),originalBothWarm=await plan(original);
  assert.equal(sourceIndexedWarm.Plan['Actual Rows'],1);assert.equal(originalBothWarm.Plan['Actual Rows'],1);
  assert.deepEqual((await select(replacement,null)).rows,cold);
  const paired=await repeatPlans(plan,original,replacement);
  assert.deepEqual((await select(original,null)).rows,cold);
  writeFileSync('/tmp/icash-preparation-warm-plans.json',JSON.stringify({originalWarm,receiptWarm,indexWarm,sourceIndexedWarm,originalBothWarm,paired},null,2));
  warmTiming={sources:3000,phoneEntries:12000,originalMs:originalWarm['Execution Time'],receiptMs:receiptWarm['Execution Time'],indexOnlyMs:indexWarm['Execution Time'],sourceIndexedMs:sourceIndexedWarm['Execution Time'],originalBothIndexesMs:originalBothWarm['Execution Time'],paired,sourceIndexUsed:JSON.stringify(sourceIndexedWarm).includes('fixture_warm_national_source')};
 });
 await dropFixtureIndexes();
 const wallet=(await one('select to_jsonb(w) value from icash_wallets w where account_id=$1',[account])).value;
 const costs=(await one('select count(*) n from icash_operation_spend')).n;
 const unchangedState=async()=>({
  budget:(await one('select to_jsonb(b) value from icash_operating_budget b where id=1')).value,
  functionSecurity:(await q("select oid::regprocedure::text signature,proowner,proacl,prosecdef,proconfig,provolatile,proparallel,proleakproof from pg_proc where oid in ('icash_prepare_operational_contacts_before_dm_observations(uuid)'::regprocedure,'icash_operational_source_phone(jsonb,text)'::regprocedure,'icash_operational_contact_current(uuid,uuid,text,boolean)'::regprocedure) order by 1")).rows,
  receipts:(await q('select to_jsonb(r) value from icash_dnc_verification_receipts r order by id')).rows,
  entrypoints:(await q("select oid::regprocedure::text signature,pg_get_functiondef(oid) definition from pg_proc where oid in ('icash_queue_voice_jobs()'::regprocedure,'icash_prepare_operational_contacts(uuid)'::regprocedure,'icash_project_operational_sms_contacts(uuid)'::regprocedure) order by 1")).rows
 });
 const preserved=await unchangedState();
 if(native){
  await (await import('./helpers/preparation-native-installation.mjs')).verifyPreparationInstallation(f,{indexStatements,patchSql:sql,migrations});
 }else{
  const refuse=async()=>{
   await assert.rejects(pg.exec(sql),/Preparation receipt binding indexes are absent, invalid, or changed/);
   await pg.exec('rollback');
   assert.deepEqual(await unchangedState(),preserved);
   assert.equal((await one("select pg_get_functiondef('icash_prepare_operational_contacts_before_dm_observations(uuid)'::regprocedure) definition")).definition,before);
  };
  await refuse();
  await pg.exec('create index icash_dnc_clear_phone_expiry on public.icash_dnc_verification_receipts(id)');
  await pg.exec(fixtureIndexStatements[1]);
  await refuse();
  await pg.exec('drop index icash_dnc_clear_phone_expiry');
  await pg.exec(fixtureIndexStatements[0]);
 }
 for(const signature of ['icash_prepare_operational_contacts_before_dm_observations(uuid)','icash_operational_source_phone(jsonb,text)']){
  const definition=(await one('select pg_get_functiondef($1::regprocedure) definition',[signature])).definition;
  const drift=definition.replace('AS $function$','AS $function$\n-- Isolated prerequisite drift');
  assert.notEqual(drift,definition,'Fixture must actually alter the function body');
  await pg.exec(drift);
  const changed=(await one('select pg_get_functiondef($1::regprocedure) definition',[signature])).definition;
  await assert.rejects(pg.exec(sql),/Preparation receipt binding prerequisite changed/);
  await pg.exec('rollback');
  assert.equal((await one('select pg_get_functiondef($1::regprocedure) definition',[signature])).definition,changed,'Refused migration must not overwrite the changed prerequisite');
  await pg.exec(definition);
  assert.deepEqual(await unchangedState(),preserved,'Restored fixture retains owner, ACL and security metadata');
 }
 await pg.exec(sql);
 assert.equal((await one("select pg_get_functiondef('icash_prepare_operational_contacts_before_dm_observations(uuid)'::regprocedure) definition")).definition,before.replace(original,replacement),'only selector changes; insertion loop remains exact');
 assert.equal((await one("select pg_get_functiondef('icash_operational_contact_current(uuid,uuid,text,boolean)'::regprocedure) definition")).definition,validator);

 for(const name of ['icash_dnc_clear_phone_expiry','icash_dnc_clear_national_screening_expiry']){
  assert.equal((await one('select indisvalid and indisready ready from pg_index where indexrelid=$1::regclass',[name])).ready,true);
 }
 assert(!replacement.includes('source.*'));
 assert.equal((replacement.match(/\blimit\b/gi)??[]).length,1,'only original final LIMIT remains');
 assert.equal(await rpc('icash_prepare_operational_contacts_before_dm_observations',{p_account:account}),2);
 assert.equal(await rpc('icash_prepare_operational_contacts_before_dm_observations',{p_account:account}),0);
 assert.deepEqual((await one('select to_jsonb(w) value from icash_wallets w where account_id=$1',[account])).value,wallet);
 assert.equal((await one('select count(*) n from icash_operation_spend')).n,costs);
 assert.deepEqual(await unchangedState(),preserved,'Receipt rows, operating budget and complete queue/entrypoint definitions remain unchanged');
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'icash_prepare_operational_contacts_before_dm_observations(uuid)','execute') allowed",[role])).allowed,false);
 assert.equal((await one("select has_function_privilege('service_role','icash_prepare_operational_contacts_before_dm_observations(uuid)','execute') allowed")).allowed,true);
 await assert.rejects(pg.exec(sql),/Preparation receipt binding prerequisite changed/);await pg.exec('rollback');

 if(native)await (await import('./helpers/preparation-native-contention.mjs')).verifyPreparationContention(f);
 const performance={fanout:positiveTiming,...(sparseTiming?{sparse:sparseTiming}:{}),...(warmTiming?{warm:warmTiming}:{})};
 console.log(`Preparation receipt bindings: exact cold/warm/missing-channel/account/gate equivalence; 600 foreign bindings and 105 invalid proofs do not starve the authentic candidate; warm real manifest proof calls ${oldCalls}->${newCalls}; absent-source phones, malformed sources and legacy ordering preserved; insertion, validator, wallet and private ACLs preserved. Local fixture diagnostics only: ${JSON.stringify(performance)}.`);
}catch(error){console.error(error.message,error.where??'');process.exitCode=1;}finally{await pg.close();}
