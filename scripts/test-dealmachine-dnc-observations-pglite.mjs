// SIMULATION ONLY. All source rows and policy changes below are in-memory fixtures.
// No DealMachine requests, production connection, paid lookup, or real source activation.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createOperationalContactFixture} from '../tests/helpers/operational-contact-fixture.mjs';
const {pg,q,rpc,one,isolated,account,user,other,otherUser,phone,sms,owners,screening,source,dnc}=await createOperationalContactFixture(process.argv[2]);
const role=async(name,action)=>{await q('set role '+name);try{return await action();}finally{try{await q('reset role');}catch{/* The surrounding isolated transaction rolls a failed role change back. */}}};
try{
 // Replace only synthetic fixture timestamps with a consistent genuine-style
 // saved-response trail: request start -> reservation -> dispatch -> receipt -> save.
 await q('delete from icash_dnc_verification_receipts where id=$1',[dnc]);
 await q('delete from icash_dnc_verification_sources where id=$1',[source]);
 const operation='owners:'+account+':'+screening;
 const timestamps=async(hours=1)=>{
  await q("update icash_owner_contacts set result=jsonb_set(result,'{fetchedAt}',to_jsonb(to_char(now()-make_interval(hours=>$2),'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))),created_at=now()-make_interval(hours=>$2)+interval '4 minutes' where screening_id=$1",[screening,hours]);
  await q("update icash_operation_spend set created_at=now()-make_interval(hours=>$2)+interval '1 minute',dispatched_at=now()-make_interval(hours=>$2)+interval '2 minutes',settled_at=now()-make_interval(hours=>$2)+interval '3 minutes' where operation_key=$1",[operation,hours]);
  for(const [field,amount] of [['used',1],['people',1],['properties',0],['deduplicated',0]]){const key=operation+(field==='used'?'':':'+field);await q("insert into icash_cost_observations(provider,event_key,source_ref,amount,units,observed_at) values('dealmachine',$1,'dealmachine:owners:'||$1,$3,'provider_credits',now()-make_interval(hours=>$2)+interval '3 minutes') on conflict(provider,event_key) do update set observed_at=excluded.observed_at",[key,hours,amount]);}
 };
 await timestamps();
 await pg.exec(readFileSync(new URL('../config/dealmachine-dnc-observations.sql',import.meta.url),'utf8'));
 const policy=await one("select * from icash_dnc_verification_sources where observation_provider='dealmachine'");
 assert.equal(policy.enabled,false);assert.equal(policy.max_observation_age_seconds,86400);
 assert(new Date(policy.expires_at)<new Date());
 const cloneSource=async(a,u,index,status=false,targetPhone=phone)=>{
  await q("insert into icash_customer_identities(account_id,first_name,last_name,company_name,voice_id,voice_name) values($1,'SIMULATION','Owner','SIMULATION source business','fixture_voice','Fixture') on conflict(account_id) do nothing",[a]);
  await q("insert into icash_discovery_configs(account_id,zip,rate_id,property_credit_micros,data_rights_until,seller_cost_reserve_cents,contacts_enabled) values($1,'75201',$2,1000,now()+interval '1 day',0,true) on conflict(account_id) do nothing",[a,owners]);
  const prop='prop_'+index,started=new Date(Date.now()-3600000).toISOString();
  const screen=(await one("insert into icash_screening_jobs(account_id,event_key,snapshot,state,result,completed_at) values($1,$2,$3,'complete','{\"financialCheck\":{\"status\":\"eligible\"}}',now()) returning id",[a,'SIMULATION source '+index,{propertyId:prop}])).id;
  const key='owners:'+a+':'+screen;
  const reservation=(await one("insert into icash_credit_reservations(account_id,operation_key,amount_cents,status,settled_cents) values($1,$2,100,'settled',100) returning id",[a,key])).id;
  await q("insert into icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until,charged_cents,actual_micros,created_at,dispatched_at,settled_at) values($1,$2,$3,$4,100,1000,'settled',now()+interval '1 day',100,1000,$5::timestamptz+interval '1 minute',$5::timestamptz+interval '2 minutes',$5::timestamptz+interval '3 minutes')",[key,a,owners,reservation,started]);
  const result={propertyId:prop,creditsUsed:1,peopleCredits:1,providerCredits:{used:1,people:1,properties:0,deduplicated:0},requestedPersonIds:['per_fixture'],outreachAuthorized:false,fetchedAt:started,contacts:[{personId:'per_fixture',likelyOwner:true,ownershipVerified:false,outreachAuthorized:false,phones:[{number:targetPhone,doNotCall:status,permission:'unverified'}]}]};
  await q("insert into icash_owner_contacts(account_id,screening_id,operation_key,result,created_at) values($1,$2,$3,$4,$5::timestamptz+interval '4 minutes')",[a,screen,key,result,started]);
  for(const [field,amount] of [['used',1],['people',1],['properties',0],['deduplicated',0]]){const observation=key+(field==='used'?'':':'+field);await q("insert into icash_cost_observations(provider,event_key,source_ref,amount,units,observed_at) values('dealmachine',$1,'dealmachine:owners:'||$1,$3,'provider_credits',$2::timestamptz+interval '3 minutes')",[observation,started,amount]);}
  return screen;
 };
 const ingest=(a=account,u=user,s=screening)=>role('service_role',()=>rpc('icash_ingest_dealmachine_dnc_observations',{p_account:a,p_user:u,p_screening:s}));
 const prepare=a=>role('service_role',()=>rpc('icash_prepare_operational_contacts',{p_account:a}));
 const observations=()=>q("select * from icash_dnc_verification_receipts where evidence_kind='national_provider_observation' order by id");
 assert.equal((await ingest()).status,'source_policy_disabled');
 assert.equal(await prepare(account),0,'Disabled policy is a no-op for saved observations');
 assert.equal((await observations()).rows.length,0);
 assert.equal((await one('select count(*)::int n from icash_dealmachine_dnc_ingestions')).n,0);
 for(const table of ['icash_dnc_verification_sources','icash_dnc_verification_receipts','icash_dealmachine_dnc_ingestions','icash_dealmachine_dnc_rejections']){
  assert.equal((await one("select has_table_privilege('service_role',$1,'INSERT') or has_table_privilege('service_role',$1,'UPDATE') or has_table_privilege('service_role',$1,'DELETE') allowed",[table])).allowed,false,table+' has no service evidence-write privilege');
 }
 for(const r of ['anon','authenticated'])await assert.rejects(role(r,()=>rpc('icash_ingest_dealmachine_dnc_observations',{p_account:account,p_user:user,p_screening:screening})),/permission denied/i);
 await assert.rejects(role('service_role',()=>q("update icash_dnc_verification_sources set enabled=true where id=$1",[policy.id])),/permission denied/i);
 // Synthetic activation only. The actual migration never enables a source.
 await q("update icash_dnc_verification_sources set enabled=true,expires_at=now()+interval '1 day' where id=$1",[policy.id]);
 await assert.rejects(ingest(account,otherUser,screening),/ownership mismatch/);
 await assert.rejects(ingest(other,otherUser,screening),/Owned saved owner result/);
 await assert.rejects(ingest(account,user,randomUUID()),/Owned saved owner result/);
 for(const status of [true,null,'false','unknown'])await isolated(async()=>{
  await q("update icash_owner_contacts set result=jsonb_set(result,'{contacts,0,phones,0,doNotCall}',$2::jsonb) where screening_id=$1",[screening,JSON.stringify(status)]);
  assert.equal((await ingest()).status,'no_explicit_clear_status',String(status));
  assert.equal((await observations()).rows.length,0);
 });
 await isolated(async()=>{await q("update icash_owner_contacts set result=result#-'{contacts,0,phones,0,doNotCall}' where screening_id=$1",[screening]);assert.equal((await ingest()).observations,0,'Missing flag is not false');});
 await isolated(async()=>{await q("update icash_owner_contacts set result=jsonb_set(result,'{contacts,0,phones}',(result#>'{contacts,0,phones}')||jsonb_build_array(jsonb_build_object('number',$2::text,'doNotCall',true))) where screening_id=$1",[screening,phone]);assert.equal((await ingest()).observations,0,'Conflicting negative overrides a false duplicate');});
 for(const [sql,args,reason] of [
  ["update icash_operation_spend set state='reserved' where operation_key=$1",[operation],/provider-operation/],
  ['update icash_operation_spend set dispatched_at=null where operation_key=$1',[operation],/provider-operation/],
  ['update icash_operation_spend set rate_id=$2 where operation_key=$1',[operation,sms],/provider-operation/],
  ['update icash_operation_spend set account_id=$2 where operation_key=$1',[operation,other],/provider-operation/],
  ["update icash_cost_observations set provider='other_provider' where event_key=$1",[operation],/provider-credit/],
  ["update icash_cost_observations set source_ref='SIMULATION unrelated provider receipt' where event_key=$1",[operation],/provider-credit/],
  ["update icash_cost_observations set amount=2 where event_key=$1",[operation],/provider-credit/],
  ["update icash_owner_contacts set result=jsonb_set(result,'{fetchedAt}',to_jsonb('2099-01-01T00:00:00Z'::text)) where screening_id=$1",[screening],/timestamp/],
  ["update icash_owner_contacts set result=jsonb_set(result,'{fetchedAt}',to_jsonb('not a timestamp'::text)) where screening_id=$1",[screening],/timestamp/],
  ["update icash_owner_contacts set result=jsonb_set(result,'{propertyId}',to_jsonb('prop_9999'::text)) where screening_id=$1",[screening],/shape/],
 ])await isolated(async()=>{await q(sql,args);const rejected=await ingest();assert.equal(rejected.status,'source_rejected');assert.match(rejected.reason,reason);assert.equal((await observations()).rows.length,0);});
 await isolated(async()=>{await timestamps(48);assert.equal((await ingest()).status,'source_too_old');assert.equal((await observations()).rows.length,0);assert.equal((await ingest()).status,'already_recorded','An aged replay never refreshes its timestamp');});
 await isolated(async()=>{await q("update icash_owner_contacts set result=jsonb_set(result,'{propertyId}',to_jsonb('prop_a1b2c3'::text)) where screening_id=$1",[screening]);await q("update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{propertyId}',to_jsonb('prop_a1b2c3'::text)) where id=$1",[screening]);assert.equal((await ingest()).observations,1,'Authentic alphanumeric provider IDs remain supported');});
 for(const path of ['peopleCredits','providerCredits,people','providerCredits,properties','providerCredits,deduplicated'])await isolated(async()=>{await q("update icash_owner_contacts set result=jsonb_set(result,$2::text[],'99') where screening_id=$1",[screening,'{'+path+'}']);assert.equal((await ingest()).status,'source_rejected','Invalid normalized count '+path);});
 await isolated(async()=>{await q("delete from icash_cost_observations where event_key=$1",[operation+':people']);assert.equal((await ingest()).status,'source_rejected','Partial provider-credit trail cannot be recast as complete parsed evidence');});
 const before=await one('select * from icash_owner_contacts where screening_id=$1',[screening]);
 const result=await ingest();assert.equal(result.status,'observations_recorded');assert.equal(result.observations,1);
 const receipt=(await observations()).rows[0];
 assert.equal(receipt.evidence_kind,'national_provider_observation');assert.equal(receipt.clear,true);
 assert.equal(receipt.checked_at.toISOString(),new Date(before.result.fetchedAt).toISOString());
 assert.equal(receipt.observation_provenance.providerCheckedAt,null);assert.equal(receipt.observation_provenance.registryUpdatedAt,null);
 assert.equal(receipt.observation_provenance.scope,'national_only');assert.equal(receipt.observation_provenance.stateClearance,'not_established');
 assert.equal(receipt.observation_provenance.consentVerification,'not_performed');
 assert.equal(new Date(receipt.observation_provenance.sourceRecordedAt).toISOString(),new Date(before.created_at).toISOString());
 assert.deepEqual(await one('select * from icash_owner_contacts where screening_id=$1',[screening]),before,'Source flags and original timestamp are never rewritten');
 assert.equal((await ingest()).status,'already_recorded');assert.deepEqual((await observations()).rows[0],receipt,'Retry preserves original checked/recorded/expiry timestamps');
 await isolated(async()=>{await q('update icash_dnc_verification_sources set max_observation_age_seconds=172800 where id=$1',[policy.id]);assert.equal((await ingest()).status,'already_recorded');assert.deepEqual((await observations()).rows[0],receipt,'A wider policy never retroactively refreshes a saved receipt');});
 await isolated(async()=>{await assert.rejects(q("update icash_owner_contacts set result=jsonb_set(result,'{contacts,0,phones,0,doNotCall}','true') where screening_id=$1",[screening]),/immutable/);});
 await isolated(async()=>{await assert.rejects(q('update icash_dnc_verification_receipts set checked_at=now() where id=$1',[receipt.id]),/immutable/);});
 await isolated(async()=>{await q('update icash_cost_observations set amount=2 where event_key=$1',[operation]);assert.equal((await ingest()).status,'source_rejected');});
 assert.equal(await prepare(account),2,'Enabled adapter feeds core preparation without a customer click');
 const target=await one("select * from icash_operational_contacts where account_id=$1 and channel='sms'",[account]);
 assert.equal(target.dnc_receipt_id,receipt.id);
 assert.equal(await role('service_role',()=>rpc('icash_operational_contact_current',{p_account:account,p_contact:target.id,p_channel:'sms',p_check_hour:false})),true);
 await isolated(async()=>{await q('update icash_dnc_verification_sources set enabled=false where id=$1',[policy.id]);assert.equal(await role('service_role',()=>rpc('icash_operational_contact_current',{p_account:account,p_contact:target.id,p_channel:'sms',p_check_hour:false})),false);});
 await isolated(async()=>{await q('update icash_cost_observations set amount=2 where event_key=$1',[operation]);assert.equal(await role('service_role',()=>rpc('icash_operational_contact_current',{p_account:account,p_contact:target.id,p_channel:'sms',p_check_hour:false})),false,'Changed provider trail invalidates final eligibility');});
 for(const [sql,args] of [
  ['update icash_operation_spend set rate_id=$2 where operation_key=$1',[operation,sms]],
  ['update icash_operation_spend set account_id=$2 where operation_key=$1',[operation,other]],
  ["update icash_operation_spend set created_at=created_at-interval '1 second' where operation_key=$1",[operation]],
  ["update icash_operation_spend set dispatched_at=dispatched_at+interval '1 second' where operation_key=$1",[operation]],
  ["update icash_credit_reservations set account_id=$2 where operation_key=$1",[operation,other]],
  ["update icash_credit_reservations set operation_key='SIMULATION wrong binding' where operation_key=$1",[operation]],
  ["update icash_cost_observations set amount=2 where event_key=$1",[operation+':people']],
 ])await isolated(async()=>{await q(sql,args);assert.equal(await role('service_role',()=>rpc('icash_operational_contact_current',{p_account:account,p_contact:target.id,p_channel:'sms',p_check_hour:false})),false,sql);});
 await isolated(async()=>{await q("update icash_operation_spend set settled_at=now(),actual_micros=1001 where operation_key=$1",[operation]);await q('update icash_cost_observations set reconciled=true where event_key=$1',[operation]);assert.equal(await role('service_role',()=>rpc('icash_operational_contact_current',{p_account:account,p_contact:target.id,p_channel:'sms',p_check_hour:false})),true,'Legitimate later settlement/reconciliation is outside provenance fingerprints');});
 for(const key of ['provider','scope','accountId','screeningId','providerOperationHash','providerCheckedAt','registryUpdatedAt','stateClearance','requestStartedAt'])await isolated(async()=>{await assert.rejects(q("insert into icash_dnc_verification_receipts(source_id,phone,contact_key,provider_reference,receipt_hash,checked_at,expires_at,clear,evidence_kind,observation_provenance,observation_recorded_at) select source_id,phone,contact_key,'SIMULATION missing provenance '||$2,receipt_hash,checked_at,expires_at,clear,evidence_kind,observation_provenance-$2,observation_recorded_at from icash_dnc_verification_receipts where id=$1",[receipt.id,key]),/constraint/);});
 await isolated(async()=>{await assert.rejects(q("insert into icash_dnc_verification_receipts(source_id,phone,contact_key,provider_reference,receipt_hash,checked_at,expires_at,clear,evidence_kind,observation_provenance,observation_recorded_at) select source_id,phone,contact_key,'SIMULATION empty provenance',receipt_hash,checked_at,expires_at,clear,evidence_kind,'{}',observation_recorded_at from icash_dnc_verification_receipts where id=$1",[receipt.id]),/constraint/);});
 // A globally identical phone must never reuse another tenant's typed receipt.
 const foreignScreen=await cloneSource(other,otherUser,2002);
 assert.equal(await role('service_role',()=>rpc('icash_prepare_operational_contacts_before_dm_observations',{p_account:other})),0,'Foreign receipt is filtered before core LIMIT/INSERT');
 assert.equal((await one('select count(*)::int n from icash_operational_contacts where account_id=$1',[other])).n,0);
 assert.equal((await ingest(other,otherUser,foreignScreen)).observations,1);
 assert.equal(await prepare(other),2);
 const foreignTarget=await one("select * from icash_operational_contacts where account_id=$1 and channel='sms'",[other]);
 assert.notEqual(foreignTarget.dnc_receipt_id,receipt.id);
 await isolated(async()=>{
  const spoof=(await one("insert into icash_operational_contacts(account_id,screening_id,channel,phone,contact_key,timezone,timezone_basis,local_start_hour,local_end_hour,owner_user_id,sending_principal,source_hash,dnc_receipt_id,eligibility_until) select account_id,screening_id,channel,phone,contact_key,timezone,timezone_basis,local_start_hour,local_end_hour,owner_user_id,sending_principal,source_hash,$2,eligibility_until from icash_operational_contacts where id=$1 returning id",[foreignTarget.id,receipt.id])).id;
  assert.equal(await role('service_role',()=>rpc('icash_operational_contact_current',{p_account:other,p_contact:spoof,p_channel:'sms',p_check_hour:false})),false,'Final lock boundary also rejects a privileged cross-tenant receipt spoof');
 });
 // Previously ingested sources must be filtered BEFORE the bounded batch limit.
 await isolated(async()=>{
  for(let i=0;i<101;i++)await cloneSource(account,user,3000+i,true);
  const beforeCount=(await one('select count(*)::int n from icash_dealmachine_dnc_ingestions')).n;
  await prepare(account);
  assert.equal((await one('select count(*)::int n from icash_dealmachine_dnc_ingestions')).n-beforeCount,100);
  await prepare(account);
  assert.equal((await one('select count(*)::int n from icash_dealmachine_dnc_ingestions')).n-beforeCount,101,'Processed front-of-queue records cannot starve the next saved result');
 });
 await isolated(async()=>{
  for(let i=0;i<101;i++)await cloneSource(account,user,(4000+i)+'_invalid',false);
  const beforeCount=(await one('select count(*)::int n from icash_dealmachine_dnc_rejections')).n;
  await prepare(account);
  assert.equal((await one('select count(*)::int n from icash_dealmachine_dnc_rejections')).n-beforeCount,100);
  await prepare(account);
  assert.equal((await one('select count(*)::int n from icash_dealmachine_dnc_rejections')).n-beforeCount,101,'Quarantined rejected front-of-queue sources cannot starve later records');
 });
 await isolated(async()=>{
  const stale=[];for(let i=0;i<100;i++)stale.push(await cloneSource(account,user,5000+i,false));
  await prepare(account);
  for(const screen of stale)await q('update icash_operation_spend set rate_id=$2 where operation_key=$1',['owners:'+account+':'+screen,sms]);
  const currentScreen=await cloneSource(account,user,6000,false,'+12145550999');await prepare(account);
  await q("insert into icash_deal_files(account_id,screening_id,stage,terms) values($1,$2,'draft','{\"address\":\"6000 Main Street\",\"practice\":false,\"state\":\"TX\"}')",[account,currentScreen]);
  const currentTarget=await one("select id from icash_operational_contacts where account_id=$1 and screening_id=$2 and channel='sms'",[account,currentScreen]);
  assert.equal(await role('service_role',()=>rpc('icash_operational_contact_current',{p_account:account,p_contact:currentTarget.id,p_channel:'sms',p_check_hour:false})),true);
  await role('service_role',()=>rpc('icash_project_operational_sms_contacts',{p_account:account}));
  assert.equal((await one('select count(*)::int n from icash_text_threads where operational_contact_id=$1',[currentTarget.id])).n,1,'100 stale existing targets cannot starve a later SMS projection');
  await q('delete from icash_outreach_campaigns where account_id=$1',[account]);
  const rate=(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) select 'seller_call','SIMULATION DNC queue liveness',charge_cents,costs_micros,evidence_ref,verified_at,expires_at,true,600 from icash_operation_rates where id=$1 returning id",[owners])).id;
  await q("insert into icash_voice_configs(account_id,enabled,agent_id,phone_number_id,agent_config_hash,reviewed_until,seller_rate_id,max_duration_seconds,required_tool_ids) values($1,true,'agent_simulation','simulation-number',repeat('b',64),now()+interval '1 day',$2,600,array['callback','handoff'])",[account,rate]);
  await role('service_role',()=>rpc('icash_queue_voice_jobs',{}));
  assert.equal((await one("select count(*)::int n from icash_voice_jobs j join icash_operational_contacts c on c.id=j.operational_contact_id where j.account_id=$1 and c.screening_id=$2",[account,currentScreen])).n,1,'100 stale existing targets cannot starve a later voice job');
 });
 // Operational provider observations are never independent review/consent evidence.
 const legacyReview=async(receiptId)=>{
  const reviewer=randomUUID();await q('insert into auth.users(id,email) values($1,$2)',[reviewer,'legacy-'+reviewer+'@example.invalid']);
  await q("insert into icash_trusted_operators(user_id,scopes,provisioned_by,expires_at) values($1,array['authority_review'],'SIMULATION legacy reviewer',now()+interval '1 day')",[reviewer]);
  const market=(await one("insert into icash_authority_market_reviews(account_id,screening_id,state_code,kind,channel,source_reference,reviewed_by,reviewed_at,expires_at) values($1,$2,'TX','contact_permission','sms','SIMULATION legacy market evidence','Fixture reviewer',now()-interval '1 minute',now()+interval '1 day') returning id",[account,screening])).id;
  const payload={kind:'contact_permission',channel:'sms',screeningId:screening,party:'seller',buyerId:null,phone,timezone:'UTC',localStartHour:9,localEndHour:20,stateCode:'TX',purpose:'SIMULATION legacy property contact',sourceName:'SIMULATION independent evidence',evidenceReference:'SIMULATION actual distinct consent reference',evidenceObservedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()};
  const request=await rpc('icash_submit_authority_review',{p_account:account,p_user:user,p_key:randomUUID(),p_payload:payload});
  const verification={marketReviewId:market,reviewReference:'SIMULATION independent review',reviewedAt:new Date(Date.now()-60000).toISOString(),validUntil:payload.expiresAt,consentReference:'SIMULATION explicit recipient SMS consent',consentObservedAt:payload.evidenceObservedAt,dncReceiptId:receiptId,smsSender:'+14243948384',smsConsentConfirmed:true,smsConsentBusiness:'SIMULATION business',smsPriorContactReference:'SIMULATION prior direct business contact'};
  return {request,verification,reviewer,approve:()=>rpc('icash_decide_authority_review',{p_reviewer:reviewer,p_request:request.id,p_decision:'approved',p_note:'SIMULATION complete independent review',p_verification:verification})};
 };
 await isolated(async()=>{const legacy=await legacyReview(receipt.id);await assert.rejects(legacy.approve(),/External DNC verification required/);});
 await isolated(async()=>{
  const independentSource=(await one("insert into icash_dnc_verification_sources(name,source_reference,enabled,expires_at) values('SIMULATION independent DNC','SIMULATION independent receipt source',true,now()+interval '1 day') returning id")).id;
  const independent=(await one("insert into icash_dnc_verification_receipts(source_id,phone,contact_key,provider_reference,receipt_hash,checked_at,expires_at,clear) select $2,phone,contact_key,'SIMULATION independent DNC receipt',receipt_hash,checked_at,expires_at,true from icash_dnc_verification_receipts where id=$1 returning id",[receipt.id,independentSource])).id;
  const legacy=await legacyReview(independent);await legacy.approve();
  const thread=await one('select id from icash_text_threads where sms_review_request_id=$1',[legacy.request.id]);
  assert.equal(await rpc('icash_sms_thread_review_before_operational',{p_account:account,p_thread:thread.id,p_check_hour:false}),true,'Existing independently reviewed legacy path is preserved');
  await q("update icash_authority_review_requests set verification=jsonb_set(verification,'{dncReceiptId}',to_jsonb($2::text)) where id=$1",[legacy.request.id,receipt.id]);
  assert.equal(await rpc('icash_sms_thread_review_before_operational',{p_account:account,p_thread:thread.id,p_check_hour:false}),false,'Legacy current-review consumer rejects a substituted operational observation');
 });
 for(const table of ['icash_contact_permissions','icash_authority_review_requests','icash_authority_market_reviews'])assert.equal((await one('select count(*)::int n from '+table)).n,0,'No synthetic consent/review records');
 console.log('Saved DealMachine observations: disabled default; service-only narrow derivation; strict false-only flags; tenant/provider-operation/source/timestamp checks; immutable no-freshening retries; original-time aging; and core preparation/final eligibility passed. No network or production writes.');
}finally{await pg.close();}
