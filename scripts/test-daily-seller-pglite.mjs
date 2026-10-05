// Isolated database simulation. Real new migrations and current credit ledger
// functions; provider, activation and complete-cost adapters use synthetic data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const q=(sql,args=[])=>pg.query(sql,args),file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const uuid=randomUUID,hash=s=>createHash('sha256').update(s).digest('hex');
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key,billing_model text default 'legacy' constraint icash_accounts_billing_model_check check(billing_model in ('legacy','prepaid','membership_credits')),bot_paused boolean default true,daily_limit_cents bigint default 0);
 create table icash_wallets(account_id uuid primary key,balance_cents bigint default 0,reserved_cents bigint default 0);
 create table icash_credit_reservations(id uuid primary key default gen_random_uuid(),account_id uuid,operation_key text unique,amount_cents bigint,status text default 'reserved',settled_cents bigint);
 create table icash_credit_ledger(account_id uuid,event_key text unique,kind text,delta_cents bigint,evidence_ref text,created_at timestamptz default now());
 create table icash_credit_packs(code text primary key,price_cents bigint,credit_cents bigint,enabled boolean);
 create table icash_funding_orders(id uuid primary key default gen_random_uuid(),mode text,guest_hash text,account_id uuid,pack_code text,price_cents bigint,credit_cents bigint,state text,stripe_payment_id text,payer_email text,payer_phone text,paid_at timestamptz,credited_at timestamptz,run_days integer,flexible_pacing boolean,pacing_applied_at timestamptz,processing_fee_cents bigint,tax_required boolean,tax_cents bigint,charged_total_cents bigint,billing_period_start timestamptz,created_at timestamptz default now());
 create table icash_memberships(account_id uuid,guest_hash text,mode text,state text);
 create table icash_billing_reviews(account_id uuid,resolved_at timestamptz);
 create table icash_spend_activations(account_id uuid primary key,enabled boolean,customer_cap_cents bigint);
 create table icash_operating_budget(id integer primary key,enabled boolean default true,minimum_margin_bps integer,standard_cost_multiplier numeric default 5,elevenlabs_cost_multiplier numeric default 3);insert into icash_operating_budget(id) values(1);
 create table icash_operation_rates(id uuid primary key default gen_random_uuid(),operation text,version text unique,charge_cents bigint,costs_micros jsonb,buffer_bps integer,evidence_ref text,verified_at timestamptz,expires_at timestamptz,enabled boolean,voice_max_duration_seconds integer,flat_customer_price_cents bigint);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,rate_id uuid,credit_reservation_id uuid,charge_cap_cents bigint,reserved_micros bigint,state text,actual_micros bigint,charged_cents bigint,standard_cost_multiplier numeric,elevenlabs_cost_multiplier numeric,required_revenue_micros numeric,customer_price_micros bigint,cost_basis text);
 create table icash_cost_manifests(operation_key text,components jsonb);
 create table icash_discovery_configs(rate_id uuid,contact_rate_id uuid);create table icash_buyer_search_configs(rate_id uuid,revision uuid default gen_random_uuid());create table icash_text_ai_settings(rate_id uuid);create table icash_signing_templates(rate_id uuid);create table icash_title_contacts(rate_id uuid);create table icash_text_threads(sms_rate_id uuid,mms_rate_id uuid);create table icash_text_messages(direction text,state text);create table icash_communication_prices(operation text,customer_micros bigint);
 create table icash_data_cost_settings(provider text,credit_micros bigint,cost_basis text,source_ref text);insert into icash_data_cost_settings values('dealmachine',10000,'estimated','Synthetic cost allocation only');
 create table icash_screening_jobs(id uuid primary key default gen_random_uuid(),account_id uuid,event_key text unique,snapshot jsonb,state text,result jsonb,completed_at timestamptz);
 create table icash_bot_setups(account_id uuid,profile jsonb);
 create table icash_live_conversations(id uuid primary key,account_id uuid,screening_id uuid,party text,state text,completed_at timestamptz,result jsonb);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,seller_signed_at timestamptz,terms jsonb);
 create table icash_signing_envelopes(id uuid primary key,account_id uuid,deal_id uuid,kind text,test_mode boolean,state text,provider_id text,terms jsonb);
 create function icash_membership_work_allowed(a uuid) returns boolean language sql set search_path='public' as $$ select billing_model<>'membership_credits' from icash_accounts where id=a $$;
 create function icash_general_reception_pause_exempt(a uuid,o text,c bigint) returns boolean language sql set search_path='public' as $$select false$$;
 create function icash_post_credit(a uuid,k text,kind text,c bigint,p text) returns void language sql set search_path='public' as $$select$$;
 `);
 await pg.exec(file('config/daily-billing.sql'));
 await pg.exec(file('config/buyer-search-config-integrity.sql'));
 await pg.exec(file('tests/fixtures/current-credit-functions.sql'));
 const costs=Object.fromEntries(['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'].map(k=>[k,0]));costs.dealmachine=10000;costs.support_and_overhead=90000;
 const oldRate=uuid();await q("insert into icash_operation_rates values($1,'property_search','synthetic-old',60,$2,2000,'Synthetic provider estimate',now()-interval '1 day',now()+interval '20 days',true,null,null)",[oldRate,costs]);
 await q('insert into icash_discovery_configs values($1,null)',[oldRate]);
 await q('insert into icash_buyer_search_configs(rate_id) values($1)',[oldRate]);
 await pg.exec('begin;'+file('supabase/migrations/20261004170448_daily_budget_return_and_three_times_usage.sql')+'commit;');
 await pg.exec(file('supabase/migrations/20261005024458_enforce_ten_dollar_daily_minimum.sql'));
 assert.equal(Number((await q("select price_cents from icash_credit_packs where code='budget_ten'")).rows[0].price_cents),1000);
 assert.equal(Number((await q('select standard_cost_multiplier from icash_operating_budget')).rows[0].standard_cost_multiplier),3);
 assert.equal(Number((await q('select charge_cents from icash_operation_rates where id=$1',[oldRate])).rows[0].charge_cents),60,'old price version unchanged');
 assert.notEqual((await q('select rate_id from icash_discovery_configs')).rows[0].rate_id,oldRate);
 const a=uuid(),plan=uuid();await q('insert into icash_accounts(id) values($1)',[a]);await q('insert into icash_wallets(account_id,balance_cents) values($1,2000)',[a]);
 await q("insert into icash_daily_plans(id,mode,guest_hash,account_id,state,consent_version,consent_text) values($1,'live','fixture',$2,'active','daily-2026-10-04.1','accepted terms')",[plan,a]);
 const fund=()=>q("insert into icash_funding_orders(account_id,daily_plan_id,mode,state,credit_cents,paid_at,credited_at,billing_period_start) values($1,$2,'live','paid',500,now(),now(),now())",[a,plan]);
 await fund();await q('select icash_daily_claim($1)',[a]);assert.equal((await q('select billing_model,bot_paused from icash_accounts where id=$1',[a])).rows[0].billing_model,'daily');
 await q('update icash_accounts set bot_paused=true where id=$1',[a]);await fund();await q('select icash_daily_claim($1)',[a]);assert.equal((await q('select bot_paused from icash_accounts where id=$1',[a])).rows[0].bot_paused,true,'renewal never unpauses');assert.equal(Number((await q('select customer_cap_cents from icash_spend_activations where account_id=$1',[a])).rows[0].customer_cap_cents),1000,'renewal grows paid cap');
 await q('update icash_accounts set bot_paused=false where id=$1',[a]);
 await pg.exec(`create function icash_reserve_operation(a uuid,o text,r uuid,p timestamptz,f timestamptz,b boolean) returns jsonb language plpgsql set search_path='public' as $$declare c bigint;cr uuid;begin select charge_cents into c from icash_operation_rates where id=r;if not exists(select 1 from icash_spend_activations where account_id=a and enabled) then raise exception 'Activation required';end if;cr:=icash_reserve_credit(a,o,c);insert into icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,state,standard_cost_multiplier,elevenlabs_cost_multiplier) values(o,a,r,cr,c,'reserved',3,3);return '{}'::jsonb;end$$;
 create function icash_claim_operation(o text) returns boolean language plpgsql set search_path='public' as $$begin update icash_operation_spend set state='dispatched' where operation_key=o and state='reserved';return found;end$$;
 create function icash_settle_complete_costs(o text,c bigint,m jsonb,e text) returns void language plpgsql set search_path='public' as $$declare a uuid;begin select account_id into a from icash_operation_spend where operation_key=o;perform icash_finish_credit(a,o,c,e);update icash_operation_spend set state='settled',charged_cents=c where operation_key=o;end$$;`);
 await pg.exec(file('supabase/migrations/20261004170451_seller_intake_and_budgeted_lead_assignment.sql'));
 await pg.exec(file('supabase/migrations/20261005054100_homeoffer_eight_buyer_schedule.sql'));
 await q("insert into icash_bot_setups values($1,'{\"marketMode\":\"nationwide\"}')",[a]);
 const submit=async(label,request=uuid(),consent=false)=>{const values=[request,hash('guest'),label,'Synthetic address '+label,'+12145550123',hash(label),consent,'homeoffer-seller-ai-2026-10-05.1','Exact AI consent '.repeat(12),'Exact data sharing disclosure '.repeat(8),{source:'meta',campaign:'fixture'},hash('agent')];return (await q('select icash_submit_seller_intake($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) id',values)).rows[0].id;};
 const req=uuid(),l1=await submit('One',req);assert.equal(await submit('One',req),l1);await assert.rejects(submit('One',req,true),/retry mismatch/);await submit('One');assert.equal(Number((await q("select count(*) n from icash_seller_intakes where state='duplicate'")).rows[0].n),1);
 assert.equal((await q('select icash_claim_seller_lookup() j')).rows[0].j,null,'no paid lookup without allowance');
 await q("update icash_seller_controls set enabled=true,lookup_allowance_micros=10000000,data_rights_until=now()+interval '7 days',review_ref='Synthetic rights review'");
 await q("select icash_save_seller_market('dallas','TX',true,'Synthetic state and role review',now()+interval '7 days',$1)",[a]);
 const finish=async(id)=>{const c=(await q('select icash_claim_seller_lookup() j')).rows[0].j;assert.equal(c.id,id);assert.equal((await q('select icash_claim_seller_lookup() j')).rows[0].j,null,'claimed lookup cannot be replayed');const output={creditsUsed:1,numbersPassed:true,status:'qualified',property:{id:'prop_'+String(Math.floor(Math.random()*1000000)),city:'Dallas',state:'TX',zip:'75217',fetchedAt:new Date().toISOString(),raw:{data:{}}},result:{financialCheck:{status:'eligible'},preliminarySellerCeilingCents:8000000}};assert.equal((await q('select icash_finish_seller_lookup($1,$2,$3) ok',[id,c.token,output])).rows[0].ok,true);assert.equal((await q('select icash_finish_seller_lookup($1,$2,$3) ok',[id,c.token,output])).rows[0].ok,false);};
 await finish(l1);assert.equal(Number((await q('select count(*) n from icash_seller_events')).rows[0].n),2);
 const l2=await submit('Two');await finish(l2);
 const end=new Date(Date.now()+1000).toISOString(); // DB clock is real; use a safe closed period below.
 await q("update icash_seller_intakes set created_at=now()-interval '2 hours'");
 const allocate=()=>q("select icash_allocate_seller_ad_cost('receipt-fixture','meta','fixture',now()::date-interval '1 day',now()-interval '1 hour',2000000,'Synthetic spend report',$1) j",[a]);
 await allocate();const leads=(await q("select ad_cost_micros from icash_seller_intakes where state='qualified'")).rows;assert.equal(leads.reduce((s,l)=>s+Number(l.ad_cost_micros),0),2000000,'advertising cost allocated exactly once, without rounding inflation');
 const one=(await q('select icash_assign_seller_lead() j')).rows[0].j;assert.deepEqual(one,{status:'assigned',chargeCents:330});
 assert.equal((await q('select icash_assign_seller_lead() j')).rows[0].j.status,'waiting_for_budget');
 assert.equal(Number((await q('select count(*) n from icash_credit_ledger')).rows[0].n),1,'waiting lead never charged');
 await pg.exec("update icash_credit_ledger set created_at=now()-interval '25 hours';update icash_seller_intakes set next_assignment_at=now() where state='qualified'");
 assert.equal((await q('select icash_assign_seller_lead() j')).rows[0].j.status,'assigned','later funded day can buy the queued lead');
 assert.equal((await q('select icash_assign_seller_lead() j')).rows[0].j,null,'assignment cannot be billed twice');
 assert.equal(Number((await q('select balance_cents from icash_wallets where account_id=$1',[a])).rows[0].balance_cents),1340);
 // A second real account receives a separately billed, non-exclusive match.
 const second=uuid();await q("insert into icash_accounts(id,billing_model,bot_paused,daily_limit_cents) values($1,'daily',false,1000)",[second]);
 await q('insert into icash_wallets(account_id,balance_cents) values($1,2000)',[second]);
 await q('insert into icash_spend_activations(account_id,enabled,customer_cap_cents) values($1,true,2000)',[second]);
 await q("insert into icash_bot_setups values($1,'{\"marketMode\":\"nationwide\"}')",[second]);
 await q("insert into icash_daily_plans(account_id,guest_hash,mode,state,consent_version,consent_text) values($1,$2,'live','active','daily-2026-10-04.1','Fixture consent')",[second,hash('second')]);
 await q("update icash_seller_intakes set next_assignment_at='infinity' where id<>$1",[l1]);
 await q('update icash_seller_intakes set next_assignment_at=now() where id=$1',[l1]);
 assert.equal((await q('select icash_assign_seller_lead() j')).rows[0].j.status,'assigned');
 assert.equal(Number((await q('select count(distinct account_id) n from icash_seller_matches where lead_id=$1',[l1])).rows[0].n),2,'distinct buyers');
 assert.equal(Number((await q('select count(*) n from icash_seller_matches where lead_id=$1 and account_id=$2',[l1,a])).rows[0].n),1,'original buyer is not charged twice');
 assert.equal(Number((await q('select balance_cents from icash_wallets where account_id=$1',[second])).rows[0].balance_cents),1670);
 assert((await q('select next_assignment_at<=now() due from icash_seller_intakes where id=$1',[l1])).rows[0].due,'first three matches have no artificial delay');
 await q("update icash_seller_intakes set next_assignment_at='infinity' where id<>$1",[l1]);
 for(let count=3;count<=8;count++){
  const buyer=uuid();await q("insert into icash_accounts(id,billing_model,bot_paused,daily_limit_cents) values($1,'daily',false,10000)",[buyer]);
  await q('insert into icash_wallets(account_id,balance_cents) values($1,10000)',[buyer]);await q('insert into icash_spend_activations(account_id,enabled,customer_cap_cents) values($1,true,10000)',[buyer]);
  await q("insert into icash_bot_setups values($1,'{\"marketMode\":\"nationwide\"}')",[buyer]);
  await q("insert into icash_daily_plans(account_id,guest_hash,mode,state,consent_version,consent_text) values($1,$2,'live','active','daily-2026-10-04.1','Fixture consent')",[buyer,hash(buyer)]);
  if(count>3){assert.equal((await q('select icash_assign_seller_lead() j')).rows[0].j,null,'later wave waits');await q('update icash_seller_intakes set next_assignment_at=now() where id=$1',[l1]);}
  assert.equal((await q('select icash_assign_seller_lead() j')).rows[0].j.status,'assigned');
  assert.equal(Number((await q('select count(distinct account_id) n from icash_seller_matches where lead_id=$1',[l1])).rows[0].n),count);
  assert.equal(Number((await q('select balance_cents from icash_wallets where account_id=$1',[buyer])).rows[0].balance_cents),9670,'each buyer pays the same 3x cost price once');
  assert((await q('select next_assignment_at>=now()+interval \'23 hours\' paced from icash_seller_intakes where id=$1',[l1])).rows[0].paced);
 }
 await q('update icash_seller_intakes set next_assignment_at=now() where id=$1',[l1]);assert.equal((await q('select icash_assign_seller_lead() j')).rows[0].j,null,'eight-buyer cap blocks further assignments');
 assert.equal(Number((await q("select count(*) n from icash_screening_jobs where snapshot->'sellerRequest'->>'maximumBuyers'='8'")).rows[0].n),9,'each new match discloses the cap');

 const screen=(await q('select screening_id from icash_seller_intakes where id=$1',[l1])).rows[0].screening_id;
 await q("insert into icash_live_conversations values($1,$2,$3,'seller','complete',now(),'{\"durationSeconds\":0,\"transcript\":[]}')",[uuid(),a,screen]);await q('select icash_collect_seller_milestones()');assert.equal(Number((await q("select count(*) n from icash_seller_events where event_name='Contact'")).rows[0].n),0);
 await q("update icash_live_conversations set result='{\"durationSeconds\":12,\"transcript\":[{\"role\":\"user\",\"message\":\"Hello, this is the seller\"}]}'");await q('select icash_collect_seller_milestones()');await q('select icash_collect_seller_milestones()');assert.equal(Number((await q("select count(*) n from icash_seller_events where event_name='Contact'")).rows[0].n),1);
 const deal=uuid(),envelope=uuid();await q("insert into icash_deal_files values($1,$2,$3,now(),'{}')",[deal,a,screen]);
 await q("insert into icash_signing_envelopes values($1,$2,$3,'purchase',true,'completed','fixture-submission','{}')",[envelope,a,deal]);await q('select icash_collect_seller_milestones()');assert.equal(Number((await q("select count(*) n from icash_seller_events where event_name='SubmitApplication'")).rows[0].n),0,'test contracts never create purchase milestones');
 await q('update icash_signing_envelopes set test_mode=false where id=$1',[envelope]);await q('select icash_collect_seller_milestones()');await q('select icash_collect_seller_milestones()');assert.equal(Number((await q("select count(*) n from icash_seller_events where event_name='SubmitApplication'")).rows[0].n),1,'executed purchase milestone is emitted once');
 const event=(await q('select icash_claim_seller_event() j')).rows[0].j;await q('select icash_finish_seller_event($1,$2,true)',[event.id,event.token]);assert.equal((await q('select delivery_state from icash_seller_events where id=$1',[event.id])).rows[0].delivery_state,'delivered');
 for(const role of ['anon','authenticated'])for(const fn of ['icash_claim_seller_lookup()','icash_assign_seller_lead()','icash_seller_funnel_summary()'])assert.equal((await q('select has_function_privilege($1,$2,\'execute\') allowed',[role,fn])).rows[0].allowed,false);
 assert((await q("select bool_and(relrowsecurity) enabled from pg_class where relname like 'icash_seller_%' and relkind='r'")).rows[0].enabled);
 await pg.exec(file('supabase/migrations/20261005060500_homeoffer_contact_consent.sql'));
 await pg.exec(file('supabase/migrations/20261005061100_homeoffer_public_consent_copy.sql'));
 await pg.exec(file('supabase/migrations/20261005063000_homeoffer_single_contact_agreement.sql'));
 assert.equal(Number((await q("select count(*) n from icash_seller_intakes where email_consented or contact_consent_scope is not null")).rows[0].n),0,'legacy consent is never expanded');
 const {sellerConsentText,sellerSharingText,sellerConsentVersion}=await import('../lib/seller-leads.ts');
 const contactRequest=uuid();
 const contact=async(email='seller@example.invalid',accepted=true,request=contactRequest,version=sellerConsentVersion)=>q('select icash_submit_seller_contact_intake($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) id',[request,hash('contact-guest'),'Contact Seller','Synthetic Contact Address','+12145550123',hash(request),accepted,version,sellerConsentText,sellerSharingText,{},hash('agent'),email]);
 const contactId=(await contact()).rows[0].id;assert.equal((await contact()).rows[0].id,contactId,'same evidence retries once');
 const savedContact=(await q('select email,email_consented,contact_consent_scope,consent_text,sharing_text from icash_seller_intakes where id=$1',[contactId])).rows[0];
 assert.deepEqual(savedContact,{email:'seller@example.invalid',email_consented:true,contact_consent_scope:'homeoffer_network_and_matched_buyers',consent_text:sellerConsentText,sharing_text:sellerSharingText});
 await assert.rejects(contact('changed@example.invalid'),/retry mismatch/);await assert.rejects(contact('seller@example.invalid',false),/Contact agreement needed/);
 assert.equal((await q('select owner_claimed from icash_seller_intakes where id=$1',[contactId])).rows[0].owner_claimed,false,'no ownership assertion without the checkbox');
 const declined=(await contact('declined@example.invalid',false,uuid(),'homeoffer-seller-contact-2026-10-05.3')).rows[0].id;
 assert.deepEqual((await q('select ai_consented,email_consented,contact_consent_scope from icash_seller_intakes where id=$1',[declined])).rows[0],{ai_consented:false,email_consented:false,contact_consent_scope:null});
 const noEmail=(await contact(null,true,uuid())).rows[0].id;assert.equal((await q('select email_consented from icash_seller_intakes where id=$1',[noEmail])).rows[0].email_consented,false);
 await assert.rejects(contact('bad-email',true,uuid()),/Invalid email/);
 for(const role of ['anon','authenticated'])assert.equal((await q("select has_function_privilege($1,'icash_submit_seller_contact_intake(uuid,text,text,text,text,text,boolean,text,text,text,jsonb,text,text)','execute') allowed",[role])).rows[0].allowed,false);
 // Current distribution migration: preserve the historical tests above and verify
 // the new rules against actual SQL, without moving a real clock or provider.
 await pg.exec(`create table icash_text_suppressions(phone text primary key);create table icash_contact_suppressions(account_id uuid,contact_key text);alter table icash_live_conversations add column contact_key text;`);
 await pg.exec(file('supabase/migrations/20261005114251_seller_supply_owner_report.sql'));
 await pg.exec(file('supabase/migrations/20261005121451_three_user_inbound_distribution.sql'));
 for(const [n,hours] of [[0,0],[1,24],[2,72]]){
  const d=(await q("select extract(epoch from (icash_seller_assignment_due($1,now(),now())-now()))/3600 h",[n])).rows[0];assert.equal(Number(d.h),hours);
 }
 assert.equal((await q("select icash_seller_assignment_due(3,now(),now())='infinity'::timestamptz capped")).rows[0].capped,true);
 await q('update icash_accounts set bot_paused=true');
 await q("update icash_seller_intakes set next_assignment_at='infinity'");
 const recipients=[];
 for(let n=0;n<4;n++){
  const id=uuid();recipients.push(id);await q("insert into icash_accounts(id,billing_model,bot_paused,daily_limit_cents) values($1,'daily',false,$2)",[id,n===0?10000:1000]);
  await q('insert into icash_wallets(account_id,balance_cents) values($1,100000)',[id]);await q('insert into icash_spend_activations(account_id,enabled,customer_cap_cents) values($1,true,100000)',[id]);
  await q("insert into icash_bot_setups values($1,'{\"marketMode\":\"nationwide\"}')",[id]);
  await q("insert into icash_daily_plans(account_id,guest_hash,mode,state,consent_version,consent_text) values($1,$2,'live','active','daily-2026-10-04.1','Fixture consent')",[id,hash(id)]);
 }
 const fresh=await submit('New weighted lead');
 const specific=(await q('select icash_claim_seller_lookup_for($1) j',[fresh])).rows[0].j;
 assert.equal(specific.id,fresh,'submission callback claims its own lead, not old backlog');
 assert.equal((await q('select icash_claim_seller_lookup_for($1) j',[fresh])).rows[0].j,null,'duplicate callbacks cannot repeat lookup');
 await q("update icash_seller_intakes set state='qualified',lookup_cost_basis='Synthetic cost allocation',lookup_costs=$2,property=$3,result=$4,checked_at=now(),data_rights_until=now()+interval '10 days',numbers_passed=true,market_qualified=true,ad_cost_micros=1000000,ad_cost_receipt='fixture',next_assignment_at=now() where id=$1",[fresh,costs,{id:'prop_weighted',city:'Dallas',state:'TX',zip:'75217',fetchedAt:new Date().toISOString(),raw:{}},{financialCheck:{status:'eligible'}}]);
 assert.equal((await q('select icash_assign_seller_lead() j')).rows[0].j.status,'assigned');
 assert.equal((await q('select assigned_account from icash_seller_intakes where id=$1',[fresh])).rows[0].assigned_account,recipients[0],'larger funded budget wins first access when equally served');
 await q('update icash_seller_intakes set next_assignment_at=now() where id=$1',[fresh]);
 assert.equal((await q('select icash_assign_seller_lead() j')).rows[0].j,null,'a receipt/queue reset cannot bypass the 24-hour delay');
 await q("update icash_seller_matches set assigned_at=now()-interval '25 hours' where lead_id=$1",[fresh]);
 assert.equal((await q('select icash_assign_seller_lead() j')).rows[0].j.status,'assigned');
 for(let n=3;n<=3;n++){
  assert.equal((await q('select icash_assign_seller_lead() j')).rows[0].j,null,'later recipient waits');
  await q("update icash_seller_matches set assigned_at=now()-interval '8 days' where lead_id=$1",[fresh]);
  await q("update icash_seller_intakes set next_assignment_at=now(),checked_at=now()-interval '6 days' where id=$1",[fresh]);
  assert.equal((await q('select icash_assign_seller_lead() j')).rows[0].j.status,'assigned','shared original research does not rerun lookup per recipient');
 }
 assert.deepEqual((await q('select count(*)::int n,count(distinct account_id)::int users,min(charge_cents)::int low,max(charge_cents)::int high from icash_seller_matches where lead_id=$1',[fresh])).rows[0],{n:3,users:3,low:330,high:330});
 assert.equal((await q("select count(*)::int n from icash_screening_jobs s join icash_seller_matches m on m.screening_id=s.id where m.lead_id=$1 and s.snapshot->'sellerRequest'->>'maximumBuyers'='3'",[fresh])).rows[0].n,3,'all new matches record the three-user cap');
 assert.equal((await q("select count(*)::int n from icash_screening_jobs s join icash_seller_matches m on m.screening_id=s.id where m.lead_id=$1 and s.completed_at<now()-interval '5 days'",[fresh])).rows[0].n,1,'later assignment never fabricates a new research timestamp');
 await q('update icash_seller_intakes set next_assignment_at=now() where id=$1',[fresh]);assert.equal((await q('select icash_assign_seller_lead() j')).rows[0].j,null);
 // New fresh lead should reach the account that has received none in 24h.
 const nextLead=await submit('Second weighted lead');
 await q("update icash_seller_intakes set state='qualified',lookup_cost_basis='Synthetic cost allocation',lookup_costs=$2,property=$3,result=$4,checked_at=now(),data_rights_until=now()+interval '10 days',numbers_passed=true,market_qualified=true,ad_cost_micros=1000000,ad_cost_receipt='fixture',next_assignment_at=now() where id=$1",[nextLead,costs,{id:'prop_next',city:'Dallas',state:'TX',zip:'75217',fetchedAt:new Date().toISOString(),raw:{}},{financialCheck:{status:'eligible'}}]);
 // Give high-budget account recent deliveries, leaving one small account unserved.
 await q('update icash_seller_matches set assigned_at=now() where lead_id=$1',[fresh]);
 const waiting=(await q('select id from icash_accounts where id=any($1::uuid[]) and not exists(select 1 from icash_seller_matches m where m.account_id=icash_accounts.id)',[recipients])).rows[0].id;
 assert.equal((await q('select icash_assign_seller_lead() j')).rows[0].j.status,'assigned');
 assert.equal((await q('select assigned_account from icash_seller_intakes where id=$1',[nextLead])).rows[0].assigned_account,waiting,'smaller account without a daily lead precedes an already-served larger account');
 const summary=(await q('select icash_seller_demand_summary() j')).rows[0].j;
 assert.equal(summary.activeAccounts,4);assert.equal(summary.accountsWithoutLead24h,0);assert(summary.deliveries24h>=4);
 // A seller stop or a completed purchase prevents another paid distribution.
 await q("update icash_seller_matches set assigned_at=now()-interval '25 hours' where lead_id=$1",[nextLead]);await q('update icash_seller_intakes set next_assignment_at=now() where id=$1',[nextLead]);
 await q("insert into icash_text_suppressions values('+12145550123')");
 assert.equal((await q('select icash_assign_seller_lead() j')).rows[0].j,null,'global STOP excludes lead');
 await q('delete from icash_text_suppressions');
 const sm=(await q('select * from icash_seller_matches where lead_id=$1',[nextLead])).rows[0];const signedDeal=uuid();
 await q("insert into icash_deal_files values($1,$2,$3,now(),'{}')",[signedDeal,sm.account_id,sm.screening_id]);
 await q("insert into icash_signing_envelopes values($1,$2,$3,'purchase',false,'completed','fixture-signed','{}')",[uuid(),sm.account_id,signedDeal]);
 assert.equal((await q('select icash_assign_seller_lead() j')).rows[0].j,null,'signed purchase excludes lead');
 for(const role of ['anon','authenticated'])for(const fn of ['icash_claim_seller_lookup_for(uuid)','icash_seller_demand_summary()'])assert.equal((await q('select has_function_privilege($1,$2,\'execute\') allowed',[role,fn])).rows[0].allowed,false);
 console.log('PASS weighted inbound distribution: 3 unique charges, 24/72-hour pacing, priority for larger budgets, daily coverage for small accounts, research reuse, suppressed/contracted exclusions, targeted lookup claims and owner-only demand.');
 console.log('PASS HomeOffer contact evidence: exact copy/version, optional email, explicit channel choice, historical sharing evidence, legacy preservation, idempotency and private RPC.');
 console.log('PASS isolated SQL: $10 minimum, historical invoice compatibility, immutable price versions, 3× rates, renewal caps, pause preservation, intake consent/idempotency, zero-budget lookup hold, one-use provider claims, exact CPA allocation, funded daily bid limit, next-day queue, exactly-once debit, factual call milestones, event claims, RLS and private RPCs.');
}catch(e){console.error(e);process.exitCode=1;}finally{await pg.close();}
