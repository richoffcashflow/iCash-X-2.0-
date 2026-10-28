// Isolated PostgreSQL, synthetic rows, no provider requests or production writes.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {ownerBatchAudience,allocateOwnerBatch} from '../lib/owner-batch.ts';
import {runScreeningJob} from '../lib/screening-job.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const db=new PGlite(),q=(s,a=[])=>db.query(s,a),val=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,account=uuid(1),other=uuid(2),rate=uuid(3),revision=uuid(4);
const plan=(strategy='baseline',providerPage=1)=>({version:'seller-filters-v1',strategy,providerPage,mode:'explore'});
try{
await db.exec('create role anon;create role authenticated;create role service_role;');
await db.exec(read('tests/fixtures/opportunity-schema.sql'));
await db.exec(`
 create table icash_sms_seller_openings(thread_id uuid primary key,account_id uuid,interest_message_id uuid);
 create table icash_deal_emails(id uuid primary key,account_id uuid,deal_id uuid,direction text);
 create table icash_market_shortlist(zip text primary key,state text,city text);
 create table icash_property_zip_geographies(zip text primary key,state_code text,property_count bigint,checked_at timestamptz,expires_at timestamptz);
 create function icash_seller_contact_stop(text) returns boolean language sql immutable as $$select lower(trim($1))='stop'$$;
 create function icash_research_state_allowed(text) returns boolean language sql immutable as $$select $1='TX'$$;
 create function icash_record_cost_observation(text,text,text,numeric,text) returns void language sql as $$insert into public.icash_cost_observations(provider,event_key,source_ref,amount,units) values($1,$2,$3,$4,$5) on conflict do nothing$$;
 create function icash_enqueue_screening(uuid,text,jsonb,timestamptz) returns uuid language sql as $$insert into public.icash_screening_jobs(account_id,event_key,snapshot) values($1,$2,$3) returning id$$;
 create function icash_rotate_inventory_market(uuid) returns boolean language sql as $$select false$$;
 -- Financial admission is an explicit fixture input; existing budget suites test
 -- its implementation. The actual production scope/claim wrapper runs below.
 create function icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean) returns void language plpgsql as $$begin
 if exists(select 1 from public.icash_accounts where id=$1 and bot_paused) then raise exception 'Fixture budget hold';end if;
 insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,permission_until) values($2,$1,$3,gen_random_uuid(),50,100000,$4) on conflict do nothing;end$$;
 create function icash_claim_operation(text) returns boolean language plpgsql as $$begin update public.icash_operation_spend set state='dispatched',dispatched_at=now() where operation_key=$1 and state='reserved';return found;end$$;
`);
await db.exec(read('config/opportunity-engine.sql').split('-- Bayesian smoothing')[0]+'commit;');
await db.exec(read('tests/fixtures/filter-discovery-dependencies.sql'));
const admission=read('config/requested-property-zip-resolution.sql').match(/create or replace function public\.icash_reserve_and_claim_property_discovery\([\s\S]*?end \$\$;/)[0];
await db.exec(admission);
await db.exec(read('config/outbound-filter-experiments.sql'));
await db.exec(read('supabase/migrations/20261021173023_adaptive_outbound_feedback.sql'));
const receiptMigration=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_outbound_feedback_receipt_clock.sql'));
assert(receiptMigration,'Receipt-clock correction is included in the release');
await db.exec(read('supabase/migrations/'+receiptMigration));
await db.exec(`
 create table icash_market_research_results(account_id uuid,zip text,city text,state text,total_properties bigint,high_equity_properties bigint,potential_buyers bigint,checked_at timestamptz);
 alter table icash_property_zip_geographies add column name text,add column source_ref text;
 create table icash_prospecting_budgets(id bigint primary key,account_id uuid,baseline_cents bigint,limit_cents bigint,created_at timestamptz);
 alter table icash_operation_spend add column prospecting_budget_id bigint;
 create function icash_new_prospect_operation(uuid,text,uuid) returns boolean language sql as $$select true$$;
 create function icash_prospecting_released(bigint,timestamptz) returns bigint language sql as $$select least($1/2,500)$$;
 create function icash_membership_work_allowed(uuid) returns boolean language sql as $$select true$$;
 create function icash_research_zip_known(text) returns boolean language sql as $$select exists(select 1 from public.icash_market_shortlist where zip=$1) or exists(select 1 from public.icash_property_zip_geographies where zip=$1 and expires_at>now())$$;
 create function icash_opportunity_market_score(uuid,text) returns numeric language sql as $$select 0::numeric$$;
`);
const baseline=JSON.parse(read('tests/fixtures/unique-inventory-functions.json'));
for(const name of ['icash_finish_credit','icash_prospecting_total_available','icash_prospecting_available','icash_prospecting_progress','icash_rotate_inventory_market'])await db.exec(baseline.find(x=>x.proname===name).definition);
await db.exec(read('config/unique-outbound-inventory.sql'));
await db.exec(read('config/inventory-budget-query.sql'));

// Current changed functions are captured without data; dependent financial
// admission is simulated below, while existing budget suites cover that engine.
for(const f of JSON.parse(read('tests/fixtures/research-efficiency-before.json')))await db.exec(f.definition);
await db.exec(`
 create table icash_dealmachine_request_budget(id integer primary key,used integer not null default 0);
 insert into icash_dealmachine_request_budget values(1,0);
 create function icash_take_dealmachine_request() returns boolean language plpgsql as $$begin update public.icash_dealmachine_request_budget set used=used+1 where id=1 and used<2;return found;end$$;
 create function icash_dealmachine_capacity_available(integer default 1) returns boolean language sql as $$select true$$;
 create function icash_prospecting_outreach_floor(uuid) returns bigint language sql as $$select 100::bigint$$;
 create function icash_research_admission_quote(uuid,text,bigint) returns bigint language sql as $$select $3+205$$;
 create function icash_research_purchase_allowed(uuid,text,uuid) returns boolean language sql as $$select true$$;
 create function icash_outbound_search_due(uuid) returns boolean language sql as $$select true$$;
 create function icash_claim_owner_enrichment(p_account uuid,p_screening uuid,p_operation text,p_snapshot jsonb,p_rate uuid,p_credit_cap integer,p_unit_cost_micros bigint,p_quoted_data_cost_micros bigint,p_rights_until timestamptz) returns boolean language sql as $$select public.icash_claim_owner_before_recovery_cap($1,$2,$3,$4,$5,$6,$7,$8,$9)$$;
 create function icash_settle_dealmachine_usage(text) returns boolean language plpgsql as $$begin update public.icash_operation_spend set state='settled',settled_at=now(),charged_cents=0 where operation_key=$1 and state='dispatched';return found;end$$;
`);
await db.exec(read('config/research-request-efficiency.sql'));
await db.exec(read('config/research-request-indexes.sql'));
await db.exec(read('config/owner-batch-quota-admission.sql'));
await q("insert into icash_accounts(id,owner_user_id,assistant_name,bot_paused) values($1,$1,'Fixture',false),($2,$2,'Other',false)",[account,other]);
await db.exec("insert into icash_operating_budget(id,enabled) values(1,true);insert into icash_market_shortlist values('75217','TX','Dallas');update icash_discovery_filter_settings set enabled=true;");
const ownerRate=uuid(9);
await q("insert into icash_operation_rates(id,operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) values($1,'property_search','fixture-search',51,'{\"dealmachine\":100000}','SYNTHETIC',now(),now()+interval '10 days',true),($2,'owner_enrichment','fixture-owner',105,'{\"dealmachine\":250000}','SYNTHETIC',now(),now()+interval '10 days',true)",[rate,ownerRate]);
for(const a of [account,other]){
 await q("insert into icash_wallets(account_id,balance_cents) values($1,2500)",[a]);
 await q("insert into icash_discovery_configs(account_id,enabled,auto_enabled,zip,rate_id,property_credit_micros,data_rights_until,seller_cost_reserve_cents,next_page,revision,contacts_enabled,contact_rate_id,contact_credit_cap) values($1,true,true,'75217',$2,10000,'2099-01-01',0,1,$3,true,$4,25)",[a,rate,revision,ownerRate]);
 await q('insert into icash_prospecting_budgets values($1,$2,2500,1250,now())',[a===account?1:2,a]);
}
const prepare=a=>val('select icash_prepare_research_efficiency($1)',[a]);
assert.equal(await prepare(account),false,'Rollout starts disabled');
await db.exec('update icash_research_private.settings set enabled=true');
assert.equal(await prepare(account),true);
let c=(await q('select * from icash_discovery_configs where account_id=$1',[account])).rows[0];
assert.equal(c.per_page,25);assert.equal(c.max_open_prospects,25);assert.equal(c.research_version,1);assert.notEqual(c.rate_id,rate);assert.notEqual(c.revision,revision);
assert.equal(Number(await val('select charge_cents from icash_operation_rates where id=$1',[c.rate_id])),105);
assert.equal(Number(await val('select charge_cents from icash_operation_rates where id=$1',[rate])),51,'Original rate is immutable');
const firstRevision=c.revision;await prepare(account);assert.equal(await val('select revision from icash_discovery_configs where account_id=$1',[account]),firstRevision,'No revision churn');
await q('update icash_wallets set balance_cents=280 where account_id=$1',[other]);await prepare(other);
assert.equal(await val('select per_page from icash_discovery_configs where account_id=$1',[other]),5,'Small wallet keeps five-record rate');
await q('update icash_accounts set bot_paused=true where id=$1',[other]);assert.equal(await prepare(other),false);
const metricId=uuid(20);
assert.equal(await val("select icash_take_dealmachine_request('property_search',$1,'synthetic',$2)",[account,metricId]),true);
assert.equal(await val("select icash_take_dealmachine_request('property_search',$1,'synthetic',$2)",[account,metricId]),false);
assert.equal(await val("select icash_finish_dealmachine_request($1,'{}')",[metricId]),false);
assert.equal(await val("select icash_finish_dealmachine_request($1,'{\"outcome\":\"response\",\"returned\":25,\"creditsUsed\":20,\"secret\":\"discard\"}')",[metricId]),true);
assert.equal(await val("select result ? 'secret' from icash_research_private.requests where id=$1",[metricId]),false);
assert.equal(await val("select icash_finish_dealmachine_request($1,'{\"outcome\":\"unknown\"}')",[metricId]),false);
// Free list claim, uncertain creation recovery, and idempotent batch synchronization.
let claim=await val('select icash_claim_research_exclusions()');assert.equal(claim.action,'create');
assert.equal(await val('select icash_claim_research_exclusions()'),null);
await q("select icash_finish_research_exclusions($1,'{\"ok\":false,\"unstarted\":true}')",[claim.token]);
await db.exec("update icash_research_private.exclusions set next_at=now()");claim=await val('select icash_claim_research_exclusions()');assert.equal(claim.action,'create');
await q("select icash_finish_research_exclusions($1,'{\"ok\":false}')",[claim.token]);
await db.exec("update icash_research_private.exclusions set next_at=now()");claim=await val('select icash_claim_research_exclusions()');assert.equal(claim.action,'recover','Ambiguous create is never repeated');
assert.equal(await val('select icash_finish_research_exclusions($1,$2)',[claim.token,{ok:true,listId:'fixture-list',name:claim.name}]),true);
await q("insert into icash_outbound_property_owners values('prop_999',$1,now())",[account]);
await db.exec("update icash_research_private.exclusions set next_at=now()");claim=await val('select icash_claim_research_exclusions()');assert.deepEqual(claim.ids,['prop_999']);
assert.equal(await val('select icash_finish_research_exclusions($1,$2)',[claim.token,{ok:true,listId:'fixture-list',ids:[]}]),false);
assert.equal(await val('select icash_finish_research_exclusions($1,$2)',[claim.token,{ok:true,listId:'fixture-list',ids:claim.ids}]),true);
await prepare(account);c=(await q('select * from icash_discovery_configs where account_id=$1',[account])).rows[0];assert.equal(c.research_list_id,'fixture-list');
await q('select icash_discovery_filter_state_v2($1,$2,1)',[account,c.revision]);
const scope={p_zip:c.zip,p_revision:c.revision,p_page:1,p_per_page:25,p_rate:c.rate_id,p_unit:10000,p_permission_until:'2099-01-01',p_setup_revision:null,p_market_mode:null,p_market:null};
const policy={version:'research-efficiency-v1',exclusionListId:'fixture-list'};
assert.equal(await val('select icash_reserve_research_discovery($1,$2,$3,$4)',[account,scope,plan(),{...policy,exclusionListId:'wrong'}]),false);
assert.equal(await val('select icash_reserve_research_discovery($1,$2,$3,$4)',[account,scope,plan(),policy]),true);
assert.equal(await prepare(account),false,'An in-flight/unknown purchase freezes its config');
const searchOp='discovery:'+account+':'+c.revision+':1';
const result={queryPolicy:policy,filterPlan:plan(),rows:Array.from({length:25},(_,i)=>({dm_property_id:'prop_'+(i+1),full_address:'Synthetic',state:'TX',zip:'75217'})),creditsUsed:25,peopleCredits:0,estimatedCredits:25,hasNextPage:true,fetchedAt:new Date().toISOString()};
await assert.rejects(val('select icash_save_research_discovery($1,$2,$3,1,$4)',[account,searchOp,c.revision,{...result,queryPolicy:{...policy,exclusionListId:null}}]),/mismatch/);
assert.equal(await val('select icash_save_research_discovery($1,$2,$3,1,$4)',[account,searchOp,c.revision,result]),25);
assert.equal(await val("select next_page from icash_discovery_filter_cursors where account_id=$1 and revision=$2 and strategy='baseline'",[account,c.revision]),1,'Mutable exclusion list always consumes its first remaining page');
assert.equal(await val('select provider_page from icash_discovery_inventory_receipts where operation_key=$1',[searchOp]),1);
assert.equal(await val("select icash_known_assigned_discovery_page('75217','baseline',1,25)"),null,'New query receipts cannot contaminate old-query cache');
assert.equal(await val('select count(*)::int from icash_research_private.exclusion_items where synced_at is null'),25);
// Same-account batch reservations are atomic and preserve the original paid receipt.
let batch=uuid(80);
const rights='2099-01-01T00:00:00Z',jobs=[101,102,103].map(n=>({screeningId:uuid(n),snapshot:{propertyId:'prop_'+n,propertyType:'house',fetchedAt:new Date().toISOString(),sellerCostReserveCents:100000,raw:{data:{dm_property_id:'prop_'+n,full_address:'Synthetic',state:'TX',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}}}}));
for(const j of jobs)await q("insert into icash_screening_jobs(id,account_id,event_key,snapshot,result,state,completed_at) values($1,$2,$3,$4,$5,'complete',now())",[j.screeningId,account,'batch-fixture:'+j.screeningId,j.snapshot,runScreeningJob(j.snapshot)]);
assert.equal((await val('select icash_owner_batch_candidates($1,$2)',[account,jobs[0].screeningId])).length,3);
const preview={data:jobs.map((j,i)=>({dm_property_id:j.snapshot.propertyId,found:true,contacts:[{dm_person_id:'per_shared',contact_type:'owner'},{dm_person_id:'per_'+i,contact_type:'owner'}]})),totals:{submitted:3,found:3,not_found:0},credits:{used:0,people:0,properties:0,deduplicated:0}};
const audience=ownerBatchAudience(preview,jobs,25),items=audience.map(a=>({screeningId:a.screeningId,snapshot:a.snapshot,ids:[...a.ids]}));
const conf={rateId:ownerRate,creditCap:25,unitCostMicros:10000,rightsUntil:rights};
const claimBatch=(a=account,entries=items)=>val('select icash_claim_owner_batch($1,$2,$3,$4,$5,$6)',[a,jobs[0].screeningId,batch,entries,preview,conf]);
assert.equal(await claimBatch(other),false,'Foreign account cannot claim this batch');
await q("insert into icash_property_controls(account_id,property_id,manual) values($1,'prop_102',true)",[account]);
await assert.rejects(claimBatch(),/admission held/);
assert.equal(await val("select count(*)::int from icash_operation_spend where operation_key like 'owners:%'"),0,'Failed sibling admission rolls back every reservation');
await q("update icash_property_controls set manual=false where account_id=$1 and property_id='prop_102'",[account]);
assert.equal(await val('select used from icash_dealmachine_request_budget where id=1'),1,'A failed claim rolls back its request slot too');
await db.exec('update icash_dealmachine_request_budget set used=2 where id=1');
assert.equal(await val('select icash_admit_owner_batch($1,$2,$3,$4,$5,$6)',[account,jobs[0].screeningId,batch,items,preview,conf]),'quota_wait','Exhausted capacity is a proven unstarted deferral');
assert.equal(await val("select count(*)::int from icash_operation_spend where operation_key like 'owners:%'"),0,'A definite quota refusal preserves all budgets');
// A fresh invocation receives a fresh one-use UUID; the original diagnostic stays.
batch=uuid(81);
await db.exec('update icash_dealmachine_request_budget set used=1 where id=1');
assert.equal(await claimBatch(),true);assert.equal(await claimBatch(),false,'Batch is one-use');
assert.equal(await val('select used from icash_dealmachine_request_budget where id=1'),2,'A successful batch owns exactly one paid request slot');
assert.deepEqual(await val('select icash_owner_batch_candidates($1,$2)',[account,jobs[0].screeningId]),[],'Claimed/unknown work never reaches another purchase');
const ids=[...new Set(audience.flatMap(a=>a.ids))],paid={data:ids.map(id=>({dm_person_id:id,found:true,phones:[]})),totals:{submitted:4,found:4,not_found:0},credits:{used:2,people:4,properties:0,deduplicated:2}};
assert.equal(await val('select icash_record_owner_batch_receipt($1,$2,$3)',[other,batch,paid]),false);
assert.equal(await val('select icash_record_owner_batch_receipt($1,$2,$3)',[account,batch,paid]),true);
assert.equal(await val('select icash_record_owner_batch_receipt($1,$2,$3)',[account,batch,{...paid,credits:{...paid.credits,used:3}}]),false,'Original receipt is immutable');
const allocated=allocateOwnerBatch(paid,audience,batch),bad=structuredClone(allocated);bad[0].result.creditsUsed=0;bad[0].result.providerCredits.used=0;bad[0].result.providerCredits.deduplicated=2;
await assert.rejects(val('select icash_save_owner_batch($1,$2,$3)',[account,batch,bad]),/original receipt/);
assert.equal(await val('select count(*)::int from icash_owner_contacts'),0,'A bad allocation cannot partially persist contacts or charges');
assert.equal(await val('select icash_save_owner_batch($1,$2,$3)',[account,batch,allocated]),true);
assert.equal(await val('select icash_save_owner_batch($1,$2,$3)',[account,batch,allocated]),true,'Exact persistence replay is idempotent');
assert.equal(await val("select count(*)::int from icash_operation_spend where operation_key like 'owners:%' and state='settled'"),3);
assert.equal(Number(await val("select sum(amount) from icash_cost_observations where event_key like 'owners:%' and event_key not like '%:people' and event_key not like '%:properties' and event_key not like '%:deduplicated'")),2,'Allocated charges sum to the original two credits, including shared owners');
assert.equal((await val('select icash_research_efficiency_summary(24)')).ownerBatches,1);
assert.equal(await val("select has_function_privilege('authenticated','public.icash_owner_batch_candidates(uuid,uuid)','EXECUTE')"),false);
assert.equal(await val("select has_schema_privilege('authenticated','icash_research_private','USAGE')"),false);
// Version upgrades rotate only unclaimed configurations. Original policy and
// provider receipts remain intact, including additive free-preview metadata.
await db.exec(read('config/research-provider-compatibility.sql'));
assert.equal(await prepare(account),false,'The v1 unknown search is still frozen after installing v2');
assert.equal(await val('select research_version from icash_discovery_configs where account_id=$1',[account]),1);
await q('select icash_settle_dealmachine_usage($1)',[searchOp]);
assert.equal(await prepare(account),true);
const upgraded=(await q('select * from icash_discovery_configs where account_id=$1',[account])).rows[0];
assert.equal(upgraded.research_version,2);assert.notEqual(upgraded.revision,c.revision);assert.equal(upgraded.per_page,25);
assert.deepEqual(await val('select policy from icash_research_private.query_claims where operation_key=$1',[searchOp]),policy);
await q('update icash_research_private.exclusion_items set synced_at=now()');
await q('select icash_discovery_filter_state_v2($1,$2,1)',[account,upgraded.revision]);
const v2scope={...scope,p_revision:upgraded.revision,p_rate:upgraded.rate_id},v2policy={...policy,version:'research-efficiency-v2'};
assert.equal(await val('select icash_reserve_research_discovery($1,$2,$3,$4)',[account,v2scope,plan(),policy]),false,'Old policy cannot purchase against a new revision');
assert.equal(await val('select icash_reserve_research_discovery($1,$2,$3,$4)',[account,v2scope,plan(),v2policy]),true);
await q('update icash_accounts set bot_paused=false where id=$1',[other]);await q('update icash_wallets set balance_cents=2500 where account_id=$1',[other]);await prepare(other);
const extraJob={...jobs[0],screeningId:uuid(150),snapshot:{...jobs[0].snapshot,propertyId:'prop_150',raw:{data:{...jobs[0].snapshot.raw.data,dm_property_id:'prop_150'}}}};
await q("insert into icash_screening_jobs(id,account_id,event_key,snapshot,result,state,completed_at) values($1,$2,'additive-preview',$3,$4,'complete',now())",[extraJob.screeningId,other,extraJob.snapshot,runScreeningJob(extraJob.snapshot)]);
const extraPreview={data:[{dm_property_id:'prop_150',found:true,contacts:[{dm_person_id:'per_extra',contact_type:'owner'}]}],totals:{submitted:1,found:1,not_found:0},credits:{used:0,people:0,properties:0,deduplicated:0,additional_metadata:'allowed'}};
const extraItems=[{screeningId:extraJob.screeningId,snapshot:extraJob.snapshot,ids:['per_extra']}];
// Keep the original empty property in the raw preview, but use the surviving
// property's ID for the real admission. Only that property can be charged.
const emptyJob={...extraJob,screeningId:uuid(153),snapshot:{...extraJob.snapshot,propertyId:'prop_153',raw:{data:{...extraJob.snapshot.raw.data,dm_property_id:'prop_153'}}}};
await q("insert into icash_screening_jobs(id,account_id,event_key,snapshot,result,state,completed_at) values($1,$2,'empty-primary-preview',$3,$4,'complete',now())",[emptyJob.screeningId,other,emptyJob.snapshot,runScreeningJob(emptyJob.snapshot)]);
extraPreview.data.unshift({dm_property_id:'prop_153',found:true,contacts:[{dm_person_id:'per_empty',contact_type:'owner',availability:{phones:0}}]});
extraPreview.totals={submitted:2,found:2,not_found:0};
await db.exec('update icash_dealmachine_request_budget set used=0');
assert.equal(await val('select icash_admit_owner_batch($1,$2,$3,$4,$5,$6)',[other,extraJob.screeningId,uuid(151),extraItems,{...extraPreview,credits:{...extraPreview.credits,used:1}},conf]),'held');
assert.equal(await val('select icash_admit_owner_batch($1,$2,$3,$4,$5,$6)',[other,extraJob.screeningId,uuid(152),extraItems,extraPreview,conf]),'claimed');
assert.deepEqual(await val('select preview_receipt from icash_research_private.owner_batches where id=$1',[uuid(152)]),extraPreview);
assert.equal(await val("select count(*)::int from icash_operation_spend where operation_key=$1",['owners:'+emptyJob.screeningId]),0,'The original empty property has no purchase');
await (await import('./helpers/stalled-search-scenarios.mjs')).stalledSearchScenarios(db,account,other);
console.log('Research efficiency SQL: versioned quotes, budget fallback, frozen claims, exclusions, pagination, atomic owner batches, exact billing allocation and isolation passed.');
}finally{await db.close();}
