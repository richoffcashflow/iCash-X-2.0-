// Local PostgreSQL only. No provider transport, live data or customer credits.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {journeyNextAction} from '../lib/deal-journey-progress.ts';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
globalThis.fetch=async()=>{throw Error('Network disabled for local scenarios');};
const q=(sql,args=[])=>pg.query(sql,args),one=async(sql,args=[])=>(await q(sql,args)).rows[0];
const rpc=async(name,args=[])=>(await one(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).result;
const fn=(file,name)=>{const s=readFileSync(file,'utf8'),a=s.indexOf(`create function public.${name}(`);assert(a>=0,name);return s.slice(a,s.indexOf('end $$;',a)+7);};
let passed=0;const pass=s=>console.log(`PASS ${++passed} ${s}`);
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now());
 create table icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean default false);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,state text default 'complete',snapshot jsonb default '{"propertyId":"fixture"}');
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text default 'under_contract',terms jsonb default '{}',updated_at timestamptz default now());
 create table icash_signing_envelopes(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,kind text,state text,test_mode boolean default false,terms jsonb default '{}',recipients jsonb default '[]',created_at timestamptz default now(),updated_at timestamptz default now());
 create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,party text,recipient text,paused boolean default false,manual_only boolean default false,ai_mode text default 'auto',retired_at timestamptz);
 create table icash_text_suppressions(phone text primary key);
 create table icash_text_messages(id uuid primary key default gen_random_uuid(),account_id uuid,thread_id uuid,body text,direction text default 'outgoing',created_at timestamptz default now(),state text,provider_id text,request_key uuid unique);
 create table icash_buyer_viewing_requests(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,screening_id uuid,thread_id uuid,kind text default 'viewing',quote text,viewing_quote text,title_quote text,state text default 'needs_confirmation');
 create table icash_showing_requests(id uuid primary key default gen_random_uuid(),deal_id uuid,buyer_name text,starts_at timestamptz,ends_at timestamptz,timezone text,state text default 'proposed',version integer default 1,buyer_request_id uuid,seller_confirmed_at timestamptz,buyer_confirmed_at timestamptz,seller_note text,buyer_note text,change_note text,history jsonb default '[]',created_at timestamptz default now(),updated_at timestamptz default now(),check(state<>'confirmed' or(seller_confirmed_at is not null and buyer_confirmed_at is not null)));
 create table icash_seller_viewing_availability(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,screening_id uuid,thread_id uuid,source text constraint icash_seller_viewing_availability_source_check check(source in('text','owner','call','outbound_call')),source_id uuid,quote text,slots jsonb,state text,timezone text,stated_at timestamptz,created_at timestamptz default now());
 create table icash_closing_setup(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid unique,screening_id uuid,payout jsonb,title_proposal jsonb,state text default 'needs_review',review_reason text default 'setup',reply_id uuid,buyer_request_id uuid,updated_at timestamptz default now());
 create table icash_title_contacts(account_id uuid,deal_id uuid,email text,enabled boolean default true,verified_until timestamptz default now()+interval '1 day');
 create table icash_title_requests(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,state text,created_at timestamptz default now());
 create table icash_closing_updates(account_id uuid,deal_id uuid,kind text,created_at timestamptz default now());
 create table icash_title_tasks(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,source_key text unique,kind text,label text,due_date date,state text,evidence text,payload jsonb,updated_at timestamptz default now());
 create table icash_property_controls(account_id uuid,property_id text,manual boolean,unique(account_id,property_id));
 create table icash_text_attention(id uuid primary key default gen_random_uuid(),account_id uuid,screening_id uuid,thread_id uuid,message_id uuid,kind text,party text,quote text,state text default 'open');
 create table icash_handoffs(conversation_id uuid,id uuid primary key default gen_random_uuid(),account_id uuid,screening_id uuid,party text,reason text,summary text,next_action text,state text default 'open',created_at timestamptz default now(),resolved_at timestamptz);
 create table icash_buyer_deposit_receipts(account_id uuid,deal_id uuid,envelope_id uuid);
 create function icash_buyer_outreach_held(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_signing_action_allowed(uuid,uuid) returns boolean language sql as $$select true$$;
 create function icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql as $$select true$$;
 create function icash_sms_single_segment(text) returns boolean language sql as $$select octet_length($1)=length($1) and length($1)<=160$$;
 create function icash_title_contact_matches(uuid,uuid,text) returns boolean language sql as $$select true$$;
 create function icash_buyer_package_data(uuid,uuid) returns jsonb language sql as $$select '{"askingPriceCents":12500000,"depositCents":200000,"assignmentFeeCents":1000000,"purchasePriceCents":11500000}'::jsonb$$;
 create function icash_set_work_control(p_user uuid,p_account uuid,p_action text,p_screening uuid) returns void language plpgsql set search_path=public as $$begin
  if not exists(select 1 from icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Owner required';end if;
  insert into icash_property_controls values(p_account,'fixture',p_action<>'return_to_bot') on conflict(account_id,property_id) do update set manual=excluded.manual;end$$;
 create function icash_save_closing_setup(p_account uuid,p_actor uuid,p_deal uuid,p_action text,p_data jsonb) returns jsonb language plpgsql set search_path=public as $$begin
  if not exists(select 1 from icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Owner required';end if;
  if p_action='payout' then update icash_closing_setup set payout=p_data where deal_id=p_deal and account_id=p_account;
  elsif p_action='title_preference' then update icash_closing_setup set title_proposal=p_data where deal_id=p_deal and account_id=p_account;end if;
  return '{}'::jsonb;end$$;
 create function icash_attention_sources(uuid) returns table(kind text,category text,source_id uuid,source_version text,screening_id uuid,event_at timestamptz,priority integer) language sql as $$select null::text,null::text,null::uuid,null::text,null::uuid,null::timestamptz,null::integer where false$$;
 create function icash_queue_text(a uuid,t uuid,k uuid,b text,assets uuid[]) returns uuid language plpgsql set search_path=public as $$declare mid uuid;begin
  insert into icash_text_messages(account_id,thread_id,body,state,request_key) values(a,t,b,'ready',k) on conflict(request_key) do nothing;
  select id into mid from icash_text_messages where request_key=k;return mid;end$$;
 create function icash_claim_text(a uuid,m uuid,s text) returns jsonb language plpgsql set search_path=public as $$begin update icash_text_messages set state='dispatching' where id=m and account_id=a and state='ready';if found then return '{}'::jsonb;end if;return null;end$$;
 `);
 await pg.exec(fn('config/seller-viewing-availability-and-buyer-intent.sql','icash_parse_viewing_slot'));
 const slots=readFileSync('config/seller-viewing-availability-and-buyer-intent.sql','utf8');const a=slots.indexOf('create function public.icash_current_viewing_slots(');await pg.exec(slots.slice(a,slots.indexOf('$$;',a)+3));
 await pg.exec(fn('supabase/migrations/20261010084029_closing_workflow_gaps.sql','icash_manage_showing'));
 await pg.exec(readFileSync('config/turnkey-deal-journey.sql','utf8'));
 await pg.exec(`
 alter table icash_buyer_viewing_requests add column coordination_quote text,add column reviewed_at timestamptz,add column resolution_note text;
 alter table icash_buyer_viewing_requests add constraint fixture_request_state check(state in ('needs_confirmation','reviewed'));
 alter table icash_deal_files add column created_at timestamptz default now(),add column seller_signed_at timestamptz,add column assignment_signed_at timestamptz;
 alter table icash_signing_envelopes add column provider_id text default 'fixture_provider';
 alter table icash_title_contacts add column evidence_ref text default 'owner-closing-verification:fixture';
 alter table icash_closing_updates add column id uuid default gen_random_uuid() primary key,add column amount_cents bigint,add column effective_date date,add column reply_id uuid,add column file_reference text default '',add column confirmed_by uuid,add column confirmation_source text default 'user_review';
 alter table icash_buyer_deposit_receipts add column created_at timestamptz default now();
 alter table icash_text_attention add column deal_id uuid,add column created_at timestamptz default now();
 alter table icash_title_requests add column updated_at timestamptz default now();
 create table icash_title_replies(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,sender_verified boolean default true);
 create table icash_buyer_package_links(account_id uuid,deal_id uuid,token text,revoked_at timestamptz);
 create table icash_network_buyers(id uuid primary key default gen_random_uuid(),user_id uuid,email text,name text,zips text[],property_types text[],paused boolean default false,expires_at timestamptz default now()+interval '30 days');
 create table icash_email_suppressions(email text);
 create table icash_funding_orders(account_id uuid,mode text,state text);
 create function icash_update_title_task(uuid,uuid,text,date) returns boolean language sql as $$select true$$;
 create table fixture_access(owner_id uuid,vip_account uuid);
 create function icash_vip_active(uuid) returns boolean language sql as $$select exists(select 1 from public.fixture_access where vip_account=$1)$$;
 create function icash_owner_overview(p_actor uuid,p_days integer,p_include boolean,p_query text,p_page integer) returns jsonb language plpgsql as $$begin if not exists(select 1 from public.fixture_access where owner_id=p_actor) then raise exception 'Owner required';end if;return jsonb_build_object('startAt',now()-interval '30 days');end$$;
 `);
 const combined=readFileSync('config/closing-completion.sql','utf8').replace(/commit;\n$/,'')+readFileSync('config/closing-operations.sql','utf8').replace(/^begin;\nset local lock_timeout='3s';\n/,'');
 const release=readFileSync('supabase/migrations/20261011165415_closing_completion.sql','utf8');
 assert.equal(release,combined,'Release migration must match reviewed configuration');
 await pg.exec(release);
 const owner=randomUUID(),other=randomUUID(),account=randomUUID(),otherAccount=randomUUID(),deal=randomUUID(),screen=randomUUID(),buyer=randomUUID(),seller=randomUUID();
 await q('insert into auth.users(id,email) values($1,$2),($3,$4)',[owner,'owner@example.invalid',other,'other@example.invalid']);
 await q('insert into icash_accounts(id,owner_user_id) values($1,$2),($3,$4)',[account,owner,otherAccount,other]);
 await q('insert into fixture_access values($1,$2)',[owner,account]);
 await q('insert into icash_screening_jobs(id,account_id) values($1,$2)',[screen,account]);
 await q("insert into icash_deal_files(id,account_id,screening_id,terms,seller_signed_at) values($1,$2,$3,$4,now())",[deal,account,screen,{address:'100 Fixture Lane',priceCents:11500000,assignmentFeeCents:1000000,assignmentDepositCents:200000}]);
 await q("insert into icash_text_threads(id,account_id,deal_id,party,recipient) values($1,$2,$3,'buyer','+12145550123'),($4,$2,$3,'seller','+12145550124')",[buyer,account,deal,seller]);
 await q("insert into icash_signing_envelopes(account_id,deal_id,kind,state,recipients) values($1,$2,'purchase','completed',$3)",[account,deal,[{phone:'+12145550124'},{email:'owner@example.invalid'}]]);
 await q("insert into icash_buyer_viewing_requests(account_id,deal_id,screening_id,thread_id,kind) values($1,$2,$3,$4,'viewing')",[account,deal,screen,buyer]);
 let j=await one('select * from icash_deal_journeys');
 await q('insert into icash_buyer_package_links values($1,$2,$3,null)',[account,deal,'a'.repeat(32)]);
 await rpc('icash_advance_journey',[j.id]);j=await one('select * from icash_deal_journeys');
 const view=await rpc('icash_read_journey',[j.buyer_token]);assert.equal(view.packageUrl,'https://homeoffernetwork.com/d/'+'a'.repeat(32));
 assert(!JSON.stringify(view).includes('11500000'));assert(!Object.hasOwn(view,'assignmentFeeCents'));
 assert(!Object.hasOwn(await rpc('icash_read_journey',[j.seller_token]),'packageUrl'));
 await assert.rejects(rpc('icash_submit_journey',[j.seller_token,'request_assignment',{}]));
 await rpc('icash_submit_journey',[j.buyer_token,'request_assignment',{}]);await rpc('icash_submit_journey',[j.buyer_token,'request_assignment',{}]);
 assert((await one('select wants_assignment from icash_deal_journeys')).wants_assignment);
 pass('Package links and buy/view actions preserve buyer privacy, identity and idempotency');

 await rpc('icash_submit_journey',[j.buyer_token,'blocker',{kind:'access',note:'Saturday works better'}]);
 await rpc('icash_submit_journey',[j.buyer_token,'blocker',{kind:'access',note:'Saturday works better'}]);
 assert.equal((await one('select revision from icash_journey_blockers')).revision,1);
 await rpc('icash_advance_journey',[j.id]);await rpc('icash_advance_journey',[j.id]);
 assert.equal((await one("select count(*)::int n from icash_journey_messages where event_key='access_help:1'")).n,1);
 const accessMessage=await one("select * from icash_journey_messages where event_key='access_help:1'");
 assert.equal(await rpc('icash_journey_message_current',[accessMessage.id]),true);
 const day=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
 await rpc('icash_submit_journey',[j.seller_token,'availability',{windows:[`${day} 2:00 PM to 4:00 PM Central`]}]);await rpc('icash_advance_journey',[j.id]);
 assert.equal((await one('select state from icash_journey_blockers')).state,'resolved');
 assert.equal(await rpc('icash_journey_message_current',[accessMessage.id]),false);
 const slot=(await rpc('icash_read_journey',[j.buyer_token])).slots[0];assert(slot);
 await rpc('icash_submit_journey',[j.buyer_token,'blocker',{kind:'access',note:'Checking these times'}]);
 await rpc('icash_submit_journey',[j.buyer_token,'choose_time',{startsAt:slot.startsAt}]);
 assert.equal((await one('select state from icash_journey_blockers')).state,'resolved');
 assert.equal((await one("select state from icash_title_tasks where source_key like '%:blocker'")).state,'done');
 const visit=await one('select * from icash_showing_requests');assert.equal(visit.state,'proposed');
 await rpc('icash_submit_journey',[j.seller_token,'confirm',{id:visit.id,version:visit.version}]);await rpc('icash_advance_journey',[j.id]);
 assert.equal((await one('select state from icash_buyer_viewing_requests where id=$1',[j.request_id])).state,'reviewed');
 pass('Access requests ask the seller once and resolve only after new availability');

 const details={legalName:'Fixture Buyer LLC',signerName:'Fixture Buyer',email:'buyer@example.invalid',fundsReady:true,authorized:true,titleCompany:'Local Title',askingPriceCents:12500000,depositCents:200000};
 await rpc('icash_submit_journey',[j.buyer_token,'details',details]);
 for(const kind of ['price','timing','repairs','funding','human']){
  await rpc('icash_submit_journey',[j.buyer_token,'blocker',{kind,note:'Please call me about this request'}]);
  assert.equal(await rpc('icash_claim_journey_assignment',[j.id]),null);
  const progress=(await rpc('icash_journey_progress',[account,[screen]]))[0];assert.equal(progress.blocker.kind,kind);assert.equal(journeyNextAction(progress).waitingOn,'You');
  const intake=await one("select id from icash_journey_messages where event_key='buyer_intake'");assert.equal(await rpc('icash_journey_message_current',[intake.id]),false);
 }
 assert.equal((await rpc('icash_read_journey',[j.buyer_token])).state,'human_review');
 assert.equal(await rpc('icash_journey_allowed',[account,deal]),false);
 const human=await one('select id from icash_handoffs where portal_journey_id=$1',[j.id]);
 await assert.rejects(rpc('icash_manage_handoff',[account,owner,human.id,'resolve',null,null,'Old unversioned request',true]));
 const task=await one("select id from icash_title_tasks where source_key like '%:blocker'");
 assert.equal(await rpc('icash_update_title_task',[account,task.id,'dismissed',null]),false);
 assert.equal((await rpc('icash_task_recoveries',[account,[task.id]])).length,1);
 assert.deepEqual(await rpc('icash_task_recoveries',[otherAccount,[task.id]]),[]);
 const blocker=await one('select * from icash_journey_blockers');
 await assert.rejects(rpc('icash_resolve_journey_blocker',[account,other,j.id,blocker.revision,'Confirmed with buyer']));
 await assert.rejects(rpc('icash_resolve_journey_blocker',[otherAccount,other,j.id,blocker.revision,'Confirmed with buyer']));
 await assert.rejects(rpc('icash_resolve_journey_blocker',[account,owner,j.id,blocker.revision-1,'Confirmed with buyer']));
 await rpc('icash_resolve_journey_blocker',[account,owner,j.id,blocker.revision,'Spoke with buyer; current terms approved']);
 await rpc('icash_resolve_journey_blocker',[account,owner,j.id,blocker.revision,'Spoke with buyer; current terms approved']);
 assert.equal((await one('select state from icash_handoffs where portal_journey_id=$1',[j.id])).state,'resolved');
 assert((await rpc('icash_claim_journey_assignment',[j.id])).id);assert.equal(await rpc('icash_claim_journey_assignment',[j.id]),null);
 assert.equal((await one('select terms from icash_deal_files')).terms.priceCents,11500000);
 pass('Price, timing, repair, funding and human requests hold automation; owner resolution is versioned and tenant-safe');

 await q("update icash_deal_journeys set state='collecting',buyer_details=null,last_progress_at=now()-interval '4 days' where id=$1",[j.id]);
 await rpc('icash_advance_journey',[j.id]);await rpc('icash_advance_journey',[j.id]);
 assert.equal((await one("select count(*)::int n from icash_journey_messages where event_key='stalled_help'")).n,1);
 assert.equal((await one("select state from icash_journey_messages where event_key='buyer_reminder_2'")).state,'cancelled');
 await q("update icash_journey_messages set state='needs_review' where event_key='stalled_help'");await rpc('icash_advance_journey',[j.id]);
 assert.equal((await one("select state from icash_journey_messages where event_key='stalled_help'")).state,'needs_review');
 pass('Stalled help replaces a generic reminder and never retries uncertain delivery');

 const sourceDeal=randomUUID();await q('insert into icash_deal_files(id,account_id,screening_id,terms) values($1,$2,$3,$4)',[sourceDeal,account,screen,{address:'200 Earlier Deal'}]);
 const title={company:'Fixture Title',closer:'Casey Closer',email:'closer@example.invalid',phone:'+12145550100'};
 await q('insert into icash_closing_setup(account_id,deal_id,screening_id,title_proposal) values($1,$2,$3,$4),($1,$5,$3,null)',[account,sourceDeal,screen,title,deal]);
 await q('insert into icash_title_contacts(account_id,deal_id,email) values($1,$2,$3)',[account,sourceDeal,title.email]);
 assert.equal((await rpc('icash_saved_closers',[account])).length,1);assert.deepEqual(await rpc('icash_saved_closers',[otherAccount]),[]);
 await assert.rejects(rpc('icash_select_saved_closer',[account,other,deal,sourceDeal]));
 await rpc('icash_select_saved_closer',[account,owner,deal,sourceDeal]);
 assert.equal((await one('select title_proposal from icash_closing_setup where deal_id=$1',[deal])).title_proposal.company,title.company);
 assert.equal((await one('select count(*)::int n from icash_title_contacts where deal_id=$1',[deal])).n,0);
 await q("update icash_title_contacts set verified_until=now()-interval '1 second'");assert.deepEqual(await rpc('icash_saved_closers',[account]),[]);
 pass('Saved closer choices stay account-scoped and never inherit verification for another property');

 const reply=(await one('insert into icash_title_replies(account_id,deal_id) values($1,$2) returning id',[account,deal])).id;
 const payment=(await one("insert into icash_closing_updates(account_id,deal_id,kind,amount_cents,effective_date,reply_id) values($1,$2,'funds_disbursed',1000000,(now() at time zone 'America/Chicago')::date,$3) returning *",[account,deal,reply]));
 await q('update icash_closing_updates set confirmed_by=$1 where id=$2',[owner,payment.id]);
 const today=payment.effective_date;
 await assert.rejects(rpc('icash_confirm_proceeds',[account,owner,deal,payment.id,today]));
 await q("update icash_deal_files set stage='closed' where id=$1",[deal]);
 await q("insert into icash_closing_updates(account_id,deal_id,kind,reply_id) values($1,$2,'closed',$3)",[account,deal,reply]);
 assert.equal((await rpc('icash_closing_operations',[owner,30,true])).receivedCents,0);
 await assert.rejects(rpc('icash_confirm_proceeds',[account,other,deal,payment.id,today]));
 await assert.rejects(rpc('icash_confirm_proceeds',[otherAccount,other,deal,payment.id,today]));
 await assert.rejects(rpc('icash_confirm_proceeds',[account,owner,deal,randomUUID(),today]));
 await assert.rejects(rpc('icash_confirm_proceeds',[account,owner,deal,payment.id,'2099-01-01']));
 const receipt=await rpc('icash_confirm_proceeds',[account,owner,deal,payment.id,today]);assert.equal(await rpc('icash_confirm_proceeds',[account,owner,deal,payment.id,today]),receipt);
 assert.equal((await one('select count(*)::int n from icash_proceeds_receipts')).n,1);
 const ops=await rpc('icash_closing_operations',[owner,30,true]);assert.equal(ops.receivedCents,1000000);assert.equal(ops.closedDeals,1);assert.equal(ops.signedContracts,1);
 assert.equal((await rpc('icash_closing_operations',[owner,30,false])).receivedCents,0);await assert.rejects(rpc('icash_closing_operations',[other,30,true]));
 assert.equal(ops.issues.length,0,'Closed and paid deals must not retain stale buyer follow-up issues');
 await q("update icash_deal_files set stage='canceled' where id=$1",[deal]);
 assert.equal((await rpc('icash_closing_operations',[owner,30,true])).issues.length,0);
 await q("update icash_deal_files set stage='closed' where id=$1",[deal]);
 pass('Title disbursement is separate from actual receipt; duplicate, foreign and stale confirmations are rejected');

 await assert.rejects(rpc('icash_network_demand',[otherAccount]));
 for(let n=0;n<4;n++){const u=randomUUID(),mail=`buyer${n}@example.invalid`;await q('insert into auth.users(id,email) values($1,$2)',[u,mail]);await q('insert into icash_network_buyers(user_id,email,name,zips,property_types) values($1,$2,$3,$4,$5)',[u,mail,'Private Buyer', ['75201'],['house']]);}
 let demand=await rpc('icash_network_demand',[account]);assert.equal(demand.markets[0].buyers,4);assert(!JSON.stringify(demand).includes('@'));assert(!JSON.stringify(demand).includes('Private Buyer'));
 await q("insert into icash_email_suppressions values('buyer0@example.invalid')");demand=await rpc('icash_network_demand',[account]);assert.equal(demand.markets[0].buyers,3);
 await q("update icash_network_buyers set paused=true where email='buyer1@example.invalid'");assert.deepEqual((await rpc('icash_network_demand',[account])).markets,[]);
 await q("update icash_network_buyers set paused=false,expires_at=now()-interval '1 second' where email='buyer1@example.invalid'");assert.deepEqual((await rpc('icash_network_demand',[account])).markets,[]);
 pass('VIP demand uses fresh opted-in buyers and suppresses small groups, private identities, paused and expired profiles');

 for(const role of ['anon','authenticated']){
  for(const table of ['icash_journey_blockers','icash_proceeds_receipts']){assert.equal((await one("select has_table_privilege($1,$2,'SELECT') ok",[role,table])).ok,false);assert((await one('select relrowsecurity r from pg_class where relname=$1',[table])).r);}
  for(const signature of ['icash_confirm_proceeds(uuid,uuid,uuid,uuid,date)','icash_network_demand(uuid)','icash_closing_operations(uuid,integer,boolean)','icash_resolve_journey_blocker(uuid,uuid,uuid,integer,text)'])assert.equal((await one("select has_function_privilege($1,$2,'EXECUTE') ok",[role,signature])).ok,false);
 }
 pass('New tables enforce deny-by-default RLS and browser roles cannot call privileged functions');
 console.log(`${passed} closing completion scenarios passed; zero provider calls.`);
}catch(e){console.error(e.message,e.where??'',e.stack);process.exitCode=1;}finally{await pg.close();}
