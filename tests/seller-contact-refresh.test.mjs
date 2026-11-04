// Offline synthetic receipts only. Actual ancestry/contact/cadence/rebind SQL;
// billing has a separate fixture exercising the production money functions.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createSellerRevalidationFixture} from './helpers/seller-contact-revalidation-fixture.mjs';
import {processSellerContactRefresh} from '../lib/seller-contact-refresh.ts';
const require=createRequire(import.meta.url),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const f=await createSellerRevalidationFixture(require.resolve('@electric-sql/pglite'));
const {pg,q,rpc,one,isolated,account,screening,thread,gap,phone}=f;
let cases=0;
const components=['seller-contact-refresh','seller-contact-refresh-billing','seller-contact-refresh-workflow','seller-contact-refresh-observability'];
const assembled='-- Atomic prospective seller contact refresh; no historical replay.\nbegin;\n'+components.map(n=>'-- Source: config/'+n+'.sql\n'+read('config/'+n+'.sql').split('\n').filter(line=>line!=='begin;'&&line!=='commit;').join('\n').trimEnd()+'\n').join('')+'commit;\n';
assert.equal(read('supabase/migrations/20261104141713_seller_contact_refresh.sql'),assembled,'one atomic migration mirrors all four reviewed components');
try{
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
 for(const role of ['anon','authenticated'])for(const fn of ['icash_claim_seller_contact_refresh()','icash_record_seller_contact_refresh(uuid,uuid,integer,jsonb)','icash_finish_seller_contact_refresh(uuid)','icash_seller_contact_refresh_summary()'])assert.equal((await one("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,'public.'+fn])).allowed,false);
 assert.equal((await one("select has_function_privilege('service_role','public.icash_claim_seller_contact_refresh()','EXECUTE') allowed")).allowed,true);
 const body={data:[{input:{number:phone},matched:true,do_not_call:false}],totals:{submitted:1,matched:1,unmatched:0},credits:{used:1,people:1,deduplicated:0}};
 const create=async(raw=body,status=200)=>{
  const rate=(await one(`insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled)
   select 'contact_revalidation',$2,charge_cents,costs_micros,'SIMULATION paid phone request',verified_at,expires_at,enabled from icash_operation_rates where id=$1 returning id`,[f.owners,randomUUID()])).id;
  const key='dnc:'+gap;
  const cr=(await one(`insert into icash_credit_reservations(account_id,operation_key,amount_cents,status,settled_cents) values($1,$2,1,'settled',1) returning id`,[account,key])).id;
  await q(`insert into icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until,charged_cents,actual_micros,settled_at) values($1,$2,$3,$4,1,1000,'settled',now()+interval '1 day',1,1000,now())`,[key,account,rate,cr]);
  const row=await one(`insert into icash_seller_recovery_private.contact_refreshes(gap_id,account_id,original_contact_id,operation_key,rate_id,unit_cost_micros,request_id,requested_at,original_snapshot)
   values($1,$2,$3,$4,$5,1000,gen_random_uuid(),clock_timestamp(),public.icash_seller_contact_revalidation_snapshot($1,$3)) returning *`,[gap,account,old,key,rate]);
  assert.equal(await rpc('icash_record_seller_contact_refresh',{p_id:row.id,p_request:row.request_id,p_status:status,p_response:raw}),true);
  return row;
 };
 const scenario=async(name,fn)=>isolated(async()=>{try{await fn();cases++;}catch(e){throw new Error(name+': '+e.message,{cause:e});}});
 const current=()=>one('select icash_seller_recovery_private.contact_refresh_current($1,$2) ok',[gap,old]);
 const finish=id=>rpc('icash_finish_seller_contact_refresh',{p_id:id});
 await scenario('valid independent response rebinds actual SMS follow-up',async()=>{
  assert.equal((await current()).ok,true);
  const before=await one('select to_jsonb(d) d from icash_dnc_verification_receipts d where id=$1',[oldReceipt]);
  const row=await create();assert.deepEqual(await finish(row.id),{status:'revalidated'});
  const fresh=await one('select * from icash_seller_recovery_private.contact_refreshes where id=$1',[row.id]);
  assert.equal(await rpc('icash_operational_contact_current',{p_account:account,p_contact:fresh.successor_contact_id,p_channel:'sms',p_check_hour:false}),true);
  assert.equal(await rpc('icash_seller_recovery_current',{p_gap:gap}),true);
  assert.deepEqual(await finish(row.id),{status:'revalidated'});
  assert.deepEqual(await one('select to_jsonb(d) d from icash_dnc_verification_receipts d where id=$1',[oldReceipt]),before);
  assert.equal((await one('select count(*)::int n from icash_text_messages')).n,1,'No send or historical replay');
  await q("update icash_seller_gaps set state='needs_review',review_reason='contact_checks_expired' where id=$1",[gap]);
  assert.equal((await one('select icash_seller_recovery_private.contact_refresh_current($1,$2) ok',[gap,fresh.successor_contact_id])).ok,false,'Successor cannot enter another cold refresh cycle');
 });
 for(const [name,change] of [
  ['refresh policy disabled',()=>q('update icash_seller_recovery_private.contact_refresh_policy set enabled=false')],
  ['source identity changed',()=>q("update icash_dnc_verification_sources set source_reference='SIMULATION changed source' where id=$1",[src])],
  ['Pause',()=>q('update icash_accounts set bot_paused=true where id=$1',[account])],
  ['STOP',()=>q("insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[phone])],
  ['receipt revoked',()=>q('update icash_dnc_verification_receipts set revoked_at=now() where id=$1',[oldReceipt])],
  ['source disabled',()=>q('update icash_dnc_verification_sources set enabled=false where id=$1',[src])],
  ['source expired',()=>q("update icash_dnc_verification_sources set expires_at=now()-interval '1 second' where id=$1",[src])],
  ['customer data rights expired',()=>q("update icash_discovery_configs set data_rights_until=now()-interval '1 second' where account_id=$1",[account])],
  ['manual takeover',()=>q('update icash_text_threads set manual_only=true where id=$1',[thread])],
  ['ambiguous outgoing',()=>q("insert into icash_text_messages(account_id,thread_id,direction,body,state) values($1,$2,'outgoing','SIMULATION unknown','needs_review')",[account,thread])],
  ['new incoming',()=>q("insert into icash_text_messages(account_id,thread_id,direction,body,state,event_id) values($1,$2,'incoming','SIMULATION reply','received',$3)",[account,thread,randomUUID()])],
  ['cadence expired',()=>q("update icash_text_messages set created_at=now()-interval '6 days' where id=$1",[f.message])],
 ])await scenario(name+' during provider request keeps hold',async()=>{const row=await create();await change();assert.equal((await finish(row.id)).status,'current_controls_hold');assert.equal((await one('select operational_contact_id from icash_text_threads where id=$1',[thread])).operational_contact_id,old);});
 for(const status of [true,null,'false',undefined])await scenario('explicit false required '+String(status),async()=>{const b=structuredClone(body);if(status===undefined)delete b.data[0].do_not_call;else b.data[0].do_not_call=status;const row=await create(b);assert.equal((await finish(row.id)).status,'not_clear');});
 await scenario('immutable raw receipt and source binding',async()=>{const row=await create();assert.equal(await rpc('icash_record_seller_contact_refresh',{p_id:row.id,p_request:row.request_id,p_status:200,p_response:{}}),false);assert.deepEqual(await finish(row.id),{status:'revalidated'});await assert.rejects(q("update icash_seller_recovery_private.contact_refreshes set response='{}' where id=$1",[row.id]),/immutable/);});
 await scenario('migration cutoff preserves old backlog',async()=>{assert.equal(await rpc('icash_claim_seller_contact_refresh',{}),null);assert.equal((await one('select count(*)::int n from icash_seller_recovery_private.contact_refreshes')).n,0);});
 for(const alter of [b=>delete b.data[0].matched,b=>b.data.push(b.data[0]),b=>b.data[0].input.number='+12145550999',b=>b.credits.used=2,b=>b.credits.used='1',b=>b.totals.matched=0,b=>b.credits.deduplicated=1])await scenario('malformed response fails strict provider contract',async()=>{const b=structuredClone(body);alter(b);assert.equal((await one('select icash_seller_recovery_private.phone_response_valid($1,$2) ok',[b,phone])).ok,false);});
 assert.equal((await one('select icash_seller_recovery_private.phone_response_valid($1,$2) ok',[body,phone])).ok,true);
 // The TypeScript worker never retries a paid provider request, including a
 // missing HTTP response. It may retry only the identical durable DB receipt.
 for(const mode of ['ok','network_unknown','lost_database_ack','missing_key']){
  let calls=0,saves=0;const events=[];const claim={id:randomUUID(),requestId:randomUUID(),phone};
  const db=async(path,method,args)=>{events.push(path);if(path==='rpc/icash_claim_seller_contact_refresh')return claim;if(path==='rpc/icash_record_seller_contact_refresh'){saves++;if(mode==='lost_database_ack'&&saves===1)throw Error('ack lost');return true;}if(path==='rpc/icash_finish_seller_contact_refresh')return {status:'revalidated'};return true;};
  const transport=async(url,init)=>{calls++;assert.equal(url,'https://api.v2.dealmachine.com/v1/phones/dnc');assert.deepEqual(JSON.parse(init.body),{phones:[{number:phone}]});if(mode==='network_unknown')throw Error('network unknown');return Response.json(body);};
  const result=await processSellerContactRefresh(db,mode==='missing_key'?undefined:'SIMULATION',transport);
  assert.equal(calls,mode==='missing_key'?0:1);assert.equal(saves,mode==='lost_database_ack'?2:mode==='ok'?1:0);
  if(mode==='network_unknown')assert.equal(result.status,'contact_refresh_requires_review');cases++;
 }
 console.log(`PASS seller contact refresh: ${cases} offline scenarios; exact provider receipt, unchanged original evidence, real cadence/contact/rebind holds and no provider replay.`);
}catch(e){console.error(e.message,e.where??'',e.cause?.message??'');process.exitCode=1;}finally{await pg.close();}
