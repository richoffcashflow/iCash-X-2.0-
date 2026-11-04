// Isolated billing simulation. Real reserve, claim, ledger and complete-cost
// SQL execute against synthetic records; no provider or production requests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {costCategories} from '../lib/cost-guard.ts';
const pg=await PGlite.create(),fixtureSql=[];
const literal=v=>v===null?'NULL':typeof v==='number'||typeof v==='boolean'?String(v):"'"+(typeof v==='string'?v:JSON.stringify(v)).replaceAll("'","''")+"'";
const execute=async s=>{fixtureSql.push(s);return pg.exec(s);};
const q=(s,a=[])=>{fixtureSql.push(s.replace(/\$(\d+)/g,(_,i)=>literal(a[Number(i)-1]))+';');return pg.query(s,a);},one=async(s,a=[])=>Object.values((await q(s,a)).rows[0])[0];
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function fn(path,name){const source=read(path),match=new RegExp(`create(?: or replace)? function public\\.${name}\\(`,'i').exec(source);assert(match,`${name} source`);const tail=source.slice(match.index),tag=/\$(?:function)?\$/.exec(tail);assert(tag);const end=tail.indexOf(tag[0],tag.index+tag[0].length)+tag[0].length;return tail.slice(0,end).replace(/^create function/i,'create or replace function')+';';}
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const account=id(1),base=id(2),gap=id(3),contact=id(4),request=id(5),refresh=id(6),phone='+12145550123',operation='dnc:'+gap;
const costs=Object.fromEntries(costCategories.map(k=>[k,k==='dealmachine'?250000:k==='support_and_overhead'?40000:0]));
const response=(used=1)=>({data:[{input:{number:phone},matched:true,do_not_call:false,phone_type:'wireless'}],totals:{submitted:1,matched:1,unmatched:0},credits:{used,people:1,deduplicated:1-used}});
async function reserve(){return one('select icash_seller_recovery_private.reserve_contact_refresh($1,$2,$3,10000)',[account,gap,base]);}
async function claim(){const r=await reserve();assert(r);await q(`insert into icash_seller_recovery_private.contact_refreshes(id,gap_id,account_id,operation_key,rate_id,unit_cost_micros,request_id,requested_at,state,original_contact_id) values($1,$2,$3,$4,$5,10000,$6,clock_timestamp(),'requested',$7)`,[refresh,gap,account,operation,r.rateId,request,contact]);assert.equal(await one('select icash_claim_operation($1)',[operation]),true);await q("insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at) values($1,'phone_dnc',$2,$3,true,now())",[request,account,operation]);return r;}
async function receipt(body=response()){await q("update icash_seller_recovery_private.contact_refreshes set response=$1,http_status=200,response_at=clock_timestamp(),state='responded' where id=$2",[body,refresh]);}
async function isolated(action){await q('begin');try{await action();}finally{await q('rollback');}}
try{
 await execute(read('tests/fixtures/account-work-repair.sql'));
 await execute(`
 create schema icash_seller_recovery_private;
 create table icash_seller_recovery_private.contact_refreshes(id uuid primary key default gen_random_uuid(),gap_id uuid unique,account_id uuid,operation_key text unique,rate_id uuid,unit_cost_micros bigint,request_id uuid,requested_at timestamptz,response jsonb,http_status integer,response_at timestamptz,state text default 'requested',original_contact_id uuid,original_snapshot jsonb,outcome text);
 create table icash_operational_contacts(id uuid primary key,account_id uuid,phone text);
 create table icash_seller_gaps(id uuid primary key,account_id uuid,reason text,state text,review_reason text,outgoing_id uuid,stage text,thread_id uuid,due_at timestamptz default now(),expires_at timestamptz default now()+interval '1 day',created_at timestamptz default now());
 create table icash_text_threads(id uuid primary key,account_id uuid,operational_contact_id uuid);
 create table icash_seller_recovery_private.contact_refresh_policy(id integer primary key,enabled boolean,activated_at timestamptz,scan_due_at timestamptz,scan_gap_id uuid);
 insert into icash_seller_recovery_private.contact_refresh_policy values(1,true,now()-interval '1 day',null,null);
 create table fixture_controls(only_gap uuid,quota_admitted boolean default true,late_current boolean default true,current_calls integer default 0,raise_for_gap uuid);
 insert into fixture_controls values(null,true,true,0,null);
 create function icash_seller_recovery_private.contact_refresh_current(uuid,uuid) returns boolean language plpgsql as $$declare n integer;begin update public.fixture_controls set current_calls=current_calls+1 returning current_calls into n;return (select (only_gap is null or only_gap=$1) and (n=1 or late_current) from public.fixture_controls);end$$;
 create function icash_sms_outreach_window_current(uuid,uuid) returns boolean language sql as $$select true$$;
 create function icash_dealmachine_capacity_available(integer) returns boolean language sql as $$select true$$;
 create function icash_seller_contact_revalidation_snapshot(uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('gap',$1,'contact',$2)$$;
 create function icash_take_dealmachine_request(p_kind text,p_account uuid,p_operation text,p_request uuid) returns boolean language plpgsql as $$declare allowed boolean;begin select quota_admitted into allowed from public.fixture_controls;insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at) values(p_request,p_kind,p_account,p_operation,allowed,clock_timestamp());return allowed;end$$;
 create table icash_data_cost_settings(provider text primary key,credit_micros bigint,cost_basis text);
 insert into icash_data_cost_settings values('dealmachine',10000,'synthetic planning estimate');
 create table icash_research_private.requests(id uuid primary key,kind text,account_id uuid,operation_key text,admitted boolean,created_at timestamptz);
 create table icash_prospecting_budgets(id bigint,account_id uuid);
 create table icash_credit_reservations(id uuid primary key default gen_random_uuid(),account_id uuid,operation_key text unique,amount_cents bigint,status text default 'reserved',settled_cents bigint);
 create table if not exists icash_usage_coverage(operation_key text primary key,account_id uuid,gross_cents bigint,customer_cents bigint,covered_cents bigint,evidence_ref text);
 create table icash_question_usage(account_id uuid,question_id uuid,state text);
 create table icash_voice_jobs(id uuid,account_id uuid);
 create table fixture_vips(account_id uuid primary key);
 alter table icash_operation_rates add primary key(id),add unique(version),alter column id set default gen_random_uuid();
 alter table icash_operation_spend alter column state set default 'reserved',alter column created_at set default now();
 alter table icash_cost_observations add primary key(provider,event_key);
 alter table icash_cost_manifests add primary key(operation_key);
 alter table icash_operating_budget add column elevenlabs_cost_multiplier numeric default 2,add column reserved_micros bigint default 0,add column spent_micros bigint default 0,add column funded_micros bigint default 1000000000,add column protected_micros bigint default 0,add column daily_limit_micros bigint default 1000000000,add column require_company_reserve boolean default true,add column hold_reason text;
 create function icash_vip_active(uuid) returns boolean language sql stable as $$select exists(select 1 from public.fixture_vips where account_id=$1)$$;
 create function icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_reception_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_limited_seller_voice(uuid,text) returns boolean language sql as $$select false$$;
 create function icash_cancellation_voice_current(uuid,text) returns boolean language sql as $$select false$$;
 create function icash_meta_voice_context(uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_general_reception_pause_exempt(uuid,text,bigint) returns boolean language sql as $$select false$$;
 create function icash_customer_text_operation(uuid,text) returns boolean language sql as $$select false$$;
 create function icash_research_waiting_on_outreach(uuid) returns boolean language sql as $$select false$$;
 create function icash_prospecting_outreach_floor(uuid) returns bigint language sql as $$select 5::bigint$$;
 create function icash_operational_phone(text) returns text language sql immutable as $$select case when regexp_replace($1,'[^0-9]','','g') ~ '^1[2-9][0-9]{9}$' then '+'||regexp_replace($1,'[^0-9]','','g') when regexp_replace($1,'[^0-9]','','g') ~ '^[2-9][0-9]{9}$' then '+1'||regexp_replace($1,'[^0-9]','','g') end$$;
 create function icash_reserve_operation(p_account uuid,p_operation text,p_rate uuid,p_permission_until timestamptz,p_financial_checked_at timestamptz default null,p_financial_eligible boolean default false) returns jsonb language plpgsql as $$begin return public.icash_reserve_before_fractional(p_account,p_operation,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible);end$$;
 create function icash_settle_estimated_operation(text) returns boolean language sql as $$select public.icash_settle_estimate_before_sms_tokens($1)$$;
 `);
 await execute(fn('config/dealmachine-three-times-usage.sql','icash_reserve_before_fractional'));
 await execute(fn('config/customer-funded-margins.sql','icash_claim_operation'));
 await execute(fn('supabase/migrations/20261008182808_available_credit_usage.sql','icash_reserve_credit'));
 await execute(fn('supabase/migrations/20261008182808_available_credit_usage.sql','icash_finish_credit'));
 await execute(fn('config/account-margin.sql','icash_settle_operation'));
 await execute(fn('config/fulfillment-completion.sql','icash_settle_complete_costs'));
 await execute(fn('supabase/migrations/20260928195902_atomic_operating_costs.sql','icash_record_cost_observation'));
 await execute(fn('config/funded-prospecting-budget.sql','icash_new_prospect_operation'));
 await execute(fn('config/seller-work-progress.sql','icash_guard_prospecting_spend'));
 await execute(fn('config/seller-work-progress.sql','icash_research_admission_quote'));
 await execute('create trigger prospecting_guard before insert on icash_operation_spend for each row execute function icash_guard_prospecting_spend()');
 // Exercise the exact read-only production predecessor bodies captured before
 // this release. The migration's source guards must match these live functions.
 const live=JSON.parse(read('tests/fixtures/seller-contact-refresh-live-preflight.json')).functions;
 for(const name of ['public.icash_reserve_before_fractional(uuid,text,uuid,timestamptz,timestamptz,boolean)','public.icash_new_prospect_operation(uuid,text,uuid)','public.icash_guard_prospecting_spend()']){
  const found=live.find(f=>f.name===name);assert(found,'Live predecessor '+name);await execute(found.definition);
 }
 await execute(read('config/seller-contact-refresh-billing.sql'));
 await execute(fn('config/seller-contact-refresh-workflow.sql','icash_claim_seller_contact_refresh'));
 await execute('revoke all on function public.icash_claim_seller_contact_refresh() from public,anon,authenticated,service_role;grant execute on function public.icash_claim_seller_contact_refresh() to service_role;grant usage on schema public,icash_seller_recovery_private to service_role;');
 await q("insert into icash_accounts(id,owner_user_id,bot_paused) values($1,$1,false)",[account]);
 await q('insert into icash_wallets(account_id,balance_cents,reserved_cents) values($1,1000,0)',[account]);
 await q('insert into icash_prospecting_budgets(id,account_id) values(1,$1)',[account]);
 await q("insert into icash_operation_rates(id,operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled) values($1,'owner_enrichment','synthetic-owner',105,$2,2000,'synthetic original reviewed costs',now()-interval '1 day',now()+interval '1 day',true)",[base,costs]);
 await q('insert into icash_discovery_configs(account_id,enabled,auto_enabled,contacts_enabled,contact_rate_id,property_credit_micros,data_rights_until) values($1,true,true,true,$2,10000,now()+interval \'1 day\')',[account,base]);
 await q("insert into icash_seller_gaps(id,account_id,reason,state,review_reason,outgoing_id,stage,thread_id) values($1,$2,'no_response','needs_review','contact_checks_expired',null,'draft',$1)",[gap,account]);
 await q('insert into icash_operational_contacts values($1,$2,$3)',[contact,account,phone]);
 await q('insert into icash_text_threads values($1,$2,$3)',[gap,account,contact]);
 if(process.argv.includes('--print-fixture')){process.stdout.write(fixtureSql.join('\n'));}else{
 assert.equal(fixtureSql.join('\n'),read('tests/fixtures/seller-contact-refresh-native.sql'),'Native concurrency fixture must match the actual migration-derived billing fixture');
 await isolated(async()=>{
  const original=await one('select to_jsonb(r) from icash_operation_rates r where id=$1',[base]),r=await claim();
  assert.equal(r.reservedMicros,60000);assert.equal(await one('select charge_cap_cents from icash_operation_spend where operation_key=$1',[operation]),14);
  assert.equal(await one('select prospecting_budget_id from icash_operation_spend where operation_key=$1',[operation]),1);
  assert.equal(await one('select dealmachine_cost_multiplier from icash_operation_spend where operation_key=$1',[operation]),'3');
  assert.equal(await reserve(),null,'one reservation per gap');assert.equal(await one('select icash_claim_operation($1)',[operation]),false,'one provider claim');
  assert.equal(await one('select icash_settle_estimated_operation($1)',[operation]),false,'unknown response stays held');
  await receipt();assert.equal(await one('select icash_settle_estimated_operation($1)',[operation]),true);
  assert.equal(await one('select charged_cents from icash_operation_spend where operation_key=$1',[operation]),11,'one data credit plus original overhead');
  assert.equal(await one('select balance_cents from icash_wallets where account_id=$1',[account]),989);
  assert.equal(await one('select icash_settle_estimated_operation($1)',[operation]),true);assert.equal(await one('select count(*) from icash_credit_ledger'),1,'idempotent actual charge');
  assert.deepEqual(await one('select to_jsonb(r) from icash_operation_rates r where id=$1',[base]),original,'original rate unchanged');
 });
 await isolated(async()=>{await claim();await receipt(response(0));assert.equal(await one('select icash_settle_estimated_operation($1)',[operation]),true);assert.equal(await one('select charged_cents from icash_operation_spend where operation_key=$1',[operation]),8,'provider-observed dedup only charges inherited overhead');});
 await isolated(async()=>{await q('insert into fixture_vips values($1)',[account]);await claim();await receipt();assert.equal(await one('select icash_settle_estimated_operation($1)',[operation]),true);assert.equal(await one('select charged_cents from icash_operation_spend where operation_key=$1',[operation]),8,'saved current VIP multipliers');});
 await isolated(async()=>{await claim();await receipt({data:[{input:{number:phone},matched:false,match_failure:'not_found'}],totals:{submitted:1,matched:0,unmatched:1},credits:{used:0,people:0,deduplicated:0}});assert.equal(await one('select icash_settle_estimated_operation($1)',[operation]),true);assert.equal(await one('select charged_cents from icash_operation_spend where operation_key=$1',[operation]),8,'unmatched has zero observed data credits');});
 await isolated(async()=>{await reserve();await q('update icash_accounts set bot_paused=true');assert.equal(await one('select icash_claim_operation($1)',[operation]),false,'Pause wins before provider claim');});
 await isolated(async()=>{await claim();await receipt();await q('update icash_accounts set bot_paused=true');assert.equal(await one('select icash_settle_estimated_operation($1)',[operation]),true,'real completed cost still settles after Pause');assert.equal(await one('select bot_paused from icash_accounts where id=$1',[account]),true,'settlement does not unpause');});
 await isolated(async()=>{await q('update icash_operating_budget set funded_micros=0');await assert.rejects(reserve(),/Company budget exhausted/);});
 const malformed=[{...response(),credits:{used:2,people:2,deduplicated:0}},{...response(),credits:{used:0,people:1,deduplicated:0}},{...response(),credits:{used:'1',people:1,deduplicated:0}},{...response(),data:[]},{...response(),data:[{...response().data[0],input:{number:'+12145550999'}}]},{...response(),totals:{submitted:1,matched:0,unmatched:1}}];
 for(const body of malformed)await isolated(async()=>{await claim();await receipt(body);assert.equal(await one('select icash_settle_estimated_operation($1)',[operation]),false);assert.equal(await one('select count(*) from icash_credit_ledger'),0);});
 for(const sql of ["update icash_accounts set bot_paused=true","update icash_operating_budget set enabled=false","update icash_discovery_configs set contacts_enabled=false","update icash_discovery_configs set property_credit_micros=20000","update icash_data_cost_settings set credit_micros=20000","update icash_operation_rates set enabled=false","update icash_operation_rates set expires_at=now()-interval '1 second'","update icash_wallets set balance_cents=18","insert into icash_billing_reviews(account_id) select id from icash_accounts"])
  await isolated(async()=>{await q(sql);assert.equal(await reserve(),null,sql);assert.equal(await one('select count(*) from icash_operation_spend'),0);});
 await isolated(async()=>{await claim();await receipt();await q('update icash_research_private.requests set admitted=false');assert.equal(await one('select icash_settle_estimated_operation($1)',[operation]),false,'request binding required');});
 await isolated(async()=>{await claim();await receipt();await q('update icash_seller_recovery_private.contact_refreshes set http_status=500');assert.equal(await one('select icash_settle_estimated_operation($1)',[operation]),false,'HTTP errors cannot settle as successful observation');});
 await isolated(async()=>{await q('set local role service_role');const claimed=await one('select icash_claim_seller_contact_refresh()');await q('reset role');assert(claimed,'Combined first claim');assert.equal(claimed.phone,phone);assert.equal(await one('select count(*) from icash_operation_spend'),1);assert.equal(await one('select state from icash_operation_spend'),'dispatched');assert.equal(await one('select kind from icash_research_private.requests'),'phone_dnc');assert.equal(await one('select icash_claim_seller_contact_refresh()'),null,'scheduler request pacing and one-use claim');});
 for(const control of ['quota_admitted','late_current'])await isolated(async()=>{await q('update fixture_controls set '+control+'=false');assert.equal(await one('select icash_claim_seller_contact_refresh()'),null);for(const table of ['icash_operation_spend','icash_credit_reservations','icash_research_private.requests','icash_seller_recovery_private.contact_refreshes'])assert.equal(await one('select count(*) from '+table),0,'atomic rollback on '+control);assert.equal(await one('select reserved_micros from icash_operating_budget'),0);assert.equal(await one('select scan_gap_id from icash_seller_recovery_private.contact_refresh_policy'),gap,'scan progress survives per-item rollback');});
 await isolated(async()=>{await q("update icash_seller_gaps set due_at=now()+interval '1 second'");for(let n=10;n<31;n++){const held=id(n);await q("insert into icash_seller_gaps(id,account_id,thread_id,reason,state,review_reason,stage,due_at) values($1,$2,$3,'no_response','needs_review','contact_checks_expired','draft',now()-interval '1 hour')",[held,account,gap]);}await q('update fixture_controls set only_gap=$1',[gap]);await q("update icash_seller_gaps set due_at=now() where id=$1",[gap]);assert.equal(await one('select icash_claim_seller_contact_refresh()'),null,'first bounded scan visits held prefix');const next=await one('select icash_claim_seller_contact_refresh()');assert(next,'Fairness second claim');assert.equal(next.phone,phone,'next scan reaches candidate after 21 holds');});
 await isolated(async()=>{await q('update icash_operating_budget set funded_micros=0');assert.equal(await one('select icash_claim_seller_contact_refresh()'),null,'ordinary company money hold stays local');assert.equal(await one('select count(*) from icash_operation_spend'),0);assert.equal(await one('select scan_gap_id from icash_seller_recovery_private.contact_refresh_policy'),gap);});
 for(const role of ['anon','authenticated','service_role'])assert.equal(await one("select has_function_privilege($1,'public.icash_claim_seller_contact_refresh()','execute')",[role]),role==='service_role');
 for(const role of ['anon','authenticated','service_role'])for(const f of ['reserve_contact_refresh(uuid,uuid,uuid,bigint)','settle_contact_refresh(text)'])assert.equal(await one("select has_function_privilege($1,$2,'execute')",[role,'icash_seller_recovery_private.'+f]),false);
 console.log('PASS one-credit rate derivation, real cost/credit reservation and actual settlement, saved VIP/3x policy, observed dedup, no unknown settlement, exact receipt/request binding, outreach allowance and private helpers.');
 }}catch(e){console.error(e.message,e.where??'',e.position??'',e.query?.slice(Math.max(0,Number(e.position)-200),Number(e.position)+200)??'');process.exitCode=1;}finally{await pg.close();}
