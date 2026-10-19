// Local PostgreSQL only; genuine fixture evidence and helpers, no provider work.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createOperationalContactFixture} from './helpers/operational-contact-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('config/operational-preparation-candidate-fence.sql');
const original=sql.match(/original_query text:=\$original\$([\s\S]*?)\$original\$/)[1];
const replacement=sql.match(/replacement_query text:=\$replacement\$([\s\S]*?)\$replacement\$/)[1];
const f=await createOperationalContactFixture(fileURLToPath(import.meta.resolve('@electric-sql/pglite')));
const {pg,q,rpc,one,isolated,account,user,other,newOwner,phone,screening,source,dnc,sms}=f;
const select=(query,a=account)=>q(query.replaceAll('p_account','$1::uuid'),[a]);
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
 await pg.exec('create table icash_timezone_names as select name from pg_timezone_names');
 await pg.exec(read('tests/fixtures/operational-preparation-before-fence.sql'));
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
  assert(oldCalls>0);assert.equal(newCalls,0,'existing complete channels do not redo provider proof');
  await q("delete from icash_operational_contacts where account_id=$1 and channel='sms'",[account]);
  assert.deepEqual((await select(replacement)).rows,(await select(original)).rows,'one missing channel remains a candidate');
  assert.equal((await select(replacement)).rows.length,1);
 });
 const wallet=(await one('select to_jsonb(w) value from icash_wallets w where account_id=$1',[account])).value;
 const costs=(await one('select count(*) n from icash_operation_spend')).n;
 await pg.exec(sql);
 assert.equal((await one("select pg_get_functiondef('icash_prepare_operational_contacts_before_dm_observations(uuid)'::regprocedure) definition")).definition,before.replace(original,replacement),'only selector changes; insertion loop remains exact');
 assert.equal((await one("select pg_get_functiondef('icash_operational_contact_current(uuid,uuid,text,boolean)'::regprocedure) definition")).definition,validator);
 assert.equal((replacement.match(/\blimit\b/gi)??[]).length,1,'only original final LIMIT remains');
 assert.equal(await rpc('icash_prepare_operational_contacts_before_dm_observations',{p_account:account}),2);
 assert.equal(await rpc('icash_prepare_operational_contacts_before_dm_observations',{p_account:account}),0);
 assert.deepEqual((await one('select to_jsonb(w) value from icash_wallets w where account_id=$1',[account])).value,wallet);
 assert.equal((await one('select count(*) n from icash_operation_spend')).n,costs);
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'icash_prepare_operational_contacts_before_dm_observations(uuid)','execute') allowed",[role])).allowed,false);
 assert.equal((await one("select has_function_privilege('service_role','icash_prepare_operational_contacts_before_dm_observations(uuid)','execute') allowed")).allowed,true);
 await assert.rejects(pg.exec(sql),/Operational preparation candidate prerequisite changed/);await pg.exec('rollback');
 assert.equal(sql,read('supabase/migrations/20261019192236_operational_preparation_candidate_fence.sql'));
 console.log(`Preparation candidate fence: exact cold/warm/missing-channel/account/gate equivalence; 600 foreign bindings and 105 invalid proofs do not starve the authentic candidate; warm real manifest proof calls ${oldCalls}->${newCalls}; insertion, validator, wallet and private ACLs preserved. Positive fanout fixture timing (diagnostic only): ${JSON.stringify(positiveTiming)}.`);
}catch(error){console.error(error.message,error.where??'');process.exitCode=1;}finally{await pg.close();}
