// Isolated PostgreSQL, synthetic rows, no provider requests or production writes.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
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
await q("insert into icash_accounts(id,owner_user_id,assistant_name,bot_paused) values($1,$1,'Fixture',false),($2,$2,'Other',false),($3,$3,'Restricted',false)",[account,other,uuid(5)]);
await db.exec("insert into icash_operating_budget(id,enabled) values(1,true);insert into icash_market_shortlist values('75217','TX','Dallas');update icash_discovery_filter_settings set enabled=true;");
await q("insert into icash_operation_rates(id,operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) values($1,'property_search','fixture',50,'{}','SYNTHETIC',now(),now()+interval '10 days',true)",[rate]);
for(const a of [account,other,uuid(5)]){
 await q("insert into icash_wallets(account_id,balance_cents) values($1,2500)",[a]);
 await q("insert into icash_discovery_configs(account_id,enabled,auto_enabled,zip,rate_id,property_credit_micros,data_rights_until,seller_cost_reserve_cents,next_page,revision) values($1,true,true,'75217',$2,10000,'2099-01-01',0,1,$3)",[a,rate,revision]);
 await q('insert into icash_prospecting_budgets values($1,$2,2500,1250,now())',[a===account?1:a===other?2:3,a]);
 await q('select icash_discovery_filter_state_v2($1,$2,1)',[a,revision]);
}
const op=(a,p)=>'discovery:'+a+':'+revision+':'+p;
const claim=(a,sequence,providerPage,strategy='baseline')=>val("select icash_reserve_and_claim_filtered_discovery($1,'75217',$2,$3,5,$4,10000,'2099-01-01',null,null,null,$5)",[a,revision,sequence,rate,plan(strategy,providerPage)]);
const prepare=(a,p)=>val('select icash_prepare_discovery_inventory($1,$2,$3)',[a,revision,p]);
const rows=Array.from({length:5},(_,i)=>({dm_property_id:'prop_'+(i+1),full_address:'Synthetic '+i,state:'TX',zip:'75217'}));
const save=(a,p,providerPage,properties=rows)=>val('select icash_save_filtered_discovery($1,$2,$3,$4,$5)',[a,op(a,p),revision,p,{filterPlan:plan('baseline',providerPage),rows:properties,creditsUsed:0,peopleCredits:0,estimatedCredits:5,hasNextPage:true,fetchedAt:new Date().toISOString()}]);
const reserveCredit=async(a,p)=>{
 const id=await val('select credit_reservation_id from icash_operation_spend where operation_key=$1',[op(a,p)]);
 await q("insert into icash_credit_reservations(id,account_id,operation_key,amount_cents,status) values($1,$2,$3,50,'reserved')",[id,a,op(a,p)]);
 await q('update icash_operation_spend set prospecting_budget_id=$2 where operation_key=$1',[op(a,p),a===account?1:a===other?2:3]);
};
const settle=async(a,p)=>{await reserveCredit(a,p);await q("select icash_finish_credit($1,$2,6,'Synthetic complete receipt')",[a,op(a,p)]);await q("update icash_operation_spend set state='settled',charged_cents=6,actual_micros=40000,settled_at=now() where operation_key=$1",[op(a,p)]);};
assert.equal(await claim(account,1,1),true);
assert.equal(await claim(other,1,1),false,'Identical unknown provider page cannot dispatch twice');
assert.equal(await save(account,1,1),5);await settle(account,1);
assert.equal(Number(await val('select balance_cents from icash_wallets where account_id=$1',[account])),2494,'New property work keeps its normal charge');
await q("insert into icash_usage_coverage(operation_key,account_id,gross_cents,customer_cents,covered_cents,evidence_ref) values($1,$2,6,4,2,'Synthetic unrelated coverage')",[op(account,1),account]);
assert.equal(Number(await val('select icash_prospecting_available($1)',[account])),494,'Unrelated coverage does not alter the established search allowance');
assert.equal(await prepare(other,1),'ready');
assert.equal(Number(await val("select next_page from icash_discovery_filter_cursors where account_id=$1 and strategy='baseline'",[other])),2,'Known assigned page skipped without a provider request');
assert.equal(Number(await val('select count(*) from icash_operation_spend where account_id=$1',[other])),0);
assert.equal(Number(await val('select count(*) from icash_screening_jobs where account_id=$1',[other])),0,'Other customer gets no copied leads');
assert.equal(await claim(other,1,1),false,'Final claim repeats the occupied-page check');
assert.equal(await claim(other,1,2),true);
assert.equal(await save(other,1,2),0,'Overlapping unknown page produces no fake research');
await settle(other,1);
assert.equal(Number(await val('select balance_cents from icash_wallets where account_id=$1',[other])),2500,'Duplicate page costs are covered in the settlement transaction');
assert.equal(Number(await val('select sum(delta_cents) from icash_credit_ledger where account_id=$1',[other])),0);
assert.equal(Number(await val('select icash_prospecting_available($1)',[other])),500,'Duplicate charge does not consume paced allowance');
assert.equal(Number(await val('select icash_customer_discovery_charge($1,$2,6)',[account,op(other,1)])),6,'A different account cannot use the paired coverage');
for(const role of ['anon','authenticated'])assert.equal(await val("select has_table_privilege($1,'public.icash_duplicate_discovery_coverage','select')",[role]),false);
assert.equal(Number(await val('select icash_credit_duplicate_discovery($1,$2)',[other,op(other,1)])),0,'Already covered work cannot credit twice');
await q("select icash_finish_credit($1,$2,6,'Synthetic complete receipt')",[other,op(other,1)]);
assert.equal(Number(await val('select count(*) from icash_usage_coverage where account_id=$1',[other])),1,'Settlement replay remains idempotent');
await q('update icash_accounts set bot_paused=true where id=$1',[other]);assert.equal(await prepare(other,2),'inventory_held');await q('update icash_accounts set bot_paused=false where id=$1',[other]);
for(let p=2;p<=3;p++){assert.equal(await claim(other,p,p+1),true);assert.equal(await save(other,p,p+1),0);await settle(other,p);}
await q("insert into icash_property_zip_geographies(zip,state_code,name,property_count,checked_at,expires_at) values('75001','TX','Synthetic market',2000,now(),now()+interval '10 days')");
await q('update icash_discovery_configs set inventory_refreshed_at=null where account_id=$1',[other]);
assert.equal(await prepare(other,4),'inventory_market_changed');
assert.equal(await val('select zip from icash_discovery_configs where account_id=$1',[other]),'75001','Unproductive account moves to a wider verified ZIP');
assert.equal(Number(await val('select balance_cents from icash_wallets where account_id=$1',[other])),2500);
assert.equal(Number(await val("select count(*) from icash_inventory_markets where account_id=$1 and zip='75217' and next_scan_at>now()",[other])),0,'Missing original inventory row is not invented by a retry');
// A genuine historical duplicate correction preserves its original debit and cost.
const legacy='discovery:'+uuid(5)+':'+revision+':1';
await q("update icash_discovery_filter_cursors set next_page=8 where account_id=$1 and strategy='baseline'",[uuid(5)]);
assert.equal(await claim(uuid(5),1,8),true);assert.equal(await save(uuid(5),1,8),0);await reserveCredit(uuid(5),1);
await q("update icash_operation_spend set state='settled',charged_cents=6,actual_micros=40000,settled_at=now() where operation_key=$1",[legacy]);
await q("update icash_credit_reservations set status='settled',settled_cents=6 where operation_key=$1",[legacy]);
await q("insert into icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref) values($1,$2,'usage',-6,'Synthetic historical duplicate')",[uuid(5),'usage:'+legacy]);
await q('update icash_wallets set balance_cents=2494 where account_id=$1',[uuid(5)]);
assert.equal(Number(await val('select icash_credit_duplicate_discovery($1,$2)',[account,legacy])),0,'Wrong account cannot receive another customer correction');
assert.equal(Number(await val('select icash_credit_duplicate_discovery($1,$2)',[uuid(5),legacy])),6);
assert.equal(Number(await val('select icash_credit_duplicate_discovery($1,$2)',[uuid(5),legacy])),0);
assert.equal(Number(await val('select actual_micros from icash_operation_spend where operation_key=$1',[legacy])),40000,'Historical cost preserved');
assert.equal(Number(await val('select delta_cents from icash_credit_ledger where event_key=$1',['usage:'+legacy])),-6);
assert.equal(Number(await val('select balance_cents from icash_wallets where account_id=$1',[uuid(5)])),2500);
// Metadata changes cannot widen a saved explicit customer ZIP.
await q("insert into icash_bot_setups(account_id,guest_hash,variant,profile) values($1,repeat('e',64),'ownership','{\"marketMode\":\"city\",\"market\":\"75217\"}')",[uuid(5)]);
assert.equal(Number(await val('select icash_expand_inventory_markets($1)',[uuid(5)])),0);
await db.exec("insert into icash_inventory_geography_sources(state_code) values('TX') on conflict do nothing");
const geography=await val('select icash_claim_inventory_geographies()');
const location={type:'zip_code',location_id:'loc_zip_code_75002',code:'75002',state:geography.state,name:'Synthetic ZIP',property_count:1200};
const result={data:[location],pagination:{page:geography.page,total_pages:2}};
await assert.rejects(val('select icash_save_inventory_geographies($1,$2,$3,$4)',[geography.state,geography.page,geography.token,{...result,data:[{...location,state:'XX'}]}]),/Invalid ZIP metadata/);
assert.equal(Number(await val('select icash_save_inventory_geographies($1,$2,$3,$4)',[geography.state,geography.page,uuid(99),result])),0);
assert.equal(Number(await val('select icash_save_inventory_geographies($1,$2,$3,$4)',[geography.state,geography.page,geography.token,result])),1);
assert.equal(Number(await val('select icash_save_inventory_geographies($1,$2,$3,$4)',[geography.state,geography.page,geography.token,result])),0,'Free metadata replay cannot reuse the claim');
for(const role of ['anon','authenticated'])for(const name of ['icash_prepare_discovery_inventory(uuid,uuid,integer)','icash_credit_duplicate_discovery(uuid,text)','icash_save_inventory_geographies(text,integer,uuid,jsonb)'])assert.equal(await val("select has_function_privilege($1,$2,'execute')",[role,name]),false);
console.log('Unique inventory: exclusive assignment preflight, pending-page serialization, duplicate coverage and correction, unchanged normal billing, net paced budget, ZIP rotation, metadata claims and tenant restrictions passed.');
}finally{await db.close();}
