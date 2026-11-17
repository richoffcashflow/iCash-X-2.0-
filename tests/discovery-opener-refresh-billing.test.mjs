// Fictional billing fixture: REAL reserve/claim/ledger/settle SQL from existing
// native fixture; source eligibility and quota are controllable seams here.
// The separate native apply suite exercises real source/contact predicates.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {processDiscoveryOpenerRefresh} from '../lib/discovery-opener-refresh.ts';
import {databaseAdapter} from './helpers/simulated-journey-services.mjs';
const pg=await PGlite.create(),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0])[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=id(1),base=id(2),thread=id(3),contact=id(4),screen=id(20),message=id(21),renewal=id(22),propertyRate=id(23);
const isolate=async fn=>{await q('begin');try{await fn();}finally{await q('rollback');}};
const property=(used=1)=>({data:[{input:{full_address:'123 Fictional St, Dallas, TX 75201'},matched:true,dm_property_id:'prop_12345'}],totals:{submitted:1,matched:1,unmatched:0},credits:{used,people:0,properties:1,deduplicated:1-used}});
try{
 await pg.exec(read('tests/fixtures/seller-contact-refresh-native.sql'));
 await pg.exec(`alter table icash_screening_jobs add primary key(id);alter table icash_text_messages add primary key(id);
 create table icash_dnc_verification_receipts(id uuid primary key);
 alter table icash_text_threads add column deal_id uuid;
 alter table fixture_controls add column expire_new_rate boolean default false;
 create or replace function icash_take_dealmachine_request(p_kind text,p_account uuid,p_operation text,p_request uuid) returns boolean language plpgsql as $$declare allowed boolean;begin select quota_admitted into allowed from public.fixture_controls;insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at) values(p_request,p_kind,p_account,p_operation,allowed,clock_timestamp());if (select expire_new_rate from public.fixture_controls) then update public.icash_operation_rates set expires_at=clock_timestamp()-interval '1 second' where id=(select rate_id from public.icash_operation_spend where operation_key=p_operation);end if;return allowed;end$$;
 `);
 const raw=read('config/seller-contact-refresh.sql'),start=raw.indexOf('create function icash_seller_recovery_private.phone_response_valid('),end=raw.indexOf('end $$;',start)+7;
 await pg.exec(raw.slice(start,end));
 await pg.exec(read('config/discovery-opener-refresh.sql'));
 await pg.exec(`create function icash_discovery_refresh_private.current(uuid) returns boolean language sql as $$select late_current from public.fixture_controls$$;
 create function icash_discovery_refresh_private.process(uuid) returns jsonb language sql as $$select '{"status":"receipt_only_fixture"}'::jsonb$$;`);
 await q("insert into icash_screening_jobs(id,account_id,state,snapshot) values($1,$2,'complete',$3)",[screen,account,{propertyId:'prop_12345',propertyType:'house',assignmentFeeCents:1000000,sellerCostReserveCents:0,raw:{data:{full_address:'123 Fictional St, Dallas, TX 75201'}}}]);
 await q("insert into icash_text_messages(id,account_id,state) values($1,$2,'ready')",[message,account]);
 await q("insert into icash_operation_rates select (jsonb_populate_record(null::icash_operation_rates,to_jsonb(r)||jsonb_build_object('id',$1::uuid,'operation','property_search','version','fictional-property'))).* from icash_operation_rates r where id=$2",[propertyRate,base]);
 await q('update icash_discovery_configs set rate_id=$1',[propertyRate]);
 await q("insert into icash_discovery_refresh_private.renewals(id,message_id,account_id,thread_id,screening_id,original_contact_id,original_snapshot,review_reference) values($1,$2,$3,$4,$5,$6,'{}','Fictional original source review')",[renewal,message,account,thread,screen,contact]);
 const enable=()=>q("update icash_discovery_refresh_private.policy set enabled=true,release_sha=repeat('a',40),review_reference='Fictional exact release review'");
 const claim=()=>one('select icash_claim_discovery_opener_refresh($1)',[renewal]);
 const save=async(c,body=property())=>one('select icash_record_discovery_opener_refresh($1,$2,200,$3)',[c.requestId,c.quotaRequestId,body]);
 const settle=c=>one('select icash_discovery_refresh_private.settle_request($1)',[c.requestId]);
 await assert.rejects(q('update icash_discovery_refresh_private.policy set enabled=true'),/check constraint/);
 assert.equal(await claim(),null,'inactive makes no purchase');
 await enable();
 await isolate(async()=>{const c=await claim();assert(c);assert.equal(await claim(),null);assert.equal(await one('select count(*) from icash_operation_spend'),1);assert.equal(await one('select state from icash_operation_spend'),'dispatched');assert.equal(await settle(c),false,'unknown cost remains held');assert.equal(await one('select icash_settle_estimated_operation($1)', ['discovery-refresh:'+c.requestId]),false,'maintenance cannot quote-settle unknown property');assert.equal(await one('select count(*) from icash_credit_ledger'),0);assert(await save(c));assert(await settle(c));assert.equal(await one('select charged_cents from icash_operation_spend'),11);assert.equal(await one('select balance_cents from icash_wallets'),989);assert(await settle(c));assert.equal(await one('select count(*) from icash_credit_ledger'),1);});
 await isolate(async()=>{const c=await claim();await save(c,property(0));assert(await settle(c));assert.equal(await one('select charged_cents from icash_operation_spend'),8,'only observed dedup saves data cost');});
 await isolate(async()=>{await q('insert into fixture_vips values($1)',[account]);const c=await claim();await save(c);assert(await settle(c));assert.equal(await one('select charged_cents from icash_operation_spend'),8,'saved VIP pricing');});
 for(const body of [{...property(),credits:{used:1,people:0}},{...property(),credits:{used:0,people:0,properties:1,deduplicated:0}},{...property(),totals:{submitted:1,matched:0,unmatched:1}},{...property(),credits:{used:'1',people:0,properties:1,deduplicated:0}}])await isolate(async()=>{const c=await claim();await save(c,body);assert.equal(await settle(c),false);assert.equal(await one('select count(*) from icash_credit_ledger'),0);});
 await isolate(async()=>{const c=await claim();await save(c);await q('update icash_operation_spend set customer_price_micros=1');assert.equal(await settle(c),false,'unexpected fractional quote held');});
 await isolate(async()=>{const c=await claim();await save(c);await q('update icash_accounts set bot_paused=true');assert(await settle(c),'real receipt settles after Pause without unpause');assert.equal(await one('select bot_paused from icash_accounts'),true);});
 for(const control of ['quota_admitted','expire_new_rate'])await isolate(async()=>{await q('update fixture_controls set '+control+'='+ (control==='quota_admitted'?'false':'true'));await q('savepoint attempt');await assert.rejects(claim(),/Renewal (quota admission held|rate expired before handoff)/);await q('rollback to savepoint attempt');assert.equal(await one('select count(*) from icash_operation_spend'),0);assert.equal(await one('select count(*) from icash_discovery_refresh_private.requests'),0);assert.equal(await one('select reserved_micros from icash_operating_budget'),0);});
 await isolate(async()=>{const c=await claim();await save(c);assert.equal(await one('select icash_record_discovery_opener_refresh($1,$2,200,$3)',[c.requestId,c.quotaRequestId,property(0)]),false,'changed receipt refused');await assert.rejects(q("update icash_discovery_refresh_private.requests set response='{}'"),/immutable/);});
 for(const clear of [false,true,null])await isolate(async()=>{
  const request=id(30),quota=id(31),op='discovery-refresh:'+request;
  const r=await one("select icash_discovery_refresh_private.reserve_request($1,'dnc',$2)",[renewal,request]);assert(r);
  await q("insert into icash_discovery_refresh_private.requests(id,renewal_id,kind,operation_key,rate_id,unit_cost_micros,quota_request_id,requested_at,request) values($1,$2,'dnc',$3,$4,10000,$5,date_trunc('milliseconds',clock_timestamp()),$6)",[request,renewal,op,r.rateId,quota,{phones:[{number:'+12145550123'}]}]);
  assert.equal(await one('select icash_claim_operation($1)',[op]),true);
  await q("insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at) values($1,'phone_dnc',$2,$3,true,clock_timestamp())",[quota,account,op]);
  assert.equal(await one('select icash_settle_estimated_operation($1)',[op]),false,'maintenance cannot quote-settle unknown DNC');
  const body={data:[{input:{number:'+12145550123'},matched:true,...(clear===null?{}:{do_not_call:clear})}],totals:{submitted:1,matched:1,unmatched:0},credits:{used:1,people:1,deduplicated:0}};
  assert.equal(await one('select icash_record_discovery_opener_refresh($1,$2,200,$3)',[request,quota,body]),true);
  assert.equal(await one('select icash_discovery_refresh_private.settle_request($1)',[request]),true,'actual charge settles even when DNC unclear; no eligibility granted');
  assert.equal(await one('select charged_cents from icash_operation_spend'),11);
  assert.equal(await one('select successor_contact_id from icash_discovery_refresh_private.renewals'),null);
 });
 // Full property half of the real worker: actual claim, saved exact body/raw,
 // real monetary settlement, real TypeScript model and SQL source-binding.
 // current()/process() remain explicit candidate/apply seams in this money fixture;
 // the independent native suite exercises their actual bodies and normal issuer.
 for(const corruption of [null,'property_id','echo','qualified_raw','qualified_timestamp'])await isolate(async()=>{
  const adapter=databaseAdapter(pg),calls=[];let requests=0;
  const db=async(path,method,body)=>{
   calls.push(path);
   if(path.endsWith('record_discovery_opener_refresh'))assert.equal(await one('select new_snapshot from icash_discovery_refresh_private.renewals'),null,'raw saved before qualification');
   if(path.endsWith('icash_qualify_discovery_opener_refresh')){
    assert.equal(await one('select count(*) from icash_discovery_refresh_private.requests where settled'),1,'real actual-cost settlement precedes model persistence');
    assert.equal(await one('select count(*) from icash_credit_ledger'),1);
    if(corruption==='qualified_raw')body=structuredClone(body),body.p_output.property.raw.data.estimated_value=999999;
    if(corruption==='qualified_timestamp')body=structuredClone(body),body.p_output.property.fetchedAt=new Date(Date.parse(body.p_output.property.fetchedAt)+1).toISOString();
   }
   return adapter.db(path,method,body);
  };
  const transport=async(url,init)=>{
   requests++;assert.equal(url,'https://api.v2.dealmachine.com/v1/enrichment/address');
   const sent=JSON.parse(init.body),saved=await one("select request from icash_discovery_refresh_private.requests where kind='property'");
   assert.deepEqual(sent,saved,'provider uses exact durable request body');assert.equal(sent.contact_audience,'none');assert(sent.fields.includes('property_type'));
   const input=corruption==='echo'?{full_address:'999 Different Fictional Street'}:sent.data[0];
   const raw={data:[{input,matched:true,dm_property_id:corruption==='property_id'?'prop_54321':'prop_12345',full_address:sent.data[0].full_address,city:'Dallas',state:'TX',zip:'75201',property_type:'Single Family',estimated_value:300000,estimated_repair_cost:30000,estimated_equity_amount:300000,total_estimated_loan_balance:0,living_area_sqft:1500}],credits:{used:1,properties:1,people:0,deduplicated:0},totals:{submitted:1,matched:1,unmatched:0}};
   return new Response(JSON.stringify(raw),{status:200});
  };
  const result=await processDiscoveryOpenerRefresh(db,'dm_sk_live_FICTIONAL',renewal,transport);
  assert.equal(requests,1);assert.equal(result.status,corruption?'renewal_underwriting_review':'receipt_only_fixture');
  const n=await one('select to_jsonb(n) from icash_discovery_refresh_private.renewals n');
  if(corruption)assert.equal(n.new_snapshot,null,'changed evidence never qualifies');
  else{
   const saved=await one("select to_jsonb(r) from icash_discovery_refresh_private.requests r where kind='property'");
   assert.equal(n.new_result.financialCheck.status,'eligible');
   assert.equal(Date.parse(n.new_snapshot.fetchedAt),Date.parse(saved.requested_at),'DB canonical claim timestamp preserved');
   assert.deepEqual(n.new_snapshot.raw,{data:saved.response.data[0],credits:saved.response.credits});
   assert.equal(n.new_snapshot.propertyId,'prop_12345');
   assert.equal(await one('select charged_cents from icash_operation_spend'),11);
   assert.equal(await claim(),null,'DNC waits for unchanged one-minute admission pacing');
  }
  assert(calls.indexOf('rpc/icash_record_discovery_opener_refresh')<calls.indexOf('rpc/icash_qualify_discovery_opener_refresh'));
  assert.equal(await one("select count(*) from icash_operation_spend where operation_key like 'text:%'"),0);
 });
 console.log('PASS actual renewal reserve/claim/ledger settlement, 3x/VIP/dedup, malformed/unknown holds, one-use, immutable receipts, late-expiry and quota rollback.');
}catch(e){console.error(e.message,e.where??'',e.position??'');process.exitCode=1;}finally{await pg.close();}
