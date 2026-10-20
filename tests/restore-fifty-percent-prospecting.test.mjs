import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const db=new PGlite();
const q=(sql,args=[])=>db.query(sql,args);
const val=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const uuid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=uuid(1),other=uuid(2),rate=uuid(3);
try{
await db.exec('create role anon;create role authenticated;create role service_role;');
await db.exec(read('tests/fixtures/opportunity-schema.sql'));
// Unchanged external gates are explicit fixture inputs; billing/selection/ledger
// functions under test below are their actual production implementations.
await db.exec(`
create function icash_membership_work_allowed(uuid) returns boolean language sql as $$select true$$;
create function icash_vip_active(uuid) returns boolean language sql as $$select false$$;
create function icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
create function icash_reception_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
create function icash_general_reception_pause_exempt(uuid,text,bigint) returns boolean language sql as $$select false$$;
create function icash_customer_text_operation(uuid,text) returns boolean language sql as $$select false$$;
create function icash_limited_seller_voice(uuid,text) returns boolean language sql as $$select false$$;
create function icash_cancellation_voice_current(uuid,text) returns boolean language sql as $$select false$$;
create function icash_meta_voice_context(uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;
create function icash_seller_lead_rate_multiplier(uuid,text,uuid) returns numeric language sql as $$select 2::numeric$$;
create function icash_research_state_allowed(text) returns boolean language sql as $$select $1='TX'$$;
create function icash_research_zip_known(text) returns boolean language sql as $$select $1 in ('75217','75216')$$;
create function icash_credit_acquisition_allowed(uuid) returns boolean language sql as $$select true$$;
create function icash_seller_acquisition_quote(uuid) returns jsonb language sql as $$select null::jsonb$$;
create function icash_seller_assignment_due(integer,timestamptz,timestamptz) returns timestamptz language sql as $$select now()$$;
`);
await db.exec(read('tests/fixtures/opportunity-dependencies.sql'));
await db.exec(read('supabase/migrations/20261019150042_dealmachine_usage_and_opportunity_engine.sql'));
await db.exec(read('config/opportunity-score-bounds.sql'));
await db.exec(read('tests/fixtures/prospecting-funding.sql'));
await db.exec(`create function icash_next_automation() returns jsonb language sql as $$select null::jsonb$$;
create table icash_voice_contact_targets(id uuid primary key,account_id uuid,screening_id uuid,party text);`);
await db.exec(read('tests/fixtures/prospecting-flexible-voice.sql'));
await q("insert into icash_accounts(id,owner_user_id,assistant_name,bot_paused) values($1,$1,'Fixture',false),($2,$2,'Other',true)",[account,other]);
await q('insert into icash_wallets(account_id,balance_cents) values($1,5000),($2,10000)',[account,other]);
await db.exec("insert into icash_operating_budget(id,enabled,require_company_reserve,standard_cost_multiplier,elevenlabs_cost_multiplier) values(1,true,false,2,2);insert into icash_data_cost_settings(provider,credit_micros,cost_basis,source_ref) values('dealmachine',10000,'estimated','SYNTHETIC allocation');insert into icash_acquisition_policy(id,mode) values(1,'hybrid');");
const categories=['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'];
const costs=Object.fromEntries(categories.map(k=>[k,k==='dealmachine'?100000:0]));
await q("insert into icash_operation_rates(id,operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled) values($1,'property_search','fixture-search',500,$2,0,'SYNTHETIC',now()-interval '1 day',now()+interval '1 day',true)",[rate,costs]);
await q("insert into icash_discovery_configs(account_id,enabled,zip,rate_id,property_credit_micros,data_rights_until,seller_cost_reserve_cents,max_open_prospects,next_run_at) values($1,true,'75217',$3,10000,now()+interval '1 day',0,2,now()+interval '1 day'),($2,true,'75217',$3,10000,now()+interval '1 day',0,2,now()+interval '1 day')",[account,other,rate]);
await db.exec(read('config/funded-prospecting-budget.sql'));

await db.exec(read('config/prospecting-delivery-pacing.sql'));
await db.exec(read('config/first-day-prospecting-pacing.sql'));

// Funding receipt execution has its own complete fixture in quarter-credit-terms.
// This composite type is also required when compiling the exact forward patch.
await db.exec("create table icash_funding_orders(id uuid primary key,mode text,state text,account_id uuid,guest_hash text,price_cents bigint,credit_cents bigint,auto_recharge boolean,credited_at timestamptz,prepaid_applied_at timestamptz,pacing_applied_at timestamptz,daily_plan_id uuid,billing_period_start timestamptz,paid_at timestamptz,created_at timestamptz default now());");
const baseline=JSON.parse(read('tests/fixtures/restore-fifty-percent-baseline.json'));
for(const item of baseline)await db.exec(item.definition);
for(const name of ['icash_apply_prepaid_purchase','icash_activate_auto_recharge'])await db.exec('revoke all on function '+name+' from public,anon,authenticated');
const sql=read('config/restore-fifty-percent-prospecting.sql');
const before=await val('select jsonb_agg(to_jsonb(b)) from icash_prospecting_budgets b');
const guard=await val("select pg_get_functiondef('icash_guard_prospecting_spend()'::regprocedure)");
const pricing=await val("select pg_get_functiondef('icash_reserve_before_fractional'::regproc)");
await db.exec(sql);
assert.deepEqual(await val('select jsonb_agg(to_jsonb(b)) from icash_prospecting_budgets b'),before);
assert.equal(await val("select pg_get_functiondef('icash_guard_prospecting_spend()'::regprocedure)"),guard);
assert.equal(await val("select pg_get_functiondef('icash_reserve_before_fractional'::regproc)"),pricing,'restoration never edits pricing');
for(const [balance,starter] of [[1000,500],[10000,500],[50000,2500],[100000,5000]]){
 assert.equal(Number(await val('select icash_prospecting_released($1,now())',[balance])),starter);
 assert.equal(Number(await val("select icash_prospecting_released($1,now()-interval '12 hours')",[balance])),Math.floor(balance/2));
}
assert.equal(Number(await val('select icash_prospecting_released(101,now())')),50);
assert.equal(Number(await val("select icash_prospecting_released(10000,now()-interval '6 hours')")),2750,'continuous release');
const available=async()=>Number(await val('select icash_prospecting_available($1)',[account]));
const reserve=key=>val("select icash_reserve_before_fractional($1,$2,$3,now()+interval '1 day',now(),true)",[account,key,rate]);
assert.equal(await available(),500);
await reserve('discovery:fifty:first');
await assert.rejects(reserve('discovery:fifty:burst'),/Prospecting budget reached/);
assert.equal(Number(await val('select balance_cents from icash_wallets where account_id=$1',[account])),5000,'authorization is not a debit');
await q("update icash_operation_spend set state='settled',charged_cents=1250,settled_at=now()-interval '2 hours' where operation_key='discovery:fifty:first'");
await q("update icash_prospecting_budgets set created_at=now()-interval '2 days' where account_id=$1",[account]);
assert.equal(await available(),500,'spending may continue above the previous 25% ceiling');
// A verified top-up creates a new snapshot, but recent charges still count.
await q("select icash_post_credit($1,'funding:fifty','purchase',1000,'SYNTHETIC')",[account]);
await q("update icash_prospecting_budgets set created_at=now()-interval '2 days' where account_id=$1",[account]);
await reserve('discovery:fifty:second');
await q("update icash_operation_spend set state='settled',charged_cents=1750,settled_at=now()-interval '2 hours' where operation_key='discovery:fifty:second'");
assert.equal(await available(),0,'50% of new 6000-cent baseline includes older-budget charges');
await assert.rejects(reserve('discovery:fifty:overday'),/Prospecting budget reached/);
await q("update icash_operation_spend set settled_at=now()-interval '23 hours 59 minutes' where operation_key='discovery:fifty:first'");
assert.equal(await available(),0,'midnight cannot reset the rolling day');
await q("update icash_operation_spend set settled_at=now()-interval '24 hours 1 minute' where operation_key='discovery:fifty:first'");
assert.equal(await available(),500,'expired older-budget usage releases only a small batch');
await reserve('discovery:fifty:unknown');
await q("update icash_operation_spend set state='dispatched',dispatched_at=now()-interval '2 days' where operation_key='discovery:fifty:unknown'");
await q("select icash_post_credit($1,'funding:fifty:next','purchase',1000,'SYNTHETIC')",[account]);
assert.equal(await available(),0,'unresolved authorizations survive time and top-ups');
const funded=await val('select to_jsonb(b) from icash_prospecting_budgets b where account_id=$1 order by id desc limit 1',[account]);
await q("select icash_post_credit($1,'funding:fifty:next','purchase',1000,'SYNTHETIC')",[account]);
assert.deepEqual(await val('select to_jsonb(b) from icash_prospecting_budgets b where account_id=$1 order by id desc limit 1',[account]),funded);
const progress=await val('select icash_prospecting_progress($1)',[account]);
assert.equal(progress.dailyPercent,50);assert.equal(progress.dailyLimitCents,3500);assert.equal(progress.hourlyLimitCents,500);assert.equal(progress.pacingHours,12);
assert.equal((await val('select icash_prospecting_progress($1)',[other])).status,'paused');
for(const role of ['anon','authenticated'])for(const item of baseline)assert.equal(await val("select has_function_privilege($1,$2::regproc::oid,'execute')",[role,item.proname]),false);
for(const item of baseline){
 let expected=item.definition;
 const section=sql.split('-- BEGIN '+item.proname+'\n')[1].split('-- END '+item.proname)[0];
 for(const [,old,next] of section.matchAll(/d:=replace\(d,\$old\$([\s\S]*?)\$old\$,\$new\$([\s\S]*?)\$new\$\);/g)){
  assert.equal(expected.split(old).length,2);expected=expected.replace(old,next);
 }
 assert.equal(await val('select pg_get_functiondef($1::regproc)',[item.proname]),expected,'only reviewed boundaries change');
}
console.log('PASS restored 50% rolling day, initial spike, 12-hour release, hour cap, top-ups, immutable holds, funding retries, Pause, unchanged prices and private ACLs.');
}catch(error){console.error(error.message);console.error(error.query??'');process.exitCode=1;}finally{await db.close();}
