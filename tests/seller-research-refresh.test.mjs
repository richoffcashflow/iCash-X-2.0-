// Local PostgreSQL and provider fixtures only. No network or production spend.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {processSellerResearchRefresh} from '../lib/seller-research-refresh.ts';
import {databaseAdapter} from './helpers/simulated-journey-services.mjs';
const pg=await PGlite.create(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const q=(sql,args=[])=>pg.query(sql,args),one=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table icash_seller_intakes(id uuid primary key,state text,ai_consented boolean,contact_consent_scope text,data_rights_until timestamptz,checked_at timestamptz,property jsonb,result jsonb,phone text,address text,numbers_passed boolean,market_qualified boolean,customer_costs jsonb);
 create table icash_seller_responses(lead_id uuid,screening_id uuid,account_id uuid,state text,detail text,next_attempt_at timestamptz,updated_at timestamptz);
 create table icash_seller_matches(lead_id uuid,screening_id uuid,account_id uuid,assigned_at timestamptz);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,state text,snapshot jsonb,result jsonb,completed_at timestamptz);
 create table icash_accounts(id uuid primary key,bot_paused boolean);
 create table icash_wallets(account_id uuid,balance_cents bigint);
 create table icash_deal_files(id uuid,screening_id uuid,account_id uuid,stage text,terms jsonb);
 create table icash_billing_reviews(account_id uuid,resolved_at timestamptz);
 create table icash_property_controls(account_id uuid,property_id text,manual boolean);
 create table icash_handoffs(account_id uuid,screening_id uuid,state text);
 create table icash_text_suppressions(phone text);create table icash_contact_suppressions(contact_key text);
 create table icash_signing_envelopes(account_id uuid,deal_id uuid,test_mode boolean);
 create table icash_text_threads(id uuid,account_id uuid,deal_id uuid,party text,recipient text,retired_at timestamptz,manual_only boolean,ai_mode text,paused boolean);
 create table icash_text_messages(id uuid,thread_id uuid,account_id uuid,direction text,state text,provider_id text);
 create table icash_operation_spend(operation_key text);
 create table icash_contact_permissions(id uuid,account_id uuid,screening_id uuid);
 create table icash_voice_jobs(id uuid,permission_id uuid,account_id uuid,callback_id uuid,state text,outcome text,operation_key text,provider_call_sid text,conversation_id uuid,due_at timestamptz,updated_at timestamptz);
 create table icash_call_recordings(account_id uuid,screening_id uuid,voice_job_id uuid);
 create table icash_live_conversations(account_id uuid,screening_id uuid);
 create table icash_seller_controls(id integer,enabled boolean,data_rights_until timestamptz,review_ref text,lookup_used_micros bigint,lookup_reserved_micros bigint,lookup_allowance_micros bigint,assignment_fee_cents bigint,seller_cost_reserve_cents bigint);
 create table icash_operation_rates(id uuid,operation text,enabled boolean,verified_at timestamptz,expires_at timestamptz,costs_micros jsonb,evidence_ref text);
 create table icash_data_cost_settings(provider text,credit_micros bigint,cost_basis text,source_ref text);
 create function icash_membership_work_allowed(uuid) returns boolean language sql as $$select true$$;
 create function icash_outreach_sms_current(uuid) returns boolean language sql as $$select true$$;
 create function icash_outreach_voice_current(uuid) returns boolean language sql as $$select true$$;
 create function icash_seller_contact_evidence(uuid,uuid,uuid,text) returns jsonb language sql as $$select '{"receipt":"SIMULATION bound original receipt"}'::jsonb$$;
 create function icash_address_state(text) returns text language sql as $$select 'TX'$$;
 create function icash_research_state_allowed(text) returns boolean language sql as $$select $1='TX'$$;
 create function icash_take_dealmachine_request() returns boolean language sql as $$select true$$;
 create function icash_assign_seller_lead_for(uuid) returns jsonb language plpgsql as $$declare l icash_seller_intakes;begin return jsonb_build_object('complete',l.result,l.checked_at);end$$;`);
 const sql=read('config/seller-shared-research-refresh.sql');assert.equal(sql,read('supabase/migrations/20261019004330_seller_shared_research_refresh.sql'));await pg.exec(sql);
 const old=new Date(Date.now()-25*3600000).toISOString();
 const original={id:'prop_12345',fetchedAt:old,address:'123 Main St, Dallas, TX 75201',city:'Dallas',state:'TX',raw:{data:{old:true}},sellerCostReserveCents:100000};
 const result={financialCheck:{status:'eligible'},property:{propertyId:'prop_12345'},preliminarySellerCeilingCents:19000000};
 await q("insert into icash_seller_intakes values($1,'assigned',true,'homeoffer_network_and_matched_buyers',now()+interval '7 days',$2,$3,$4,'+12145550123','123 Main St, Dallas, TX 75201',true,true,'{\"frozen\":100000}')",[id(1),old,original,result]);
 await q("insert into icash_accounts values($1,false);",[id(2)]);await q('insert into icash_wallets values($1,10000)',[id(2)]);
 await q("insert into icash_seller_matches values($1,$2,$3,now());",[id(1),id(3),id(2)]);
 await q("insert into icash_seller_responses values($1,$2,$3,'queued','SIMULATION fresh_screening_required',now(),now())",[id(1),id(3),id(2)]);
 await q("insert into icash_screening_jobs values($1,$2,'complete',$3,$4,$5)",[id(3),id(2),{propertyId:original.id,fetchedAt:old,propertyType:'house',sellerRequest:{id:id(1),receipt:'unchanged'},raw:original.raw},result,old]);
 await q("insert into icash_deal_files values($1,$2,$3,'draft','{}')",[id(4),id(3),id(2)]);
 await q("insert into icash_text_threads values($1,$2,$3,'seller','+12145550123',null,false,'auto',false)",[id(5),id(2),id(4)]);
 await q("insert into icash_text_messages values($1,$2,$3,'outgoing','ready',null)",[id(6),id(5),id(2)]);
 await q('insert into icash_contact_permissions values($1,$2,$3)',[id(7),id(2),id(3)]);
 await q("insert into icash_voice_jobs values($1,$2,$3,null,'held','fresh_screening_required',null,null,null,now(),now())",[id(8),id(7),id(2)]);
 await pg.exec("insert into icash_seller_controls values(1,true,now()+interval '7 days','SIMULATION existing approved research',0,0,1000000,1000000,100000);insert into icash_data_cost_settings values('dealmachine',20000,'estimate','SIMULATION receipt');");
 await q("insert into icash_operation_rates values($1,'property_search',true,now()-interval '1 day',now()+interval '7 days','{\"processing\":5000}','SIMULATION allocation')",[id(9)]);
 const targets=()=>one('select count(*)::int from icash_seller_research_refresh_targets(null)');assert.equal(await targets(),1);
 const isolated=async(fn)=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
 for(const mutation of [
 "update icash_accounts set bot_paused=true","update icash_wallets set balance_cents=0",
 "update icash_text_threads set paused=true","update icash_text_threads set manual_only=true",
 "update icash_text_messages set state='dispatching'","update icash_text_messages set provider_id='SIMULATION receipt'",
 "update icash_text_messages set direction='incoming'","update icash_voice_jobs set state='issued'",
 "update icash_voice_jobs set outcome='provider_outcome_unknown_no_retry'","update icash_voice_jobs set provider_call_sid='SIMULATION call'",
 "update icash_voice_jobs set operation_key='SIMULATION reservation'","update icash_deal_files set stage='under_contract'",
 "update icash_seller_intakes set ai_consented=false","update icash_seller_intakes set contact_consent_scope='icash_x_demo'",
 "insert into icash_text_suppressions values('+12145550123')",
 `insert into icash_operation_spend values('voice:${id(8)}')`,
 `insert into icash_operation_spend values('text:${id(6)}')`,
 ])await isolated(async()=>{await pg.exec(mutation);assert.equal(await targets(),0,mutation);assert.equal(await one('select icash_claim_seller_research_refresh()'),null);});
 await isolated(async()=>{await pg.exec('update icash_seller_controls set enabled=false');assert.equal(await one('select icash_claim_seller_research_refresh()'),null);});
 await isolated(async()=>{await pg.exec('update icash_seller_controls set lookup_allowance_micros=1');assert.equal(await one('select icash_claim_seller_research_refresh()'),null);});
 await isolated(async()=>{
  const first=await one('select icash_claim_seller_research_refresh()');assert(first);assert.equal(await one('select icash_claim_seller_research_refresh()'),null,'one lookup per old source');
  await pg.exec("update icash_seller_research_refreshes set claimed_at=now()-interval '3 minutes'");
  assert.equal(await one('select icash_claim_seller_research_refresh()'),null,'uncertain lookup is not retried');
  assert.equal(await one('select state from icash_seller_research_refreshes'),'review');assert.equal(await one('select lookup_reserved_micros from icash_seller_controls'),25000);
 });
 const finishFixture=async(claim,propertyId='prop_12345')=>{
  const fresh=await one('select now()::text');
  return one('select icash_finish_seller_research_refresh($1,$2,$3)',[claim.id,claim.token,{creditsUsed:1,numbersPassed:true,property:{...original,id:propertyId,fetchedAt:fresh},result:{...result,property:{propertyId}}}]);
 };
 await isolated(async()=>{
  const claim=await one('select icash_claim_seller_research_refresh()');await pg.exec('update icash_accounts set bot_paused=true');
  assert.equal(await finishFixture(claim),true);assert.deepEqual(await one('select applied_screenings from icash_seller_research_refreshes'),[],'pause during lookup prevents recovery');
  assert.equal(await one('select state from icash_voice_jobs'),'held');assert.deepEqual(await one('select property from icash_seller_intakes'),original);
 });
 await isolated(async()=>{
  const claim=await one('select icash_claim_seller_research_refresh()');assert.equal(await finishFixture(claim,'prop_99999'),false);
  assert.equal(await one('select state from icash_seller_research_refreshes'),'review');assert.deepEqual(await one('select property from icash_seller_intakes'),original,'a different property cannot replace the original');
  assert.equal(await one('select lookup_used_micros from icash_seller_controls'),25000,'provider cost is retained even when the property does not match');
 });
 const {db}=databaseAdapter(pg);let providerCalls=0;
 const transport=async(url,options)=>{
  providerCalls++;assert.equal(url,'https://api.v2.dealmachine.com/v1/enrichment/address');assert.equal(JSON.parse(options.body).contact_audience,'none');
  return Response.json({totals:{submitted:1},credits:{used:1,people:0},data:[{matched:true,dm_property_id:'prop_12345',full_address:original.address,city:'Dallas',state:'TX',zip:'75201',property_type:'Single Family',estimated_value:300000,estimated_repair_cost:30000,estimated_equity_amount:300000,total_estimated_loan_balance:0,living_area_sqft:1500}]});
 };
 const before=await one('select to_jsonb(l) from icash_seller_intakes l');
 const refreshed=await processSellerResearchRefresh(db,'dm_sk_live_simulation',transport);assert.equal(refreshed.status,'property_checked');assert.equal(providerCalls,1);
 assert.equal(await one('select state from icash_voice_jobs'),'ready');assert.equal(await one('select state from icash_text_messages'),'ready','same text is queued, not fabricated as sent');
 assert.equal(await one('select id from icash_text_messages'),id(6));assert.equal(await one('select id from icash_voice_jobs'),id(8));
 assert.equal(await one('select count(*)::int from icash_operation_spend'),0,'refresh never sends or bills a customer');
 assert.equal(await one('select lookup_used_micros from icash_seller_controls'),25000);assert.equal(await one('select lookup_reserved_micros from icash_seller_controls'),0);
 const after=await one('select to_jsonb(l) from icash_seller_intakes l');assert.equal(after.checked_at,before.checked_at,'original sharing deadline is unchanged');assert.deepEqual(after.customer_costs,before.customer_costs);
 assert.deepEqual(await one("select snapshot->'sellerRequest' from icash_screening_jobs"),{id:id(1),receipt:'unchanged'});
 const receipt=await one('select to_jsonb(f) from icash_seller_research_refreshes f');assert.deepEqual(receipt.source_property,original);assert.equal(receipt.applied_screenings[0],id(3));
 assert.equal(await one('select icash_finish_seller_research_refresh($1,$2,$3)',[receipt.id,receipt.claim_token,receipt.result]),true,'receipt replay is idempotent');
 assert.equal(await one('select lookup_used_micros from icash_seller_controls'),25000);
 assert.equal((await processSellerResearchRefresh(db,'dm_sk_live_simulation',transport)).status,'idle_or_setup_required');assert.equal(providerCalls,1);
 for(const role of ['anon','authenticated'])for(const fn of ['icash_claim_seller_research_refresh()','icash_seller_research_refresh_targets(uuid)','icash_finish_seller_research_refresh(uuid,uuid,jsonb)'])assert.equal(await one('select has_function_privilege($1,$2,\'execute\')',[role,fn]),false);
 console.log('PASS delayed seller research: one fresh provider receipt, original prices/deadlines and IDs retained, safe recovery only before dispatch, no ambiguous retries, controls and private permissions preserved.');
}finally{await pg.close();}
