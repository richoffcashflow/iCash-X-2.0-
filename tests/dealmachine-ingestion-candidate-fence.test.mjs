// Local PostgreSQL fixture only; no network, provider dispatch or paid work.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createOperationalContactFixture} from './helpers/operational-contact-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('config/dealmachine-ingestion-candidate-fence.sql');
const original=sql.match(/original_query text:=\$original\$([\s\S]*?)\$original\$/)[1];
const replacement=sql.match(/replacement_query text:=\$replacement\$([\s\S]*?)\$replacement\$/)[1];
const f=await createOperationalContactFixture(fileURLToPath(import.meta.resolve('@electric-sql/pglite')));
const {pg,q,rpc,one,isolated,account,user,other,screening,source,dnc,sms}=f;
const select=(query,a=account)=>q(query.replaceAll('p_account','$1::uuid'),[a]);
const definition=name=>one("select pg_get_functiondef($1::regprocedure) definition",[name]).then(r=>r.definition);
try {
 await q('delete from icash_dnc_verification_receipts where id=$1',[dnc]);
 await q('delete from icash_dnc_verification_sources where id=$1',[source]);
 const operation='owners:'+account+':'+screening;
 await q("update icash_owner_contacts set result=jsonb_set(result,'{fetchedAt}',to_jsonb(to_char(now()-interval '1 hour','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))),created_at=now()-interval '56 minutes' where screening_id=$1",[screening]);
 await q("update icash_operation_spend set created_at=now()-interval '59 minutes',dispatched_at=now()-interval '58 minutes',settled_at=now()-interval '57 minutes' where operation_key=$1",[operation]);
 for(const [field,amount] of [['used',1],['people',1],['properties',0],['deduplicated',0]]) {
  const key=operation+(field==='used'?'':':'+field);
  await q("insert into icash_cost_observations(provider,event_key,source_ref,amount,units,observed_at) values('dealmachine',$1,'dealmachine:owners:'||$1,$2,'provider_credits',now()-interval '57 minutes')",[key,amount]);
 }
 await pg.exec(read('config/dealmachine-dnc-observations.sql'));
 await q("update icash_dnc_verification_sources set enabled=true,expires_at=now()+interval '1 day' where observation_provider='dealmachine'");
 const before=await definition('icash_prepare_operational_contacts(uuid)');
 const writer=await definition('icash_ingest_dealmachine_dnc_observations(uuid,uuid,uuid)');
 const projector=await definition('icash_project_operational_sms_contacts(uuid)');
 const inner=await definition('icash_prepare_operational_contacts_before_dm_observations(uuid)');
 const ready=(await select(original)).rows;
 assert.deepEqual(ready,[{account_id:account,owner_user_id:user,screening_id:screening}]);
 assert.deepEqual((await select(replacement)).rows,ready);
 assert.deepEqual((await select(replacement,null)).rows,ready,'global sweep unchanged');
 assert.equal((await select(replacement,other)).rows.length,0,'account scope remains exact');

 const cases=[
  ["update icash_accounts set bot_paused=true where id=$1",[account]],
  ["update icash_operation_spend set state='reserved',dispatched_at=null where operation_key=$1",[operation]],
  ["update icash_operation_spend set dispatched_at=null where operation_key=$1",[operation]],
  ["update icash_operation_spend set dispatched_at=now() where operation_key=$1",[operation]],
  ["update icash_operation_spend set created_at=now()-interval '2 hours' where operation_key=$1",[operation]],
  ["update icash_operation_spend set rate_id=$2 where operation_key=$1",[operation,sms]],
  ["delete from icash_cost_observations where event_key=$1",[operation]],
  ["update icash_cost_observations set amount=2 where event_key=$1",[operation]],
  ["update icash_cost_observations set source_ref='foreign provider observation' where event_key=$1",[operation]],
  ["update icash_cost_observations set units='unknown' where event_key=$1",[operation]],
  ["update icash_cost_observations set observed_at=now() where event_key=$1",[operation]],
  ["update icash_cost_observations set observed_at=now()-interval '2 hours' where event_key=$1",[operation]],
  ["update icash_owner_contacts set result=result-'fetchedAt' where screening_id=$1",[screening]],
  ["update icash_owner_contacts set result=jsonb_set(result,'{fetchedAt}','\"invalid timestamp\"') where screening_id=$1",[screening]],
  ["update icash_owner_contacts set result=jsonb_set(result,'{fetchedAt}',to_jsonb(to_char(now()+interval '1 hour','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))) where screening_id=$1",[screening]],
  ["update icash_owner_contacts set result=jsonb_set(result,'{contacts}','null') where screening_id=$1",[screening]],
  ["update icash_owner_contacts set result=jsonb_set(result,'{contacts}',(select jsonb_agg('{}'::jsonb) from generate_series(1,26))) where screening_id=$1",[screening]],
  ["update icash_owner_contacts set result=jsonb_set(result,'{requestedPersonIds}','[]') where screening_id=$1",[screening]],
  ["update icash_owner_contacts set result=jsonb_set(result,'{providerCredits,used}','2') where screening_id=$1",[screening]],
  ["update icash_owner_contacts set result=jsonb_set(result,'{propertyId}','\"foreign property\"') where screening_id=$1",[screening]],
  ["update icash_screening_jobs set snapshot=snapshot||'{\"practice\":true}' where id=$1",[screening]],
  ["update icash_screening_jobs set state='failed' where id=$1",[screening]]
 ];
 for(const [change,args] of cases) await isolated(async()=>{
  await q(change,args);const expected=(await select(original)).rows;
  assert.equal(expected.length,0,change);assert.deepEqual((await select(replacement)).rows,expected,change);
 });
 await isolated(async()=>{
  await q("update icash_operation_spend set state='dispatched',settled_at=null where operation_key=$1",[operation]);
  assert.deepEqual((await select(replacement)).rows,(await select(original)).rows,'dispatched receipt-backed work remains eligible');
  assert.equal((await select(replacement)).rows.length,1);
 });

 // Clone complete fixture evidence, keeping account/source/operation references
 // bound. These are saved local rows, never calls to a provider.
 const cloneSources=async n=>{
  await q("create temporary table fixture_sources as select n,('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid screening_id,gen_random_uuid() reservation_id,'owners:'||$1::text||':00000000-0000-0000-0000-'||lpad(n::text,12,'0') operation_key from generate_series(1,$2::int) n",[account,n]);
  await q("insert into icash_screening_jobs select cloned.* from fixture_sources f cross join icash_screening_jobs s cross join lateral jsonb_populate_record(null::icash_screening_jobs,to_jsonb(s)||jsonb_build_object('id',f.screening_id,'event_key','LOCAL candidate proof '||f.n)) cloned where s.id=$1",[screening]);
  await q("insert into icash_credit_reservations select cloned.* from fixture_sources f cross join icash_credit_reservations r cross join lateral jsonb_populate_record(null::icash_credit_reservations,to_jsonb(r)||jsonb_build_object('id',f.reservation_id,'operation_key',f.operation_key)) cloned where r.operation_key=$1",[operation]);
  await q("insert into icash_operation_spend select cloned.* from fixture_sources f cross join icash_operation_spend o cross join lateral jsonb_populate_record(null::icash_operation_spend,to_jsonb(o)||jsonb_build_object('operation_key',f.operation_key,'credit_reservation_id',f.reservation_id)) cloned where o.operation_key=$1",[operation]);
  await q("insert into icash_cost_observations select cloned.* from fixture_sources f cross join icash_cost_observations c cross join lateral jsonb_populate_record(null::icash_cost_observations,to_jsonb(c)||jsonb_build_object('event_key',f.operation_key||substr(c.event_key,length($1)+1),'source_ref','dealmachine:owners:'||f.operation_key||substr(c.event_key,length($1)+1))) cloned where c.provider='dealmachine' and c.event_key in ($1,$1||':people',$1||':properties',$1||':deduplicated')",[operation]);
  await q("insert into icash_owner_contacts select cloned.* from fixture_sources f cross join icash_owner_contacts oc cross join lateral jsonb_populate_record(null::icash_owner_contacts,to_jsonb(oc)||jsonb_build_object('screening_id',f.screening_id,'operation_key',f.operation_key)) cloned where oc.screening_id=$1",[screening]);
 };
 await isolated(async()=>{
  await cloneSources(205);
  await q("update icash_cost_observations c set amount=2 from fixture_sources f where f.n<=105 and c.event_key=f.operation_key");
  const expected=(await select(original)).rows;
  assert.equal(expected.length,100,'more than 100 invalid proofs cannot starve the remaining valid work');
  assert.deepEqual((await select(replacement)).rows,expected,'full proof runs before the unchanged final order and LIMIT');
  assert.deepEqual((await select(replacement,null)).rows,(await select(original,null)).rows);
 });

 let oldCalls,newCalls;
 await isolated(async()=>{
  // One actual ingestion exercises the production writer, not a stub.
  const result=await rpc('icash_ingest_dealmachine_dnc_observations',{p_account:account,p_user:user,p_screening:screening});
  assert.equal(result.observations,1);
  assert.equal((await select(original)).rows.length,0);assert.equal((await select(replacement)).rows.length,0);
  await cloneSources(200);
  await q("insert into icash_dealmachine_dnc_rejections(screening_id,account_id,operation_key,source_hash,source_recorded_at,rejected_at,reason) select f.screening_id,$1,f.operation_key,repeat('a',64),oc.created_at,now(),'LOCAL quarantined saved source' from fixture_sources f join icash_owner_contacts oc on oc.screening_id=f.screening_id",[account]);
  // Count the real helper only inside this rolled-back test. Production helper
  // volatility/body and all final writer checks remain untouched.
  await pg.exec("create sequence fixture_request_calls; alter function icash_dealmachine_request_started_at(jsonb) rename to fixture_request_started_at; create function icash_dealmachine_request_started_at(p_result jsonb) returns timestamptz language plpgsql volatile as $$begin perform nextval('public.fixture_request_calls');return public.fixture_request_started_at(p_result);end$$;");
  await q("select setval('fixture_request_calls',1,false)");assert.equal((await select(original)).rows.length,0);
  oldCalls=Number((await one('select case when is_called then last_value else 0 end n from fixture_request_calls')).n);
  await q("select setval('fixture_request_calls',1,false)");assert.equal((await select(replacement)).rows.length,0);
  newCalls=Number((await one('select case when is_called then last_value else 0 end n from fixture_request_calls')).n);
  assert(oldCalls>0);assert.equal(newCalls,0,'processed or quarantined sources skip all timestamp proof work');
 });

 const wallet=(await one('select to_jsonb(w) value from icash_wallets w where account_id=$1',[account])).value;
 const costs=(await one('select count(*) n from icash_operation_spend')).n;
 await pg.exec(sql);
 assert.equal(await definition('icash_prepare_operational_contacts(uuid)'),before.replace(original,()=>replacement),'only the SELECT changes');
 assert.equal(await definition('icash_ingest_dealmachine_dnc_observations(uuid,uuid,uuid)'),writer,'final locked writer and proof checks unchanged');
 assert.equal(await definition('icash_project_operational_sms_contacts(uuid)'),projector);
 assert.equal(await definition('icash_prepare_operational_contacts_before_dm_observations(uuid)'),inner);
 assert.equal((replacement.match(/\blimit\b/gi)??[]).length,1,'no early candidate cap');
 for(const role of ['anon','authenticated']) assert.equal((await one("select has_function_privilege($1,'icash_prepare_operational_contacts(uuid)','execute') allowed",[role])).allowed,false);
 assert.equal((await one("select has_function_privilege('service_role','icash_prepare_operational_contacts(uuid)','execute') allowed")).allowed,true);
 assert.equal(await rpc('icash_prepare_operational_contacts',{p_account:account}),2);
 assert.equal(await rpc('icash_prepare_operational_contacts',{p_account:account}),0,'ingested records remain idempotent');
 assert.deepEqual((await one('select to_jsonb(w) value from icash_wallets w where account_id=$1',[account])).value,wallet);
 assert.equal((await one('select count(*) n from icash_operation_spend')).n,costs);
 await assert.rejects(pg.exec(sql),/DealMachine ingestion candidate prerequisite changed/);await pg.exec('rollback');
 console.log('DNC ingestion candidate fence: '+cases.length+' eligibility/proof exclusions, exact account/global ordering, >100 invalid proof starvation protection, real ingestion/idempotency, preserved writer/projection/wallet/private ACL; processed proof calls '+oldCalls+' -> '+newCalls+'.');
}catch(error){console.error(error.message,error.where??'');process.exitCode=1;}finally{await pg.close();}

