import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=await PGlite.create(),q=(s,a=[])=>db.query(s,a),one=async(s,a=[])=>(await q(s,a)).rows[0];
const account=randomUUID(),user=randomUUID(),other=randomUUID(),screen=randomUUID(),deal=randomUUID(),thread=randomUUID(),rate=randomUUID(),message=randomUUID();
const context=async(a=account,u=user)=>(await one('select icash_usage_loop_context($1,$2) result',[a,u])).result;
const realSnapshot={propertyId:'fixture'},realResult={property:{propertyId:'fixture'},financialCheck:{status:'eligible'}};
const excludedAnalyses=[
 [realSnapshot,null],[realSnapshot,[]],[realSnapshot,{}],
 [realSnapshot,{property:{propertyId:'fixture'}}],
 [realSnapshot,{...realResult,practice:true}],
 [realSnapshot,{...realResult,property:{propertyId:'practice_result'}}],
 [{...realSnapshot,practice:true},realResult],
 [{propertyId:'practice_snapshot'},realResult],
];
const setAnalysis=(snapshot=realSnapshot,result=realResult)=>q('update icash_screening_jobs set snapshot=$1::jsonb,result=$2::jsonb where id=$3',[JSON.stringify(snapshot),JSON.stringify(result),screen]);
let n=0;const pass=label=>console.log(`PASS ${++n}/5 ${label}`);
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean default false);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,state text,snapshot jsonb,completed_at timestamptz,result jsonb);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb default '{}');
 create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,party text,recipient text,paused boolean default false,manual_only boolean default false,ai_mode text default 'auto',retired_at timestamptz,sms_rate_id uuid);
 create table icash_text_messages(id uuid primary key,account_id uuid,thread_id uuid,direction text,state text,event_id text,provider_id text,body text default '',asset_ids uuid[] default '{}',customer_price_micros bigint,created_at timestamptz default now(),updated_at timestamptz default now());
 create table icash_text_events(id text primary key,type text);
 create table icash_text_suppressions(phone text primary key);
 create table icash_signing_envelopes(id uuid primary key,account_id uuid,deal_id uuid,kind text,state text,test_mode boolean default false,provider_id text,updated_at timestamptz default now());
 create table icash_closing_updates(id uuid primary key,account_id uuid,deal_id uuid,reply_id uuid,kind text,confirmed_by uuid,confirmation_source text,effective_date date,created_at timestamptz default now());
 create table icash_title_replies(id uuid primary key,account_id uuid,deal_id uuid,sender_verified boolean);
 create table icash_funding_orders(account_id uuid,mode text,state text,credited_at timestamptz);
 create table icash_operation_spend(account_id uuid,operation_key text,state text);
 create table icash_billing_reviews(account_id uuid,resolved_at timestamptz);
 create table icash_property_controls(account_id uuid,property_id text,manual boolean);
 create table icash_handoffs(account_id uuid,screening_id uuid,state text);
 create table icash_journey_messages(id uuid primary key,account_id uuid,message_id uuid,thread_id uuid,body text,state text);
 create table icash_buyer_package_texts(message_id uuid,thread_id uuid);
 create table icash_discovery_configs(account_id uuid,contact_rate_id uuid,enabled boolean,auto_enabled boolean,contacts_enabled boolean,data_rights_until timestamptz);
 create table icash_operation_rates(id uuid primary key,operation text,enabled boolean,verified_at timestamptz,expires_at timestamptz);
 create table icash_operating_budget(id int primary key,enabled boolean);insert into icash_operating_budget values(1,true);
 create table icash_customer_identities(account_id uuid,principal text);
 create table icash_text_senders(phone text primary key,enabled boolean);
 create table fixture_gates(account_id uuid primary key,member boolean default true,campaign boolean default false,review boolean default true,vip boolean default false,reserved boolean default false,buyer_hold boolean default false,current_message boolean default true,enrichment uuid,package_body text default 'Current package');
 create function icash_sms_single_segment(text) returns boolean language sql as $$select length($1) between 1 and 160$$;
 create function icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql as $$select coalesce((select review from public.fixture_gates where account_id=$1),false)$$;
 create function icash_sms_intake_rate_current(uuid) returns boolean language sql as $$select exists(select 1 from public.icash_operation_rates where id=$1 and operation='sms_send' and enabled and verified_at<=now() and expires_at>now())$$;
 create function icash_buyer_outreach_held(uuid,uuid) returns boolean language sql as $$select buyer_hold from public.fixture_gates where account_id=$1$$;
 create function icash_buyer_is_reserved(uuid,uuid) returns boolean language sql as $$select reserved from public.fixture_gates where account_id=$1$$;
 create function icash_buyer_outreach_content(uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('sms',package_body) from public.fixture_gates where account_id=$1$$;
 create function icash_buyer_package_brand(text) returns text language sql as $$select $1$$;
 create function icash_journey_message_current(uuid) returns boolean language sql as $$select f.current_message from public.fixture_gates f join public.icash_journey_messages j on j.account_id=f.account_id where j.id=$1$$;
 create function icash_vip_active(uuid) returns boolean language sql as $$select vip from public.fixture_gates where account_id=$1$$;
 create function icash_enrichment_candidate(uuid) returns uuid language sql as $$select enrichment from public.fixture_gates where account_id=$1$$;
 create function icash_membership_work_allowed(uuid) returns boolean language sql as $$select member from public.fixture_gates where account_id=$1$$;
 create function icash_outreach_sms_current(uuid) returns boolean language sql as $$select campaign from public.fixture_gates where account_id=$1$$;
 `);
 const source=readFileSync('config/usage-loop-context.sql','utf8');
 assert.equal(readFileSync('supabase/migrations/20261015075432_usage_loop_context.sql','utf8'),source);await db.exec(source);
 await q('insert into icash_accounts values($1,$2,true)',[account,user]);await q('insert into fixture_gates(account_id) values($1)',[account]);
 let c=await context();assert.equal(c.ready,false);assert.equal(c.hasHistory,false);assert.equal(c.work,null);assert.equal(c.progress,null);
 await assert.rejects(context(account,other),/Account ownership/);await assert.rejects(context(other,user),/Account ownership/);
 await q('insert into icash_operation_rates values($1,\'sms_send\',true,now()-interval \'1 day\',now()+interval \'1 day\')',[rate]);
 await q(`insert into icash_customer_identities values($1,'Fixture business')`,[account]);await q(`insert into icash_text_senders values('+12145550100',true)`);await q('update fixture_gates set campaign=true');
 c=await context();assert.equal(c.ready,true);assert.equal(c.work,null);assert.equal(c.hasHistory,false,'New account can see generic startup, with no fabricated queue');
 await q('update fixture_gates set member=false');assert.equal((await context()).ready,false);await q('update fixture_gates set member=true');
 pass('Tenant ownership and configured first funding readiness; no synthetic queue/history');

 await q(`insert into icash_screening_jobs values($1,$2,'complete',$3::jsonb,now(),$4::jsonb)`,[screen,account,JSON.stringify(realSnapshot),JSON.stringify(realResult)]);
 await q(`insert into icash_deal_files values($1,$2,$3,'under_contract','{}')`,[deal,account,screen]);
 await q(`insert into icash_text_threads(id,account_id,deal_id,party,recipient,sms_rate_id) values($1,$2,$3,'seller','+12145550101',$4)`,[thread,account,deal,rate]);
 await q(`insert into icash_text_messages(id,account_id,thread_id,direction,state,event_id,body) values($1,$2,$3,'incoming','received','incoming-receipt','Yes, please follow up')`,[message,account,thread]);
 assert.equal((await context()).progress.kind,'research_complete','Raw claimed receipt is not progress');
 await q(`insert into icash_text_events values('incoming-receipt','text.incoming.sms')`);
 c=await context();assert.equal(c.progress.kind,'seller_reply');assert.equal(c.progress.count,1);assert.equal(c.hasHistory,true);
 const envelope=randomUUID();await q(`insert into icash_signing_envelopes(id,account_id,deal_id,kind,state,test_mode) values($1,$2,$3,'purchase','completed',true)`,[envelope,account,deal]);
 assert.equal((await context()).progress.kind,'seller_reply');await q('update icash_signing_envelopes set test_mode=false');assert.equal((await context()).hasDeal,false);
 await q(`update icash_signing_envelopes set provider_id='verified-envelope'`);c=await context();assert.equal(c.progress.kind,'contract_signed');assert.equal(c.hasDeal,true);
 pass('Progress requires persisted inbound receipts and completed live signing evidence');

 const outgoing=randomUUID(),journey=randomUUID();await q(`insert into icash_text_messages(id,account_id,thread_id,direction,state,body,customer_price_micros) values($1,$2,$3,'outgoing','ready','Current follow-up',208000)`,[outgoing,account,thread]);
 await q(`insert into icash_journey_messages values($1,$2,$3,$4,'Current follow-up','ready')`,[journey,account,outgoing,thread]);
 c=await context();assert.equal(c.work.kind,'seller_followup');assert.equal(c.work.estimateCents,21);assert.equal(c.ready,true,'No wallet balance is fabricated or required by this evidence read');
 for(const [snapshot,result] of excludedAnalyses){
  await setAnalysis(snapshot,result);c=await context();
  assert.equal(c.progress,null,'Practice or incomplete analysis cannot provide progress');
  assert.equal(c.hasHistory,false,'Practice or incomplete analysis cannot establish work history');
  assert.equal(c.hasDeal,false,'Practice or incomplete analysis cannot establish an active live deal');
  assert.equal(c.work,null,'Practice or incomplete analysis cannot justify paid SMS work');
  await q(`insert into icash_handoffs values($1,$2,'open')`,[account,screen]);
  assert.equal((await context()).needsReview,false,'Excluded analysis cannot surface an active deal blocker');
  await q('delete from icash_handoffs');
 }
 await setAnalysis();assert.equal((await context()).work.kind,'seller_followup');
 await q('update fixture_gates set vip=true');assert.equal((await context()).work.estimateCents,17);
 await q(`update icash_text_messages set body='Stale edited content' where id=$1`,[outgoing]);assert.equal((await context()).work,null);
 await q(`update icash_text_messages set body='Current follow-up' where id=$1`,[outgoing]);await q('update fixture_gates set current_message=false');assert.equal((await context()).work,null);await q('update fixture_gates set current_message=true');
 await q(`insert into icash_property_controls values($1,'fixture',true)`,[account]);c=await context();assert.equal(c.work,null);assert.equal(c.needsReview,true);await q('delete from icash_property_controls');
 await q(`insert into icash_operation_spend values($1,$2,'dispatched')`,[account,'text:'+outgoing]);assert.equal((await context()).work,null);await q('delete from icash_operation_spend');
 await q(`insert into icash_text_suppressions values('+12145550101')`);assert.equal((await context()).work,null);await q('delete from icash_text_suppressions');
 for(const stage of ['closed','cancelled','cancellation_pending']){await q('update icash_deal_files set stage=$1',[stage]);assert.equal((await context()).work,null);}
 await q(`update icash_deal_files set stage='under_contract'`);await q(`update icash_screening_jobs set state='archived'`);c=await context();assert.equal(c.work,null);assert.equal(c.progress,null);assert.equal(c.hasDeal,false);await q(`update icash_screening_jobs set state='complete'`);
 pass('Only exact current unattempted work counts; VIP price, manual, STOP, cancelled and archived gates hold');

 await q(`delete from icash_journey_messages`);await q(`update icash_text_threads set party='buyer'`);await q(`update icash_text_messages set body='Current package' where id=$1`,[outgoing]);await q('insert into icash_buyer_package_texts values($1,$2)',[outgoing,thread]);
 assert.equal((await context()).work.kind,'buyer_outreach');await q('update fixture_gates set reserved=true');assert.equal((await context()).work,null);await q('update fixture_gates set reserved=false,buyer_hold=true');assert.equal((await context()).work,null);await q('update fixture_gates set buyer_hold=false');
 await q(`update icash_text_messages set state='needs_review' where id=$1`,[outgoing]);assert.equal((await context()).needsReview,true);
 await q(`update icash_text_messages set state='cancelled' where id=$1`,[outgoing]);await q('update fixture_gates set enrichment=$1',[screen]);
 const researchRate=randomUUID();await q(`insert into icash_operation_rates values($1,'owner_enrichment',true,now()-interval '1 day',now()+interval '1 day')`,[researchRate]);await q(`insert into icash_discovery_configs values($1,$2,true,true,true,now()+interval '1 day')`,[account,researchRate]);
 c=await context();assert.equal(c.work.kind,'research');assert.equal(c.work.estimateCents,null);
 for(const [snapshot,result] of excludedAnalyses){await setAnalysis(snapshot,result);assert.equal((await context()).work,null,'Even a nominated research candidate requires real non-practice analysis');}
 await setAnalysis();assert.equal((await context()).work.kind,'research');
 await q('update icash_operation_rates set enabled=false where id=$1',[researchRate]);assert.equal((await context()).work,null);await q('update fixture_gates set enrichment=null');
 pass('Buyer reservations/holds suppress outreach; actual research candidates never price free screening');

 // The business date is Central time; UTC may already be the following day.
 await q(`update icash_deal_files set stage='closed'`);const reply=randomUUID();await q('insert into icash_title_replies values($1,$2,$3,false)',[reply,account,deal]);await q(`insert into icash_closing_updates(id,account_id,deal_id,reply_id,kind,confirmed_by,effective_date) values($1,$2,$3,$4,'closed',$5,(now() at time zone 'America/Chicago')::date)`,[randomUUID(),account,deal,reply,user]);
 assert.notEqual((await context()).progress.kind,'closed');await q('update icash_title_replies set sender_verified=true');assert.equal((await context()).progress.kind,'closed');
 const before=(await one('select count(*)::int n from icash_text_messages')).n;await context();await context();assert.equal((await one('select count(*)::int n from icash_text_messages')).n,before);assert.equal((await one('select count(*)::int n from icash_operation_spend')).n,0);
 for(const role of ['anon','authenticated'])assert.equal((await one(`select has_function_privilege($1,'icash_usage_loop_context(uuid,uuid)','EXECUTE') ok`,[role])).ok,false);
 pass('Closing needs verified title evidence; repeated reads create no work, spend or browser permissions');
}finally{await db.close();}
