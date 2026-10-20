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
const sql=read('config/daily-prospecting-quarter-and-vip-savings.sql');
const section=name=>sql.split('-- BEGIN '+name+'\n')[1].split('-- END '+name)[0];
const before=await val("select jsonb_agg(to_jsonb(b)) from icash_prospecting_budgets b");
const guard=await val("select pg_get_functiondef('icash_guard_prospecting_spend()'::regprocedure)");
for(const name of ['icash_prospecting_available','icash_prospecting_released','icash_prospecting_progress'])await db.exec(section(name));
assert.deepEqual(await val('select jsonb_agg(to_jsonb(b)) from icash_prospecting_budgets b'),before);
assert.equal(await val("select pg_get_functiondef('icash_guard_prospecting_spend()'::regprocedure)"),guard);
for(const [balance,starter] of [[1000,250],[10000,500],[50000,2500],[100000,5000]]){
 assert.equal(Number(await val('select icash_prospecting_released($1,now())',[balance])),starter,'initial spike remains immediate and fits daily cap');
 assert.equal(Number(await val("select icash_prospecting_released($1,now()-interval '24 hours')",[balance])),Math.floor(balance/2));
}
assert.equal(Number(await val('select icash_prospecting_released(101,now())')),25,'odd/small balance rounds daily cap down');
const available=async()=>Number(await val('select icash_prospecting_available($1)',[account]));
const reserve=key=>val("select icash_reserve_before_fractional($1,$2,$3,now()+interval '1 day',now(),true)",[account,key,rate]);
assert.equal(await available(),500);
await reserve('discovery:daily-quarter:first');
await assert.rejects(reserve('discovery:daily-quarter:burst'),/Prospecting budget reached/);
assert.equal(Number(await val('select balance_cents from icash_wallets where account_id=$1',[account])),5000,'reservation is not a debit');
await q("update icash_operation_spend set state='settled',charged_cents=1250,settled_at=now()-interval '2 hours' where operation_key='discovery:daily-quarter:first'");
await q("update icash_prospecting_budgets set created_at=now()-interval '2 days' where account_id=$1",[account]);
assert.equal(await available(),0,'25% rolling day overrides a fully matured 50% allowance');
await assert.rejects(reserve('discovery:daily-quarter:overday'),/Prospecting budget reached/);
await q("update icash_operation_spend set settled_at=now()-interval '23 hours 59 minutes' where operation_key='discovery:daily-quarter:first'");
assert.equal(await available(),0,'midnight is not a new spending window');
await q("update icash_operation_spend set settled_at=now()-interval '24 hours 1 minute' where operation_key='discovery:daily-quarter:first'");
assert.equal(await available(),500,'rolling release resumes small batches');
await reserve('discovery:daily-quarter:unknown');
await q("update icash_operation_spend set state='dispatched',dispatched_at=now()-interval '2 days' where operation_key='discovery:daily-quarter:unknown'");
await q("select icash_post_credit($1,'funding:daily-quarter','purchase',1000,'SYNTHETIC')",[account]);
assert.equal(await available(),0,'old unknown holds survive time and new funding');
const funded=await val('select to_jsonb(b) from icash_prospecting_budgets b where account_id=$1 order by id desc limit 1',[account]);
await q("select icash_post_credit($1,'funding:daily-quarter','purchase',1000,'SYNTHETIC')",[account]);
assert.deepEqual(await val('select to_jsonb(b) from icash_prospecting_budgets b where account_id=$1 order by id desc limit 1',[account]),funded,'funding retry cannot reset allowance');
await q("update icash_operation_spend set state='cancelled' where operation_key='discovery:daily-quarter:unknown'");
assert.equal(await available(),500);
const progress=await val('select icash_prospecting_progress($1)',[account]);
assert.equal(progress.dailyPercent,25);assert.equal(progress.dailyLimitCents,1500);assert.equal(progress.hourlyLimitCents,500);assert.equal(progress.pacingHours,24);
assert.equal((await val('select icash_prospecting_progress($1)',[other])).status,'paused');
// Freeze historical and unresolved operation prices across the VIP cutover.
const pricesBefore=await val('select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o');
await db.exec(section('icash_reserve_before_fractional'));
await db.exec(section('icash_vip_savings'));
assert.deepEqual(await val('select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o'),pricesBefore);
await db.exec('create or replace function icash_vip_active(uuid) returns boolean language sql as $$select true$$;');
await reserve('discovery:daily-quarter:vip');
assert.deepEqual((await q("select standard_cost_multiplier,elevenlabs_cost_multiplier,dealmachine_cost_multiplier from icash_operation_spend where operation_key='discovery:daily-quarter:vip'")).rows[0],{standard_cost_multiplier:'1.4',elevenlabs_cost_multiplier:'1.4',dealmachine_cost_multiplier:'2.1'});
await reserve('discovery:daily-quarter:vip');
await q("update icash_operation_spend set state='dispatched',dispatched_at=now() where operation_key='discovery:daily-quarter:vip'");
await q("insert into icash_discovery_results values('discovery:daily-quarter:vip',$1,'{\"creditsUsed\":10}',now())",[account]);
await q("insert into icash_cost_observations(provider,event_key,source_ref,amount,units) values('dealmachine','discovery:daily-quarter:vip','dealmachine:search:discovery:daily-quarter:vip',10,'provider_credits')");
assert.equal(await val("select icash_settle_dealmachine_usage('discovery:daily-quarter:vip')"),true);
assert.equal(Number(await val("select charged_cents from icash_operation_spend where operation_key='discovery:daily-quarter:vip'")),21,'30 Standard cents becomes 21 VIP cents');
assert.equal(Number(await val('select icash_vip_savings($1)',[account])),9,'only completed verified savings count');
assert.equal(Number(await val('select icash_vip_savings($1)',[other])),0,'account binding');
// Historical 20% evidence is still valued at its original actual savings.
await q("update icash_operation_spend set standard_cost_multiplier=1.6,elevenlabs_cost_multiplier=1.6,dealmachine_cost_multiplier=2.4,charged_cents=24 where operation_key='discovery:daily-quarter:vip'");
assert.equal(Number(await val('select icash_vip_savings($1)',[account])),6);
await q("update icash_operation_spend set charged_cents=1 where operation_key='discovery:daily-quarter:vip'");
assert.equal(Number(await val('select icash_vip_savings($1)',[account])),0,'unsupported prices never become invented savings');
// The question price is snapshotted once, with the new allowed multiplier.
await db.exec("create table icash_workspace_questions(id uuid primary key,account_id uuid,state text);alter table icash_question_usage drop constraint icash_question_usage_multiplier_check;alter table icash_question_usage add constraint icash_question_usage_multiplier_check check(multiplier in(3,2.4,2,1.6,1.4));");
const baseline=JSON.parse(read('tests/fixtures/vip-thirty-policy-baseline.json'));
await db.exec(baseline.find(x=>x.proname==='icash_reserve_question').definition);
await db.exec(section('icash_reserve_question'));
await q("insert into icash_workspace_questions values($1,$2,'pending')",[uuid(201),account]);
assert.equal(await val("select icash_reserve_question($1,$2,'gpt-4.1-mini')",[account,uuid(201)]),true);
assert.equal(Number(await val('select multiplier from icash_question_usage where question_id=$1',[uuid(201)])),1.4);
assert.equal(await val("select icash_reserve_question($1,$2,'gpt-4.1-mini')",[account,uuid(201)]),false);
// Execute the production reception binding with only downstream receipt validation
// stubbed: the price snapshot must match Standard, historical VIP, or new VIP.
await db.exec(`create schema icash_recorded_reception_private;
create table icash_recorded_reception_private.sessions(id uuid,cost_policy_snapshot jsonb,cost_policy_id uuid,account_id uuid,rate_id uuid,rate_snapshot jsonb,standard_cost_multiplier numeric,elevenlabs_cost_multiplier numeric,pricing_policy jsonb,start_claimed_at timestamptz,register_claimed_at timestamptz);
create function icash_recorded_reception_private.validate_cost_review(uuid,jsonb,jsonb) returns void language sql as $$select$$;`);
await db.exec(baseline.find(x=>x.proname==='automatic_components').definition);
await db.exec(section('automatic_components'));
const sessionId=uuid(202),policyId=uuid(203);
await q(`insert into icash_recorded_reception_private.sessions values($1,$2,$3,$4,$5,'{}',1.4,1.4,null,null,null)`,[sessionId,{id:policyId,account_id:account,rate_id:rate,rate_snapshot:{},standard_cost_multiplier:2,elevenlabs_cost_multiplier:2,components:{}},policyId,account,rate]);
for(const mult of [1.4,1.6,2]){
 await q('update icash_recorded_reception_private.sessions set standard_cost_multiplier=$1,elevenlabs_cost_multiplier=$1',[mult]);
 assert.deepEqual(await val("select icash_recorded_reception_private.automatic_components(s,'{}') from icash_recorded_reception_private.sessions s"),{});
}
await q('update icash_recorded_reception_private.sessions set standard_cost_multiplier=1.2,elevenlabs_cost_multiplier=1.2');
await assert.rejects(val("select icash_recorded_reception_private.automatic_components(s,'{}') from icash_recorded_reception_private.sessions s"),/Frozen standing policy binding required/);
// Flat SMS uses the immutable retail snapshot, not a second discount on retries.
await db.exec(`create function icash_reserve_before_vip(p_account uuid,p_operation text,p_rate uuid,p_permission_until timestamptz,p_financial_checked_at timestamptz,p_financial_eligible boolean) returns jsonb language plpgsql as $$begin
 insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,permission_until,customer_price_micros,standard_cost_multiplier,elevenlabs_cost_multiplier) values(p_operation,p_account,p_rate,gen_random_uuid(),10,10000,p_permission_until,100000,1,1);return '{}'::jsonb;end$$;`);
await db.exec(baseline.find(x=>x.proname==='icash_reserve_operation').definition);
await db.exec(section('icash_reserve_operation'));
const textId=uuid(204),textRate=uuid(205),key='text:'+textId;
await q("insert into icash_operation_rates select $1,'sms_send','fixture-flat',10,costs_micros,0,evidence_ref,verified_at,expires_at,enabled,null,10 from icash_operation_rates where id=$2",[textRate,rate]);
await q("insert into icash_text_messages(id,account_id,direction,state,customer_price_micros) values($1,$2,'outgoing','accepted',100000)",[textId,account]);
const sms=()=>val("select icash_reserve_operation($1,$2,$3,now()+interval '1 day',now(),true)",[account,key,textRate]);
await sms();assert.equal(Number(await val('select customer_price_micros from icash_operation_spend where operation_key=$1',[key])),70000);
await sms();assert.equal(Number(await val('select customer_price_micros from icash_operation_spend where operation_key=$1',[key])),70000);
await q("update icash_operation_spend set state='settled',settled_at=now(),charged_cents=7,actual_micros=10000 where operation_key=$1",[key]);
await q("insert into icash_fractional_usage(operation_key,account_id,price_micros,charged_cents) values($1,$2,70000,7)",[key,account]);
assert.equal(Number(await val('select icash_vip_savings($1)',[account])),3,'10 cent Standard SMS minus proven 7 cent VIP price');
for(const role of ['anon','authenticated'])for(const fn of ['icash_prospecting_available(uuid)','icash_prospecting_released(bigint,timestamptz)','icash_prospecting_progress(uuid)'])assert.equal(await val("select has_function_privilege($1,$2,'execute')",[role,fn]),false);
// Every guarded forward edit must match the captured production boundary exactly;
// unrelated admission, provider, consent, pricing and idempotency code is retained.
for(const item of baseline.filter(x=>x.proname!=='icash_vip_savings')){
 let definition=item.definition;
 const edits=[...section(item.proname).matchAll(/d:=replace\(d,\$old\$([\s\S]*?)\$old\$,\$new\$([\s\S]*?)\$new\$\);/g)];
 assert(edits.length>0,item.proname);
 for(const [,old,next] of edits){assert(definition.includes(old),item.proname);definition=definition.replaceAll(old,next);}
 if(item.proname==='automatic_components')assert(definition.includes('numeric*0.8')&&definition.includes('numeric*0.7'),'both old and new frozen reception discounts settle');
 else assert(!definition.includes('0.8'),item.proname+' has no old admission discount');
}
assert.equal(sql,read('supabase/migrations/20261020161024_daily_prospecting_quarter_and_vip_savings.sql'));
console.log('PASS 25% rolling day with immediate spike, hourly pacing, top-up/idempotency/unknown holds/Pause; actual VIP 30% prices, historical savings and private ACLs. Local fixtures only.');
}catch(error){console.error(error.message);console.error(error.query??'');process.exitCode=1;}finally{await db.close();}
