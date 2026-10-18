import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pricingBlock,pricingBaseline} from './helpers/two-times-pricing-fixture.mjs';
const pg=new PGlite(),owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',account=randomUUID();
const file=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const query=(s,v=[])=>pg.query(s,v),one=async(s,v=[])=>(await query(s,v)).rows[0];
const rpc=async(s,v=[])=>(await one('select '+s+' as result',v)).result;
try{
 await pg.exec(`
 create role anon;create role authenticated;create role service_role;
 create table icash_operating_budget(id integer primary key,enabled boolean default true,standard_cost_multiplier numeric default 3,elevenlabs_cost_multiplier numeric default 3,require_company_reserve boolean default false,funded_micros bigint default 10000000000,spent_micros bigint default 0,reserved_micros bigint default 0,protected_micros bigint default 0,daily_limit_micros bigint default 10000000000);insert into icash_operating_budget(id) values(1);
 create table icash_seller_controls(id integer primary key,enabled boolean,data_rights_until timestamptz,review_ref text,limited_contact_enabled boolean);
 insert into icash_seller_controls values(1,true,now()+interval '1 year','Synthetic data rights',false);
 create table icash_seller_intakes(id uuid primary key,created_at timestamptz default now(),state text default 'qualified',canonical_id uuid,contact_consent_scope text,attribution jsonb,
  address text default '123 Fixture Street',name text,phone text,property jsonb default '{"id":"property-fixture","state":"TX","city":"Dallas"}',result jsonb default '{}',
  next_assignment_at timestamptz default now(),numbers_passed boolean default true,lookup_costs jsonb default '{"dealmachine":10000,"elevenlabs":0,"twilio":0,"messaging":0,"email":0,"llm":0,"vercel":30000,"railway":0,"supabase":0,"github":0,"payments":0,"title_and_signing":0,"support_and_overhead":0,"acquisition":0,"refund_and_dispute_reserve":0,"other":0}',lookup_cost_basis text default 'Synthetic processing estimate',
  customer_costs jsonb,customer_cost_basis text,ad_cost_micros bigint,ad_cost_receipt text,checked_at timestamptz default now(),data_rights_until timestamptz default now()+interval '1 year',
  ai_consented boolean default true,consent_version text,consent_text text,email text,email_consented boolean default false,assigned_account uuid,screening_id uuid,operation_key text,assigned_at timestamptz,hold_reason text);
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid,operation_key text unique,charge_cents bigint,assigned_at timestamptz default now(),primary key(lead_id,account_id));
 create table icash_accounts(id uuid primary key,bot_paused boolean default false,daily_limit_cents bigint default 100000,vip boolean default false,member boolean default true);
 create table icash_wallets(account_id uuid primary key,balance_cents bigint check(balance_cents>=0));
 create table icash_text_suppressions(phone text);create table icash_contact_suppressions(account_id uuid,contact_key text);
 create table icash_live_conversations(account_id uuid,screening_id uuid,contact_key text);
 create table icash_deal_files(id uuid,account_id uuid,screening_id uuid);
 create table icash_signing_envelopes(account_id uuid,deal_id uuid,kind text,test_mode boolean,state text);
 create table icash_outbound_property_owners(property_id text,account_id uuid);
 create table icash_billing_reviews(account_id uuid,resolved_at timestamptz);
 create table icash_operation_rates(id uuid primary key default gen_random_uuid(),operation text,version text unique,charge_cents bigint,costs_micros jsonb,buffer_bps integer,evidence_ref text,verified_at timestamptz,expires_at timestamptz,enabled boolean,flat_customer_price_cents bigint);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,rate_id uuid,cost_basis text,state text default 'reserved',credit_reservation_id uuid,charge_cap_cents bigint,reserved_micros bigint,permission_until timestamptz,financial_checked_at timestamptz,standard_cost_multiplier numeric,elevenlabs_cost_multiplier numeric,required_revenue_micros bigint,settled_at timestamptz,actual_micros bigint,charged_cents bigint,customer_price_micros bigint);
 create table icash_credit_ledger(operation_key text primary key,account_id uuid,delta_cents bigint);
 create table icash_screening_jobs(id uuid primary key default gen_random_uuid(),account_id uuid,event_key text unique,snapshot jsonb,state text,result jsonb,completed_at timestamptz);
 create function icash_research_state_allowed(text) returns boolean language sql set search_path='public' as $$select true$$;
 create function icash_credit_acquisition_allowed(p uuid) returns boolean language sql set search_path='public' as $$select member from icash_accounts where id=p$$;
 create function icash_vip_active(p uuid) returns boolean language sql set search_path='public' as $$select vip from icash_accounts where id=p$$;
 create function icash_hybrid_inbound_share(bigint) returns numeric language sql set search_path='public' as $$select 1::numeric$$;
 create function icash_daily_allowance(p uuid) returns jsonb language sql set search_path='public' as $$select jsonb_build_object('remainingCents',balance_cents) from icash_wallets where account_id=p$$;
 create function icash_seller_assignment_due(n integer,first_at timestamptz,last_at timestamptz) returns timestamptz language sql set search_path='public' as $$select case when n=0 then now() else first_at+interval '24 hours'*n end$$;
 create table icash_fractional_usage(operation_key text,account_id uuid,price_micros bigint,charged_cents bigint);
 create table icash_workspace_questions(id uuid primary key,account_id uuid,state text);
 create table icash_question_usage(question_id uuid primary key,account_id uuid,model text,state text default 'reserved',settled_at timestamptz,provider_id text,multiplier numeric constraint icash_question_usage_multiplier_check check(multiplier in (3,2.4)),cost_micros bigint,price_micros bigint,charged_cents bigint);
 create table icash_text_messages(id uuid,account_id uuid,customer_price_micros bigint);
 create function icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_reception_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_limited_seller_voice(uuid,text) returns boolean language sql as $$select false$$;
 create function icash_cancellation_voice_current(uuid,text) returns boolean language sql as $$select false$$;
 create function icash_reserve_credit(uuid,text,bigint) returns uuid language sql as $$select gen_random_uuid()$$;
 -- Synthetic wallet adapter; actual production assignment SQL below performs the calculation and atomic save.
 create function icash_reserve_operation(a uuid,o text,r uuid,d timestamptz,c timestamptz,n boolean) returns void language plpgsql set search_path='public' as $$begin perform icash_reserve_before_fractional(a,o,r,d,c,n);end$$;
 create function icash_claim_operation(text) returns boolean language sql set search_path='public' as $$select true$$;
 create function icash_settle_complete_costs(o text,c bigint,m jsonb,e text) returns void language plpgsql set search_path='public' as $$declare a uuid;begin
 select account_id into a from icash_operation_spend where operation_key=o;
 update icash_wallets set balance_cents=balance_cents-c where account_id=a;
 insert into icash_credit_ledger values(o,a,-c);update icash_operation_spend set state='settled',charged_cents=c,actual_micros=(select sum((value->>'amountMicros')::bigint) from jsonb_each(m)),settled_at=now() where operation_key=o;end$$;
 `);
 await query('insert into icash_accounts(id) values($1)',[account]);await query('insert into icash_wallets values($1,100000)',[account]);
 await pg.exec(file('tests/fixtures/seller-assignment-cost-baseline.sql'));
 await pg.exec(file('tests/fixtures/seller-cost-reservation-baseline.sql'));
 await pg.exec(file('config/vip-retention-plan.sql').match(/create function public\.icash_vip_savings[\s\S]*?\$\$;/)[0]);
 assert.equal(file('config/lead-acquisition-costs.sql'),file('supabase/migrations/20261018021153_lead_acquisition_costs.sql'));
 await pg.exec(file('config/lead-acquisition-costs.sql'));
 await pg.exec(file('config/seller-meta-cost-sync.sql'));
 assert.equal(file('config/two-times-usage-pricing.sql'),file('supabase/migrations/20261018023348_two_times_usage_pricing.sql'));
 await pg.exec(pricingBaseline('icash_reserve_question'));
 const oldRate=randomUUID();await query("insert into icash_operation_rates(id,operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled) values($1,'property_search','synthetic-old',12,'{\"dealmachine\":10000,\"elevenlabs\":0,\"twilio\":0,\"messaging\":0,\"email\":0,\"llm\":0,\"vercel\":30000,\"railway\":0,\"supabase\":0,\"github\":0,\"payments\":0,\"title_and_signing\":0,\"support_and_overhead\":0,\"acquisition\":0,\"refund_and_dispute_reserve\":0,\"other\":0}',0,'Synthetic prior quote',now(),now()+interval '1 day',true)",[oldRate]);
 await rpc("icash_reserve_before_fractional($1,'old-snapshot',$2,now()+interval '1 day',null,false)",[account,oldRate]);
 for(const name of ['reserve_before_fractional','assign_seller_lead_for','seller_lead_rate_multiplier','reserve_question','vip_savings'])await pg.exec(pricingBlock(name));
 await pg.exec("alter table icash_question_usage drop constraint icash_question_usage_multiplier_check;alter table icash_question_usage add constraint icash_question_usage_multiplier_check check(multiplier in(3,2.4,2,1.6));update icash_operating_budget set standard_cost_multiplier=2,elevenlabs_cost_multiplier=2;");
 assert.equal((await one("select standard_cost_multiplier from icash_operation_spend where operation_key='old-snapshot'")).standard_cost_multiplier,'3','In-flight usage keeps its snapshot');
 for(const vip of [false,true]){await query('update icash_accounts set vip=$1 where id=$2',[vip,account]);const id=randomUUID();await query("insert into icash_workspace_questions values($1,$2,'pending')",[id,account]);assert.equal(await rpc("icash_reserve_question($1,$2,'gpt-4.1-mini')",[account,id]),true);assert.equal(await rpc("icash_reserve_question($1,$2,'gpt-4.1-mini')",[account,id]),false);assert.equal(Number((await one('select multiplier from icash_question_usage where question_id=$1',[id])).multiplier),vip?1.6:2);}
 await query('update icash_accounts set vip=false where id=$1',[account]);

 const lead=async(source='meta',campaign='ads')=>{const id=randomUUID();await query('insert into icash_seller_intakes(id,attribution) values($1,$2)',[id,{source,campaign}]);return id;};
 const save=(kind,id,cents,source='meta',campaign='',request=randomUUID(),actor=owner,note='Synthetic owner cost')=>rpc('icash_record_seller_acquisition_cost($1,$2,$3,$4,$5,$6,$7,$8)',[actor,request,kind,id,source,campaign,cents,note]);
 const quote=id=>rpc('icash_seller_acquisition_quote($1)',[id]);
 const assign=id=>rpc('icash_assign_seller_lead_for($1)',[id]);
 const first=await lead();assert.equal(await quote(first),null);
 assert.equal((await assign(first)).status,'acquisition_cost_required');assert.equal(Number((await one('select count(*) n from icash_credit_ledger')).n),0);
 await save('estimate',null,1120);assert.equal((await quote(first)).costMicros,11200000);
 const firstResult=await assign(first);assert.equal(firstResult.chargeCents,2248,'Include $11.20 acquisition plus $0.04 processing at 2x');
 assert.equal((await one('select delta_cents from icash_credit_ledger')).delta_cents,-2248);
 assert.equal(await assign(first),null,'Same assignment cannot bill twice');
 const before=await one('select customer_costs,customer_cost_basis from icash_seller_intakes where id=$1',[first]);
 const request=randomUUID();await save('lead',first,2000,'meta','',request);assert.equal((await save('lead',first,2000,'meta','',request)).replayed,true);
 await assert.rejects(save('lead',first,2001,'meta','',request),/retry conflict/);
 assert.deepEqual(await one('select customer_costs,customer_cost_basis from icash_seller_intakes where id=$1',[first]),before,'Actual reporting never rewrites the frozen price');
 await rpc('icash_save_seller_cost_threshold($1,$2)',[owner,2500]);
 const second=randomUUID();await query('insert into icash_accounts(id) values($1)',[second]);await query('insert into icash_wallets values($1,100000)',[second]);
 await query("update icash_seller_matches set assigned_at=now()-interval '25 hours' where lead_id=$1",[first]);await query('update icash_seller_intakes set next_assignment_at=now() where id=$1',[first]);
 assert.equal((await assign(first)).chargeCents,2248,'Later recipients retain first assignment price after actual-cost correction');
 const report=await rpc('icash_owner_seller_costs($1)',[owner]);const row=report.leads.find(x=>x.id===first);assert.equal(row.acquisition.costMicros,20000000);assert.equal(row.collectedCents,4496);assert.equal(row.recipients,2);
 await query('update icash_accounts set bot_paused=true where id=$1',[second]);await query('update icash_accounts set vip=true where id=$1',[account]);
 await rpc('icash_save_seller_cost_threshold($1,$2)',[owner,1000]);
 const vip=await lead();assert.equal((await assign(vip)).chargeCents,1799,'VIP applies 20% discount once with cent rounding');
 assert.equal(await rpc('icash_vip_savings($1)',[account]),449,'VIP savings use the same frozen 2x Standard price');
 const legacy=await lead();await query("update icash_seller_intakes set customer_costs=lookup_costs,customer_cost_basis='Legacy research-only snapshot' where id=$1",[legacy]);assert.equal(await quote(legacy),null,'Legacy zero acquisition is missing, not free ads');
 await save('lead',legacy,1120);await query('update icash_accounts set vip=false where id=$1',[account]);assert.equal((await assign(legacy)).chargeCents,12,'Preserve historic frozen pricing');
 await save('estimate',null,1500,'meta','special');const special=await lead('meta','special');assert.equal((await quote(special)).costMicros,15000000,'Campaign estimate takes priority');
 await query("update icash_seller_intakes set ad_cost_micros=12000000,ad_cost_receipt='synthetic report' where id=$1",[special]);assert.equal((await quote(special)).costMicros,12000000,'Completed report takes priority over estimate');
 await save('lead',special,1300);assert.equal((await quote(special)).costMicros,13000000,'Explicit lead report takes priority over campaign allocation');
 const poor=await lead();await query('update icash_wallets set balance_cents=12 where account_id=$1',[account]);const billed=Number((await one('select count(*) n from icash_credit_ledger')).n);
 assert.equal((await assign(poor)).status,'waiting_for_budget');assert.equal(Number((await one('select count(*) n from icash_credit_ledger')).n),billed,'Insufficient credits never receive the old $0.12 price');
 const direct=await lead('direct');assert.equal((await quote(direct)).costMicros,0);
 const demo=await lead('icash_x_demo');await query("update icash_seller_intakes set contact_consent_scope='icash_x_demo' where id=$1",[demo]);assert.equal((await quote(demo)).kind,'demo');
 await assert.rejects(save('lead',demo,10),/Real unique lead/);
 const noPermission=randomUUID();await assert.rejects(save('estimate',null,1120,'meta','',randomUUID(),noPermission),/Owner required/);
 await assert.rejects(rpc('icash_owner_seller_costs($1)',[noPermission]),/Owner required/);
 await assert.rejects(save('estimate',null,-1),/Valid cost/);await assert.rejects(save('estimate',null,1000001),/Valid cost/);
 await assert.rejects(save('estimate',null,1,'meta','x&bad'),/Valid source/);
 await query('update icash_wallets set balance_cents=100000 where account_id=$1',[account]);
 for(const [ad,expected] of [[0,8],[1,10],[995,1998],[996,2000],[997,2002]]){const edge=await lead('other');await save('lead',edge,ad);assert.equal((await assign(edge)).chargeCents,expected,'All costs use 2x without a threshold');}
 assert.equal((await one("select standard_cost_multiplier from icash_operation_spend where operation_key=$1",['seller-lead:'+first+':'+account])).standard_cost_multiplier,'2','Reservation gate snapshots 2x');
 const unrelatedRate=randomUUID();await query("insert into icash_operation_rates(id,operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled) select $1,'property_search','synthetic-other',8,lookup_costs,0,'Synthetic unrelated rate',now(),now()+interval '1 day',true from icash_seller_intakes where id=$2",[unrelatedRate,first]);
 await rpc("icash_reserve_before_fractional($1,$2,$3,now()+interval '1 day',null,false)",[account,'synthetic-other',unrelatedRate]);
 assert.equal(Number((await one("select standard_cost_multiplier from icash_operation_spend where operation_key='synthetic-other'")).standard_cost_multiplier),2);
 await query('update icash_accounts set vip=true where id=$1',[account]);await rpc("icash_reserve_before_fractional($1,$2,$3,now()+interval '1 day',null,false)",[account,'synthetic-vip-other',unrelatedRate]);assert.equal(Number((await one("select standard_cost_multiplier from icash_operation_spend where operation_key='synthetic-vip-other'")).standard_cost_multiplier),1.6);await query('update icash_accounts set vip=false where id=$1',[account]);
 const metaLead=await lead('meta','automatic');
 await query("update icash_seller_intakes set created_at=((now() at time zone 'America/Chicago')::date-1)::timestamp at time zone 'America/Chicago' where id=$1",[metaLead]);
 await rpc('icash_save_seller_meta_source($1,$2,$3,$4,$5)',[owner,'automatic','act_123456789','987654321',true]);
 await assert.rejects(rpc('icash_save_seller_meta_source($1,$2,$3,$4,$5)',[owner,'different','act_123456789','987654321',true]),/unique constraint/);
 let sync=await rpc('icash_claim_seller_cost_sync()');assert.equal(await rpc('icash_claim_seller_cost_sync()'),null,'Concurrent sync is leased');
 const dates=(await query("select to_char((now() at time zone 'America/Chicago')::date-n,'YYYY-MM-DD') as day from generate_series(1,7) n")).rows.map(x=>x.day);
 let days=dates.map((day,i)=>({day,spendMicros:i===0?11200000:i===1?2000000:0,currency:'USD'}));
 const finish=(token=sync.token,status='synced',rows=days)=>rpc('icash_finish_seller_cost_sync($1,$2,$3,$4,$5)',[sync.id,token,status,'America/Chicago',rows]);
 assert.equal(await finish(randomUUID()),false,'Wrong lease cannot import spend');await assert.rejects(finish(sync.token,'synced',days.slice(1)),/seven-day report/);
 assert.equal(await finish(),true);assert.equal(await finish(),false,'Retry cannot duplicate spend');
 assert.equal((await quote(metaLead)).kind,'meta_report');assert.equal((await quote(metaLead)).costMicros,11200000);
 const current=await lead('meta','automatic');assert.equal((await quote(current)).costMicros,13200000,'Days with zero leads still contribute to automatic average');
 assert.equal((await assign(current)).chargeCents,2648,'Automatic average reaches assignment and real reservation gate');
 const metaReport=await rpc('icash_owner_seller_meta_costs($1)',[owner]);assert.equal(metaReport[0].spendMicros,13200000);assert.equal(metaReport[0].leadCount,1);assert.equal(metaReport[0].unallocatedMicros,2000000);
 await query('update icash_seller_meta_sources set next_sync_at=now()');sync=await rpc('icash_claim_seller_cost_sync()');days=days.map((d,i)=>({...d,spendMicros:i===0?22400000:d.spendMicros}));assert.equal(await finish(),true);
 assert.equal((await quote(metaLead)).costMicros,22400000,'Provider corrections update reports, not charges');
 assert.equal((await one('select sum(charge_cents) n from icash_seller_matches where lead_id=$1',[current])).n,'2648');
 assert.equal((await rpc('icash_owner_seller_meta_costs($1)',[owner]))[0].spendMicros,24400000,'New revision replaces, rather than doubles, campaign spend');
 await query("update icash_seller_meta_sources set last_synced_at=now()-interval '49 hours'");
 const stale=await lead('meta','automatic');assert.equal((await quote(stale)).kind,'estimate','Stale import uses labeled owner fallback');
 const fresh=await lead('google');assert.equal(await quote(fresh),null);await save('estimate',null,0,'google');assert.equal((await quote(fresh)).costMicros,0,'Zero cost must be explicit for paid sources');
 for(const role of ['anon','authenticated']){
  assert.equal((await one("select has_table_privilege($1,'icash_seller_cost_records','SELECT') p",[role])).p,false);
  assert.equal((await one("select has_function_privilege($1,'icash_record_seller_acquisition_cost(uuid,uuid,text,uuid,text,text,bigint,text)','EXECUTE') p",[role])).p,false);
 }
 assert.equal((await one("select relrowsecurity from pg_class where oid='icash_seller_cost_records'::regclass")).relrowsecurity,true);
 console.log('PASS lead acquisition costs: actual assignment SQL, paid-cost admission, Standard/VIP, insufficient funds, immutable historical charges, reporting once per lead, source precedence, retries and owner-only access. Local synthetic wallet; no providers.');
}finally{await pg.close();}
