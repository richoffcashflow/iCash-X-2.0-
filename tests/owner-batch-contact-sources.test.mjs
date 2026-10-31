// Local saved-receipt fixtures only. No provider requests, sends or charges.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createOperationalContactFixture} from './helpers/operational-contact-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('config/owner-batch-contact-sources.sql');
assert.equal(sql,read('supabase/migrations/20261026164858_owner_batch_contact_sources.sql'));
const f=await createOperationalContactFixture(fileURLToPath(import.meta.resolve('@electric-sql/pglite')));
const {pg,q,rpc,one,isolated,account,user,other,phone,screening,source,dnc,sourceResult}=f;
const operation='owners:'+account+':'+screening,batch=randomUUID();
const sourceStart=()=>one('select icash_dealmachine_owner_source_started_at($1,$2) value',[account,screening]).then(r=>r.value);
try{
 await q('delete from icash_dnc_verification_receipts where id=$1',[dnc]);
 await q('delete from icash_dnc_verification_sources where id=$1',[source]);
 await q("update icash_operation_spend set created_at=now()-interval '59 minutes',dispatched_at=now()-interval '58 minutes',settled_at=now()-interval '57 minutes' where operation_key=$1",[operation]);
 await q("update icash_owner_contacts set result=result||jsonb_build_object('fetchedAt',to_char((now()-interval '57 minutes') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),'allocation',jsonb_build_object('batchId',$2::text,'method','unique-person-order-v1','sharedContacts',0)),created_at=now()-interval '56 minutes' where screening_id=$1",[screening,batch]);
 for(const [field,amount] of [['used',1],['people',1],['properties',0],['deduplicated',0]]){
  const key=operation+(field==='used'?'':':'+field);
  await q("insert into icash_cost_observations(provider,event_key,source_ref,amount,units,observed_at) values('dealmachine',$1,'dealmachine:owners:'||$1,$2,'provider_credits',now()-interval '57 minutes')",[key,amount]);
 }
 await pg.exec(read('config/dealmachine-dnc-observations.sql'));
 for(const d of Object.values(JSON.parse(read('tests/fixtures/owner-batch-contact-source-baseline.json'))))await pg.exec(d);
 await pg.exec(`create schema icash_research_private;
 create table icash_research_private.owner_batches(id uuid primary key,account_id uuid,primary_screening uuid,created_at timestamptz,state text,items jsonb,preview_receipt jsonb,paid_receipt jsonb,results jsonb);
 create table icash_research_private.owner_batch_items(screening_id uuid primary key,batch_id uuid,operation_key text unique);
 revoke all on schema icash_research_private from public,anon,authenticated,service_role;
 revoke all on all tables in schema icash_research_private from public,anon,authenticated,service_role;`);
 await q("insert into icash_research_private.owner_batches select $1::uuid,$2::uuid,$3::uuid,now()-interval '1 hour','complete',jsonb_build_array(jsonb_build_object('screeningId',($3::uuid)::text,'snapshot',jsonb_build_object('propertyId',result->>'propertyId'),'ids',result->'requestedPersonIds')),'{}',jsonb_build_object('credits',result->'providerCredits'),jsonb_build_array(jsonb_build_object('screeningId',($3::uuid)::text,'result',result)) from icash_owner_contacts where screening_id=$3::uuid",[batch,account,screening]);
 await q('insert into icash_research_private.owner_batch_items values($1,$2,$3)',[screening,batch,operation]);
 await q("update icash_dnc_verification_sources set enabled=true,expires_at=now()+interval '1 day' where observation_provider='dealmachine'");
 assert.equal(await rpc('icash_prepare_operational_contacts',{p_account:account}),0,'completion timestamp reproduced the batch handoff failure');
 const wallet=(await one('select to_jsonb(w) value from icash_wallets w where account_id=$1',[account])).value;
 const original=(await one('select result value from icash_owner_contacts where screening_id=$1',[screening])).value;
 await pg.exec(sql);
 const started=(await one('select created_at value from icash_research_private.owner_batches where id=$1',[batch])).value;
 assert.equal(new Date(await sourceStart()).getTime(),new Date(started).getTime(),'actual original batch admission supplies the lower bound');
 assert.equal((await one('select icash_dealmachine_owner_source_started_at($1,$2) value',[other,screening])).value,null);
 for(const [change,args] of [
  ["update icash_research_private.owner_batches set account_id=$2 where id=$1",[batch,other]],
  ["update icash_research_private.owner_batches set state='claimed' where id=$1",[batch]],
  ["update icash_research_private.owner_batches set paid_receipt=null where id=$1",[batch]],
  ["update icash_research_private.owner_batches set results='[]' where id=$1",[batch]],
  ["update icash_research_private.owner_batches set results=jsonb_set(results,'{0,result,contacts,0,phones,0,doNotCall}','true') where id=$1",[batch]],
  ["update icash_research_private.owner_batches set items=jsonb_set(items,'{0,ids}','[]') where id=$1",[batch]],
  ["update icash_research_private.owner_batches set created_at=now() where id=$1",[batch]],
  ["update icash_research_private.owner_batch_items set operation_key='foreign' where screening_id=$1",[screening]],
 ])await isolated(async()=>{await q(change,args);assert.equal(await sourceStart(),null,change);assert.equal(await rpc('icash_prepare_operational_contacts',{p_account:account}),0);});
 await isolated(async()=>{
  await q("update icash_accounts set bot_paused=true where id=$1",[account]);
  assert.equal(await rpc('icash_prepare_operational_contacts',{p_account:account}),0,'Pause still prevents projection');
 });
 await isolated(async()=>{
  await q("update icash_research_private.owner_batches set created_at=now()-interval '2 days' where id=$1",[batch]);
  const result=await rpc('icash_ingest_dealmachine_dnc_observations',{p_account:account,p_user:user,p_screening:screening});
  assert.equal(result.status,'source_too_old','old receipts are never renewed');assert.equal(result.observations,0);
 });
 await isolated(async()=>{
  // A shared owner stays attached to this property while its credits were
  // allocated elsewhere in the completed batch. No double billing is invented.
  await q("update icash_owner_contacts set result=result||'{\"creditsUsed\":0,\"peopleCredits\":0,\"providerCredits\":{\"used\":0,\"people\":0,\"properties\":0,\"deduplicated\":0}}'::jsonb where screening_id=$1",[screening]);
  await q("update icash_owner_contacts set result=jsonb_set(result,'{allocation,sharedContacts}','1') where screening_id=$1",[screening]);
  await q("update icash_cost_observations set amount=0 where event_key in ($1,$1||':people')",[operation]);
  await q("update icash_research_private.owner_batches set results=(select jsonb_build_array(jsonb_build_object('screeningId',($2::uuid)::text,'result',result)) from icash_owner_contacts where screening_id=$2::uuid) where id=$1",[batch,screening]);
  assert.equal((await one('select icash_dealmachine_saved_owner_result_valid(result) value from icash_owner_contacts where screening_id=$1',[screening])).value,true);
  const result=await rpc('icash_ingest_dealmachine_dnc_observations',{p_account:account,p_user:user,p_screening:screening});
  assert.equal(result.observations,1,'valid shared contacts can proceed without another lookup');
 });
 await isolated(async()=>{
  await q("update icash_owner_contacts set result=result-'allocation'||jsonb_build_object('fetchedAt',to_char((now()-interval '1 hour') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')) where screening_id=$1",[screening]);
  assert.equal((await one('select icash_dealmachine_owner_source_started_at($1,$2)=icash_dealmachine_request_started_at(result) value from icash_owner_contacts where screening_id=$2',[account,screening])).value,true,'legacy request timestamp unchanged');
  assert.equal((await rpc('icash_ingest_dealmachine_dnc_observations',{p_account:account,p_user:user,p_screening:screening})).observations,1);
 });
 for(const status of [true,null])await isolated(async()=>{
  await q("update icash_owner_contacts set result=jsonb_set(result,'{contacts,0,phones,0,doNotCall}',$2::jsonb) where screening_id=$1",[screening,JSON.stringify(status)]);
  await q("update icash_research_private.owner_batches set results=(select jsonb_build_array(jsonb_build_object('screeningId',($2::uuid)::text,'result',result)) from icash_owner_contacts where screening_id=$2::uuid) where id=$1",[batch,screening]);
  const held=await rpc('icash_ingest_dealmachine_dnc_observations',{p_account:account,p_user:user,p_screening:screening});
  assert.equal(held.observations,0,'DNC or unknown phone status stays held');
 });
 const ingested=await rpc('icash_ingest_dealmachine_dnc_observations',{p_account:account,p_user:user,p_screening:screening});
 assert.equal(ingested.observations,1);
 assert.equal((await rpc('icash_ingest_dealmachine_dnc_observations',{p_account:account,p_user:user,p_screening:screening})).status,'already_recorded');
 assert.equal(await rpc('icash_prepare_operational_contacts',{p_account:account}),2,'voice and SMS targets enter their ordinary eligibility paths');
 assert.equal(await rpc('icash_prepare_operational_contacts',{p_account:account}),0,'no duplicate targets');
 const target=(await one('select id from icash_operational_contacts where account_id=$1 and channel=\'sms\'',[account])).id;
 assert.equal(await rpc('icash_lock_operational_dnc',{p_account:account,p_contact:target}),true);
 await isolated(async()=>{await q("update icash_research_private.owner_batches set state='claimed' where id=$1",[batch]);assert.equal(await rpc('icash_lock_operational_dnc',{p_account:account,p_contact:target}),false,'final checks revalidate the original batch proof');});
 await isolated(async()=>{await q("update icash_dnc_verification_receipts set revoked_at=now() where evidence_kind='national_provider_observation'");assert.equal(await rpc('icash_operational_contact_current',{p_account:account,p_contact:target,p_channel:'sms',p_check_hour:false}),false);});
 assert.deepEqual((await one('select result value from icash_owner_contacts where screening_id=$1',[screening])).value,original,'original saved source remains untouched');
 assert.deepEqual((await one('select to_jsonb(w) value from icash_wallets w where account_id=$1',[account])).value,wallet,'no wallet mutation');
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'icash_dealmachine_owner_source_started_at(uuid,uuid)','execute') value",[role])).value,false);
 assert.equal((await one("select has_function_privilege('service_role','icash_dealmachine_owner_source_started_at(uuid,uuid)','execute') value")).value,true);
 console.log('PASS batch contact handoff: original receipt/account binding, admission timestamp, shared-credit allocation, actual voice/SMS projection, final revocation/Pause, expiry, legacy records, idempotency and unchanged wallet/source. No provider work.');
}catch(error){console.error(error.stack,error.where??'');process.exitCode=1;}finally{await pg.close();}
