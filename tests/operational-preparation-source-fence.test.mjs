// Isolated PGlite PostgreSQL fixtures only; no provider traffic or production writes.
// Equivalent source binding; no production mutation, indexes or provider calls.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createOperationalContactFixture} from './helpers/operational-contact-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('config/operational-preparation-source-fence.sql');
const names=readdirSync(new URL('../supabase/migrations',import.meta.url)).filter(n=>n.endsWith('_operational_preparation_source_fence.sql'));
assert.equal(names.length,1);assert.equal(read('supabase/migrations/'+names[0]),sql);
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
 const wallet=(await one('select to_jsonb(w) value from icash_wallets w where account_id=$1',[account])).value;
 const costs=(await one('select count(*) n from icash_operation_spend')).n;
 const unchangedState=async()=>({
  budget:(await one('select to_jsonb(b) value from icash_operating_budget b where id=1')).value,
  functionSecurity:(await q("select oid::regprocedure::text signature,proowner,proacl,prosecdef,proconfig,provolatile,proparallel,proleakproof from pg_proc where oid in ('icash_prepare_operational_contacts_before_dm_observations(uuid)'::regprocedure,'icash_operational_source_phone(jsonb,text)'::regprocedure,'icash_operational_contact_current(uuid,uuid,text,boolean)'::regprocedure) order by 1")).rows,
  receipts:(await q('select to_jsonb(r) value from icash_dnc_verification_receipts r order by id')).rows,
  entrypoints:(await q("select oid::regprocedure::text signature,pg_get_functiondef(oid) definition from pg_proc where oid in ('icash_queue_voice_jobs()'::regprocedure,'icash_prepare_operational_contacts(uuid)'::regprocedure,'icash_project_operational_sms_contacts(uuid)'::regprocedure) order by 1")).rows
 });
 const preserved=await unchangedState();
 for(const signature of ['icash_prepare_operational_contacts_before_dm_observations(uuid)','icash_operational_source_phone(jsonb,text)']){
  const definition=(await one('select pg_get_functiondef($1::regprocedure) definition',[signature])).definition;
  const drift=definition.replace('AS $function$','AS $function$\n-- Isolated prerequisite drift');
  assert.notEqual(drift,definition,'Fixture must actually alter the function body');
  await pg.exec(drift);
  const changed=(await one('select pg_get_functiondef($1::regprocedure) definition',[signature])).definition;
  await assert.rejects(pg.exec(sql),/Preparation source fence prerequisite changed/);
  await pg.exec('rollback');
  assert.equal((await one('select pg_get_functiondef($1::regprocedure) definition',[signature])).definition,changed,'Refused migration must not overwrite the changed prerequisite');
  await pg.exec(definition);
  assert.deepEqual(await unchangedState(),preserved,'Restored fixture retains owner, ACL and security metadata');
 }
 await pg.exec(sql);
 assert.equal((await one("select pg_get_functiondef('icash_prepare_operational_contacts_before_dm_observations(uuid)'::regprocedure) definition")).definition,before.replace(original,replacement),'only selector changes; insertion loop remains exact');
 assert.equal((await one("select pg_get_functiondef('icash_operational_contact_current(uuid,uuid,text,boolean)'::regprocedure) definition")).definition,validator);

 assert(!replacement.includes('source.*'));
 assert.equal((replacement.match(/\blimit\b/gi)??[]).length,1,'only original final LIMIT remains');
 assert.equal(await rpc('icash_prepare_operational_contacts_before_dm_observations',{p_account:account}),2);
 assert.equal(await rpc('icash_prepare_operational_contacts_before_dm_observations',{p_account:account}),0);
 assert.deepEqual((await one('select to_jsonb(w) value from icash_wallets w where account_id=$1',[account])).value,wallet);
 assert.equal((await one('select count(*) n from icash_operation_spend')).n,costs);
 assert.deepEqual(await unchangedState(),preserved,'Receipt rows, operating budget and complete queue/entrypoint definitions remain unchanged');
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'icash_prepare_operational_contacts_before_dm_observations(uuid)','execute') allowed",[role])).allowed,false);
 assert.equal((await one("select has_function_privilege('service_role','icash_prepare_operational_contacts_before_dm_observations(uuid)','execute') allowed")).allowed,true);
 await assert.rejects(pg.exec(sql),/Preparation source fence prerequisite changed/);await pg.exec('rollback');

 if(native)await (await import('./helpers/preparation-native-contention.mjs')).verifyPreparationContention(f);
 const performance={fanout:positiveTiming};
 console.log(`Preparation source fence: exact cold/warm/missing-channel/account/gate equivalence; 600 foreign bindings and 105 invalid proofs do not starve the authentic candidate; warm real manifest proof calls ${oldCalls}->${newCalls}; absent-source phones, malformed sources and legacy ordering preserved; insertion, validator, wallet and private ACLs preserved. Local fixture diagnostics only: ${JSON.stringify(performance)}.`);
}catch(error){console.error(error.message,error.where??'');process.exitCode=1;}finally{await pg.close();}
