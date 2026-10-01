// SIMULATION ONLY: isolated PostgreSQL functions and provider fixtures. No network.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createJourneyDb} from '../tests/helpers/simulated-journey-db.mjs';
import {databaseAdapter,loadService} from '../tests/helpers/simulated-journey-services.mjs';
import {enrichOwners} from '../lib/owner-enrichment.ts';
import {runScreeningJob} from '../lib/screening-job.ts';
import * as liveWorkAdmission from '../lib/live-work-admission.ts';
const {pg}=await createJourneyDb(process.argv[2]);
const adapter=databaseAdapter(pg),{q,rpc}=adapter;
const one=async(sql,args=[])=>{const result=await q(sql,args);assert.equal(result.rows.length,1);return result.rows[0];};
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const previous={key:process.env.DEALMACHINE_API_KEY,ready:process.env.ICASH_LIVE_WORK_READY,fetch:globalThis.fetch};
try{
 for(const name of ['text-ai','market-expansion','seller-opener-experiments','seller-opener-delivery-order','sms-inbound-campaign','sms-contact-intake','owner-enrichment-claim'])await pg.exec(read('config/'+name+'.sql'));
 console.log('SIMULATION owner-contact claim schema loaded');
 const user=randomUUID(),account=randomUUID(),otherUser=randomUUID(),other=randomUUID();
 await q('insert into auth.users(id,email) values($1,$2),($3,$4)',[user,'owners@example.invalid',otherUser,'other@example.invalid']);
 await q("insert into icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values($1,$2,'Fixture',false,300),($3,$4,'Other fixture',false,300)",[account,user,other,otherUser]);
 await q("insert into icash_wallets(account_id,balance_cents,reserved_cents,currency) values($1,300,0,'USD'),($2,300,0,'USD')",[account,other]);
 await q("update icash_operating_budget set enabled=true,require_company_reserve=false,funded_micros=0,protected_micros=0,reserved_micros=0,spent_micros=0,daily_limit_micros=null where id=1");
 await q("insert into icash_spend_activations(account_id,enabled,customer_cap_cents) values($1,true,300)",[account]);
 await q("insert into icash_funding_orders(account_id,mode,guest_hash,pack_code,price_cents,credit_cents,state,credited_at) values($1,'live',repeat('c',64),'start',300,300,'paid',now())",[account]);
 const rate=await one("select id,charge_cents,costs_micros from icash_operation_rates where version='owner_enrichment-planning-2026-09-29-v1'");
 assert.equal(Number(rate.charge_cents),174);
 const searchRate=(await one("select id from icash_operation_rates where version='property_search-planning-2026-09-29-v1'")).id;
 const rights=new Date(Date.now()+3600000).toISOString();
 const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date().toISOString(),sellerCostReserveCents:100000,raw:{data:{dm_property_id:'prop_123',full_address:'SIMULATION property',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}}};
 const screening=(await one("insert into icash_screening_jobs(account_id,event_key,snapshot,state,result,completed_at) values($1,'SIMULATION contact claim',$2,'complete',$3,now()) returning id",[account,snapshot,runScreeningJob(snapshot)])).id;
 const operation=`owners:${account}:${screening}`;
 await q("insert into icash_discovery_configs(account_id,zip,rate_id,contact_rate_id,contact_credit_cap,property_credit_micros,data_rights_until,seller_cost_reserve_cents,enabled,contacts_enabled) values($1,'75201',$2,$3,25,10000,$4,100000,true,true)",[account,searchRate,rate.id,rights]);
 const args={p_account:account,p_screening:screening,p_operation:operation,p_snapshot:snapshot,p_rate:rate.id,p_credit_cap:25,p_unit_cost_micros:10000,p_quoted_data_cost_micros:250000,p_rights_until:rights};
 const reserve=()=>rpc('icash_reserve_operation',{p_account:account,p_operation:operation,p_rate:rate.id,p_permission_until:rights});
 const claim=(patch={})=>rpc('icash_claim_owner_enrichment',{...args,...patch});
 const caseInTransaction=async work=>{await q('begin');try{await work();}finally{await q('rollback');}};
 await caseInTransaction(async()=>{
  assert.equal(await claim(),false,'No reservation cannot dispatch');
  await reserve();assert.equal(await claim(),true);assert.equal(await claim(),false,'Exactly one claim wins');
  const spend=await one('select state,charge_cap_cents from icash_operation_spend where operation_key=$1',[operation]);assert.equal(spend.state,'dispatched');assert.equal(Number(spend.charge_cap_cents),174);
  assert.equal((await one('select manual from icash_property_controls where account_id=$1 and property_id=$2',[account,'prop_123'])).manual,false);
  const wallet=await one('select balance_cents,reserved_cents from icash_wallets where account_id=$1',[account]);assert.equal(Number(wallet.balance_cents),300);assert.equal(Number(wallet.reserved_cents),174);
 });
 for(const patch of [{p_account:other},{p_screening:randomUUID()},{p_operation:operation+':other'},{p_snapshot:{...snapshot,propertyId:'prop_456'}},{p_rate:searchRate},{p_credit_cap:26},{p_credit_cap:24},{p_unit_cost_micros:9999},{p_quoted_data_cost_micros:249999},{p_quoted_data_cost_micros:250001},{p_rights_until:new Date(Date.now()+7200000).toISOString()}])await caseInTransaction(async()=>{await reserve();assert.equal(await claim(patch),false,JSON.stringify(patch));});

 const holds=[
  ["select public.icash_set_work_control($1,$2,'takeover',$3)",[user,account,screening]],
  ["insert into icash_property_controls(account_id,property_id,manual) values($1,'prop_123',true)",[account]],
  ['update icash_discovery_configs set contacts_enabled=false where account_id=$1',[account]],
  ['update icash_discovery_configs set enabled=false where account_id=$1',[account]],
  ['update icash_discovery_configs set contact_credit_cap=24 where account_id=$1',[account]],
  ['update icash_discovery_configs set contact_rate_id=$1 where account_id=$2',[searchRate,account]],
  ['update icash_discovery_configs set property_credit_micros=20000 where account_id=$1',[account]],
  ["update icash_discovery_configs set data_rights_until=now()-interval '1 second' where account_id=$1",[account]],
  ["update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{propertyId}','\"prop_456\"') where id=$1",[screening]],
  ["update icash_screening_jobs set state='failed' where id=$1",[screening]],
  ["update icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"hold\"}}' where id=$1",[screening]],
  ["update icash_screening_jobs set completed_at=now()-interval '25 hours' where id=$1",[screening]],
  ["update icash_screening_jobs set completed_at=now()+interval '1 minute' where id=$1",[screening]],
  ['update icash_accounts set bot_paused=true where id=$1',[account]],
  ['update icash_spend_activations set enabled=false where account_id=$1',[account]],
  ['update icash_operating_budget set enabled=false where id=1',[]],
  ['update icash_operation_rates set enabled=false where id=$1',[rate.id]],
 ];
 for(const [sql,values] of holds)await caseInTransaction(async()=>{
  await reserve();await q(sql,values);assert.equal(await claim(),false,sql);
  assert.equal((await one('select state from icash_operation_spend where operation_key=$1',[operation])).state,'reserved',sql);
 });
 for(const fetchedAt of ['invalid',new Date(Date.now()-90000000).toISOString(),new Date(Date.now()+60000).toISOString()])await caseInTransaction(async()=>{
  await reserve();const changed={...snapshot,fetchedAt};await q('update icash_screening_jobs set snapshot=$1 where id=$2',[changed,screening]);assert.equal(await claim({p_snapshot:changed}),false);
 });
 for(const field of ['propertyType','raw'])await caseInTransaction(async()=>{
  await reserve();const changed={...snapshot,[field]:field==='propertyType'?'land':{data:{...snapshot.raw.data,dm_property_id:'prop_456'}}};await q('update icash_screening_jobs set snapshot=$1 where id=$2',[changed,screening]);assert.equal(await claim({p_snapshot:changed}),false);
 });
 console.log('SIMULATION exact tenant/snapshot/config/rights/manual/freshness/rate guards and duplicate claim passed');

 // Existing reserve semantics still impose the customer wallet/day/lifetime caps.
 await caseInTransaction(async()=>{
  await q('update icash_wallets set balance_cents=173 where account_id=$1',[account]);await assert.rejects(reserve(),/credit|balance|wallet/i);
 });
 await caseInTransaction(async()=>{
  await q('update icash_accounts set daily_limit_cents=173 where id=$1',[account]);await assert.rejects(reserve(),/daily|limit/i);
 });
 await caseInTransaction(async()=>{
  await q('update icash_spend_activations set customer_cap_cents=173 where account_id=$1',[account]);await assert.rejects(reserve(),/cap/i);
 });
 console.log('SIMULATION original $3 wallet/day/lifetime reservation boundaries preserved');

 // Inject withdrawals at the narrow race: AFTER all JavaScript checks and reserve,
 // immediately BEFORE the actual final SQL claim. Provider access must stay zero.
 let beforeFinalClaim=null,paidCalls=0,previewCalls=0;
 const db=async(path,method,body)=>{
  if(path==='rpc/icash_claim_owner_enrichment'&&beforeFinalClaim)await beforeFinalClaim();
  return adapter.db(path,method,body);
 };
 const {reserveOperation}=await loadService('lib/operating-costs.ts',{db,...liveWorkAdmission});
 const {enrichForAccount}=await loadService('lib/owner-enrichment-service.ts',{db,reserveOperation,enrichOwners,runScreeningJob});
 process.env.ICASH_LIVE_WORK_READY='true';process.env.DEALMACHINE_API_KEY='dm_sk_live_fixture';
 globalThis.fetch=async(url,options)=>{
  if(options.method==='GET'){
   previewCalls++;assert.equal(url,'https://api.v2.dealmachine.com/v1/properties/prop_123?enrich=false&contact_audience=owners');
   return Response.json({data:{dm_property_id:'prop_123',contacts:[{dm_person_id:'per_123',is_likely_owner:true}]},credits:{used:0,people:0,properties:0,deduplicated:0}});
  }
  paidCalls++;assert.equal(url,'https://api.v2.dealmachine.com/v1/people/ids');assert.deepEqual(JSON.parse(options.body),{ids:['per_123'],enrich:true,include_properties:false});
  return Response.json({data:[{dm_person_id:'per_123',found:true,full_name:'SIMULATION contact',phones:[{number:'5555555555',do_not_call:false}]}],totals:{submitted:1,found:1,not_found:0},credits:{used:1,people:1,properties:0,deduplicated:0}});
 };
 for(const [sql,values] of holds.slice(0,9))await caseInTransaction(async()=>{
  paidCalls=0;previewCalls=0;beforeFinalClaim=()=>q(sql,values);
  await assert.rejects(enrichForAccount(account,screening),/held or already dispatched/);
  assert.equal(previewCalls,1);assert.equal(paidCalls,0,sql);
  assert.equal((await one('select state from icash_operation_spend where operation_key=$1',[operation])).state,'reserved');
 });
 await caseInTransaction(async()=>{
  beforeFinalClaim=null;paidCalls=0;previewCalls=0;
  assert.equal((await enrichForAccount(account,screening)).status,'contacts_saved');assert.equal(paidCalls,1);
  const saved=(await one('select result from icash_owner_contacts where screening_id=$1',[screening])).result;
  assert.equal(saved.propertyId,'prop_123');assert.equal(saved.outreachAuthorized,false);assert.equal(saved.contacts[0].phones[0].permission,'unverified');
  assert.equal((await one('select count(*)::int n from icash_cost_observations where event_key like $1',[operation+'%'])).n,4);
  await assert.rejects(enrichForAccount(account,screening),/held or already dispatched/);assert.equal(paidCalls,1);
 });
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'public.icash_claim_owner_enrichment(uuid,uuid,text,jsonb,uuid,integer,bigint,bigint,timestamptz)','execute') allowed",[role])).allowed,false);
 assert.equal((await one("select has_function_privilege('service_role','public.icash_claim_owner_enrichment(uuid,uuid,text,jsonb,uuid,integer,bigint,bigint,timestamptz)','execute') allowed")).allowed,true);
 const definition=(await one("select pg_get_functiondef('public.icash_claim_owner_enrichment(uuid,uuid,text,jsonb,uuid,integer,bigint,bigint,timestamptz)'::regprocedure) body")).body;
 assert.match(definition,/return public\.icash_claim_operation\(p_operation\)/);assert.match(definition,/clock_timestamp\(\)/);
 console.log('SIMULATION actual service + real final SQL claim blocks takeover/withdrawal races; normal bounded contact persistence, cost evidence, exactly-once and service-only privileges passed');
 console.log('PGlite uses one connection: transaction locks are implemented in SQL; independent-session blocking was not simulated.');
}finally{
 globalThis.fetch=previous.fetch;
 if(previous.key===undefined)delete process.env.DEALMACHINE_API_KEY;else process.env.DEALMACHINE_API_KEY=previous.key;
 if(previous.ready===undefined)delete process.env.ICASH_LIVE_WORK_READY;else process.env.ICASH_LIVE_WORK_READY=previous.ready;
 await pg.close();
}
