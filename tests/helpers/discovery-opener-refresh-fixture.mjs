// Synthetic original discovery opener and genuine production ancestry functions.
// No provider transport; financially settled new receipt fixtures do not test billing admission.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createSellerRevalidationFixture} from './seller-contact-revalidation-fixture.mjs';
import {databaseAdapter} from './simulated-journey-services.mjs';
import {processDiscoveryOpenerRefresh} from '../../lib/discovery-opener-refresh.ts';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export async function createDiscoveryOpenerRefreshFixture(modulePath,{skipRenewal=false}={}){
 const f=await createSellerRevalidationFixture(modulePath);
 const {pg,q,rpc,one,account,screening,thread,gap,phone}=f;
 try{
 // Convert synthetic reminder history to a never-dispatched original discovery opener.
 await q('delete from icash_seller_gaps where id=$1',[gap]);
 await q('delete from icash_text_messages where id=$1',[f.message]);
 await q('update icash_screening_jobs set completed_at=clock_timestamp() where id=$1',[screening]);
 const freshContact=f.fresh;
 await q('update icash_text_threads t set operational_contact_id=c.id,eligibility_until=c.eligibility_until,dnc_checked_at=d.checked_at from icash_operational_contacts c join icash_dnc_verification_receipts d on d.id=c.dnc_receipt_id where t.id=$1 and c.id=$2',[thread,freshContact]);
 const assignment=await rpc('icash_assign_seller_opener',{p_account:account,p_thread:thread});
 assert(assignment,'real assignment binds synthetic original draft');
 const message=(await one("insert into icash_text_messages(account_id,thread_id,direction,body,state,request_key) values($1,$2,'outgoing',$3,'ready',$2) returning id",[account,thread,assignment.body])).id;
 const op='owners:'+account+':'+screening;
 await q(`update icash_owner_contacts set result=jsonb_set(result,'{fetchedAt}',to_jsonb(to_char(now()-interval '4 days 1 hour','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),created_at=now()-interval '4 days 56 minutes' where screening_id=$1`,[screening]);
 await q(`update icash_operation_spend set created_at=now()-interval '4 days 59 minutes',dispatched_at=now()-interval '4 days 58 minutes' where operation_key=$1`,[op]);
 for(const [field,amount] of [['used',1],['people',1],['properties',0],['deduplicated',0]]){
  const key=op+(field==='used'?'':':'+field);
  await q("insert into icash_cost_observations(provider,event_key,source_ref,amount,units,observed_at) values('dealmachine',$1,'dealmachine:owners:'||$1,$2,'provider_credits',now()-interval '4 days 57 minutes')",[key,amount]);
 }
 const national=read('config/dealmachine-dnc-observations.sql');
 // Later synthetic voice projection is unrelated to this SMS test. Load all
 // actual national receipt/ancestry functions before the old queue patch.
 await pg.exec(national.slice(0,national.indexOf('-- Existing typed targets can become ineligible'))+'commit;');
 const src=(await one("update icash_dnc_verification_sources set enabled=true,expires_at=now()+interval '1 day' where observation_provider='dealmachine' returning id")).id;
 // Reconstruct a past authentic ingestion, preserving its original 24h expiry.
 const source=await one(`select oc.*,encode(sha256(convert_to(oc.result::text,'UTF8')),'hex') hash,
 public.icash_dealmachine_operation_hash(o,r) operation_hash,public.icash_dealmachine_credit_manifest_hash(o.operation_key) cost_hash
 from icash_owner_contacts oc join icash_operation_spend o on o.operation_key=oc.operation_key join icash_credit_reservations r on r.id=o.credit_reservation_id where oc.screening_id=$1`,[screening]);
 const started=source.result.fetchedAt,expiry=new Date(new Date(started).valueOf()+86400000).toISOString();
 const provenance={provider:'dealmachine',scope:'national_only',sourceTable:'icash_owner_contacts',accountId:account,ownerUserId:f.user,screeningId:screening,operationKey:op,savedResultHash:source.hash,hashBasis:'canonical_saved_owner_result_jsonb',providerCostHash:source.cost_hash,providerOperationHash:source.operation_hash,requestStartedAt:started,sourceRecordedAt:source.created_at,ingestedAt:source.created_at,freshnessBasis:'saved_request_start_lower_bound',providerCheckedAt:null,registryUpdatedAt:null,stateClearance:'not_established',consentVerification:'not_performed',providerReferenceKind:'application_derived_idempotency_key',reportedDoNotCall:false,maxObservationAgeSeconds:86400};
 await q(`insert into icash_dealmachine_dnc_ingestions values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,1,0,'observations_recorded')`,[screening,account,f.user,op,src,source.hash,source.operation_hash,source.cost_hash,started,source.created_at,expiry]);
 const oldReceipt=(await one(`insert into icash_dnc_verification_receipts(source_id,phone,contact_key,provider_reference,receipt_hash,checked_at,expires_at,clear,contact_timezone,timezone_source_reference,evidence_kind,observation_provenance,observation_recorded_at)
 values($1,$2,encode(sha256(convert_to($2,'UTF8')),'hex'),'SIMULATION historical observation',$3,$4,$5,true,$6,'SIMULATION original timezone','national_provider_observation',$7,$8) returning id`,[src,phone,source.hash,started,expiry,f.timezone,provenance,source.created_at])).id;
 const old=(await one(`insert into icash_operational_contacts select (jsonb_populate_record(null::icash_operational_contacts,to_jsonb(c)||$2::jsonb)).* from icash_operational_contacts c where id=$1 returning id`,[f.oldContact,{id:randomUUID(),source_hash:source.hash,dnc_receipt_id:oldReceipt,eligibility_until:expiry}])).id;
 await q('update icash_text_threads set operational_contact_id=$2,dnc_checked_at=$3,eligibility_until=$4 where id=$1',[thread,old,started,expiry]);
 await pg.exec(`create schema icash_research_private;
 create function icash_research_private.take_reserved_request(text,uuid,text,uuid) returns boolean language plpgsql as $$begin if $1 in ('buyer_search','property_lookup','photo') then return true;end if;return false;end$$;
 create function icash_seller_recovery_private.reserve_contact_refresh(uuid,uuid,uuid,bigint) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_seller_recovery_private.settle_contact_refresh(text) returns boolean language sql as $$select true$$;
 create function public.icash_dealmachine_capacity_available(integer) returns boolean language sql as $$select true$$;`);
 // Fresh production predecessors (definitions only, no customer rows) ensure
 // guarded edits target the actual deployed chain, including batch ancestry.
 const live=JSON.parse(read('tests/fixtures/seller-contact-refresh-live-preflight.json'));
 await pg.exec(`create table icash_research_private.owner_batches(id uuid,account_id uuid,created_at timestamptz,state text,items jsonb,results jsonb,paid_receipt jsonb);
 create table icash_research_private.owner_batch_items(screening_id uuid,operation_key text,batch_id uuid);`);
 const batch=read('config/owner-batch-contact-sources.sql');
 await pg.exec(batch.slice(batch.indexOf('create function public.icash_dealmachine_owner_source_started_at'),batch.indexOf('revoke all on function public.icash_dealmachine_owner_source_started_at')));
 for(const name of ['public.icash_lock_operational_dnc(uuid,uuid)','public.icash_dealmachine_observation_immutable()','icash_research_private.take_reserved_request(text,uuid,text,uuid)']){
  const predecessor=live.functions.find(x=>x.name===name);assert(predecessor,name);await pg.exec(predecessor.definition);
 }
 assert.equal((await one("select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.icash_dnc_verification_receipts'::regclass and conname='icash_dnc_observation_receipt_shape'")).definition,live.constraint);
 await pg.exec(read('config/seller-contact-refresh.sql'));
 await pg.exec(read('config/seller-contact-refresh-workflow.sql'));
 await pg.exec(read('config/seller-contact-refresh-observability.sql'));

 await q('update icash_text_threads set operational_contact_id=$2,dnc_checked_at=$3,eligibility_until=$4 where id=$1',[thread,old,started,expiry]);
 await q("update icash_screening_jobs set completed_at=clock_timestamp()-interval '25 hours' where id=$1",[screening]);
 await q("insert into icash_automation_tickets(account_id,kind,opener_message_id,state,outcome,issue_attempts,created_at,expires_at) values($1,'seller_opener',$2,'held','message_held',1,now()-interval '5 minutes',now()-interval '3 minutes')",[account,message]);


 await pg.exec(read('config/dealmachine-list-quality-core.sql'));
 await pg.exec(`
 alter table icash_text_messages add column if not exists last_delivery_at timestamptz;
 alter table icash_seller_opener_assignments add column if not exists learning_context text;
 alter table icash_discovery_configs add column if not exists auto_enabled boolean not null default true;
 alter table icash_discovery_configs add column if not exists next_page integer not null default 1;
 alter table icash_discovery_configs add column if not exists exhausted boolean not null default false;
 alter table icash_discovery_configs add column if not exists inventory_refreshed_at timestamptz;
 create table if not exists icash_timezone_names(name text primary key);
 insert into icash_timezone_names select name from pg_timezone_names on conflict do nothing;
 `);
 const cash=read('config/seller-cash-questions.sql');
 await pg.exec(cash.slice(cash.indexOf('create function public.icash_seller_cash_question(p_variant'),cash.indexOf('create function public.icash_seller_cash_question_plan')));
 const street=read('config/conversation-street-address.sql');
 await pg.exec(street.slice(street.indexOf('create function public.icash_conversation_street'),street.indexOf('revoke all')));
 await q("insert into icash_seller_opener_variants(key,body) values('cash_sale_v6','Hi, have you considered a cash sale for {address}?') on conflict do nothing");
 const body=(await one("select icash_seller_cash_question('cash_sale_v6',icash_conversation_street(terms->>'address')) body from icash_deal_files where id=$1",[f.deal])).body;
 await q("update icash_seller_opener_assignments set learning_context='cash-question-v6',variant='cash_sale_v6',body=$2 where thread_id=$1",[thread,body]);
 await q('update icash_text_messages set body=$2 where id=$1',[message,body]);
 await q("update icash_screening_jobs set snapshot=snapshot||jsonb_build_object('fetchedAt',to_char(clock_timestamp()-interval '25 hours','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),'sellerCostReserveCents',0,'assignmentFeeCents',1000000,'raw',jsonb_build_object('data',jsonb_build_object('full_address','123 Main Street, TX 75201'))) where id=$1",[screening]);

 const membership=read('supabase/migrations/20261003223200_membership_and_prepaid_credits.sql');
 await pg.exec(membership.slice(0,membership.indexOf('create function public.icash_begin_membership'))+'commit;');
 const finalGuards=JSON.parse(read('tests/fixtures/discovery-opener-refresh-live-final-guards.json'));
 for(const row of finalGuards)if(!row.name.startsWith('icash_sms_thread_review_current'))await pg.exec(row.definition);

 const recording=read('config/required-call-recording.sql');
 await pg.exec(recording.slice(0,recording.indexOf('\n);')+4)+'commit;');

 const ownerBuyer=read('config/owner-buyer-delivery-test.sql');
 await pg.exec(ownerBuyer.slice(ownerBuyer.indexOf('create table public.icash_owner_buyer_tests'),ownerBuyer.indexOf('alter table public.icash_owner_buyer_tests')));
 for(const row of JSON.parse(read('tests/fixtures/discovery-opener-refresh-live-review-chain.json')))await pg.exec(row.definition);
 await pg.exec(finalGuards.find(row=>row.name.startsWith('icash_sms_thread_review_current')).definition);
 await q('update icash_discovery_configs set enabled=true,auto_enabled=true where account_id=$1',[account]);
 const predecessors=JSON.parse(read('tests/fixtures/discovery-opener-refresh-live-predecessors.json'));
 for(const row of predecessors)if(row.kind==='function')await pg.exec(row.definition);

 // Untouched final issuer and actual sender/hour gates. No transport is loaded.
 const filter=read('config/outbound-filter-experiments.sql');
 await pg.exec(filter.slice(filter.indexOf('create table public.icash_discovery_filter_pages'),filter.indexOf('alter table public.icash_discovery_filter_settings')));
 const targeting=read('config/dealmachine-targeting-experiments.sql');
 await pg.exec(targeting.slice(targeting.indexOf('create function public.icash_owner_targeting_pool('),targeting.indexOf('do $patch$',targeting.indexOf('create function public.icash_owner_targeting_pool('))));
 const sender=read('supabase/migrations/20261106190817_contiguity_sender_volume.sql');
 await pg.exec(sender.slice(sender.indexOf('create schema icash_sender_private'),sender.indexOf('create function icash_sender_private.room')));
 for(const row of JSON.parse(read('tests/fixtures/discovery-opener-refresh-live-november-room.json')))await pg.exec(row.definition);
 const hours=read('config/first-contact-hours.sql');
 await pg.exec('drop function public.icash_sms_outreach_window_current(uuid,uuid)');
 await pg.exec(hours.slice(hours.indexOf('create function public.icash_outreach_timezone'),hours.indexOf('-- Existing review')));
 const optimizedHours=read('config/outreach-predicate-performance.sql');
 await pg.exec(optimizedHours.slice(optimizedHours.indexOf('create or replace function public.icash_outreach_window_open'),optimizedHours.lastIndexOf('commit;')));
 for(const row of JSON.parse(read('tests/fixtures/discovery-opener-refresh-live-sender-guards.json')))await pg.exec(row.definition);
 for(const row of JSON.parse(read('tests/fixtures/discovery-opener-refresh-live-opener-recovery.json')))await pg.exec(row.definition);
 if(!skipRenewal){await pg.exec(read('config/discovery-opener-refresh.sql'));await pg.exec(read('config/discovery-opener-refresh-apply.sql'));}

 const enable=()=>q("update icash_discovery_refresh_private.policy set enabled=true,release_sha=repeat('a',40),review_reference='SIMULATION reviewed source release' where id=1");
 const hash=async(sql,args)=>(await one("select encode(sha256(convert_to(("+sql+")::text,'UTF8')),'hex') hash",args)).hash;
 const prepareRenewal=async()=>rpc('icash_prepare_discovery_opener_refresh',{p_message:message,p_expected_hash:await hash('icash_discovery_refresh_private.snapshot($1)',[message]),p_reference:'SIMULATION exact original discovery source'});
 const settledRequest=async(renewal,kind,raw)=>{
  const id=randomUUID(),operation='discovery-refresh:'+id;
  const rate=(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) select $2,$3,charge_cents,costs_micros,'SIMULATION settled new evidence',verified_at,expires_at,enabled from icash_operation_rates where id=$1 returning id",[f.owners,kind==='dnc'?'contact_revalidation':'property_search',randomUUID()])).id;
  const cr=(await one("insert into icash_credit_reservations(account_id,operation_key,amount_cents,status,settled_cents) values($1,$2,1,'settled',1) returning id",[account,operation])).id;
  await q("insert into icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until,charged_cents,actual_micros,settled_at) values($1,$2,$3,$4,1,1000,'settled',clock_timestamp()+interval '1 day',1,1000,clock_timestamp())",[operation,account,rate,cr]);
  const request=kind==='dnc'?{phones:[{number:phone}]}:{data:[{full_address:'123 Main Street, TX 75201'}],include_contacts:false};
  return one("insert into icash_discovery_refresh_private.requests(id,renewal_id,kind,operation_key,rate_id,unit_cost_micros,quota_request_id,requested_at,request,http_status,response,response_at,settled) values($1,$2,$3,$4,$5,1000,gen_random_uuid(),date_trunc('milliseconds',clock_timestamp()),$6,200,$7,clock_timestamp(),true) returning *",[id,renewal,kind,operation,rate,request,raw]);
 };
 const ready=async(existingId)=>{
  const id=existingId??await prepareRenewal();assert(id,'source-bound renewal prepared');
  const input={full_address:'123 Main Street, TX 75201'};
  const property={data:[{input,matched:true,dm_property_id:'prop_1001',full_address:input.full_address,city:'Dallas',state:'TX',zip:'75201',property_type:'Single Family',estimated_value:300000,estimated_repair_cost:30000,estimated_equity_amount:300000,total_estimated_loan_balance:0,living_area_sqft:1500}],credits:{used:1,properties:1,people:0,deduplicated:0},totals:{submitted:1,matched:1,unmatched:0}};
  const p=await settledRequest(id,'property',property);
  // Real worker consumes the immutable saved receipt and real financial model.
  // Missing key intentionally stops before any new claim/provider request.
  const resultBeforeDnc=await processDiscoveryOpenerRefresh(databaseAdapter(pg).db,undefined,id,async()=>{throw Error('Provider forbidden in fixture');});
  assert.equal(resultBeforeDnc.status,'renewal_not_configured','saved receipt passes actual worker qualification');
  assert.equal((await one('select new_result from icash_discovery_refresh_private.renewals where id=$1',[id])).new_result.financialCheck.status,'eligible');
  const dnc={data:[{input:{number:phone},matched:true,do_not_call:false}],totals:{submitted:1,matched:1,unmatched:0},credits:{used:1,people:1,deduplicated:0}};
  const d=await settledRequest(id,'dnc',dnc);
  const result=(await one('select icash_discovery_refresh_private.process($1) result',[id])).result;
  assert.equal(result.status,'ready_for_review');
  const review=await rpc('icash_review_discovery_opener_refresh',{p_id:id,p_hash:await hash('icash_discovery_refresh_private.review_snapshot($1)',[id]),p_note:'SIMULATION exact original plus fresh receipts'});
  assert(review,'fresh source-bound review');return {id,review,property:p,dnc:d};
 };
 const applyReview=review=>rpc('icash_apply_discovery_opener_refresh',{p_review:review});
 return {...f,message,oldContact:old,oldReceipt,nationalSource:src,enable,prepareRenewal,settledRequest,ready,applyReview};

 }catch(error){await pg.close();throw error;}
}
