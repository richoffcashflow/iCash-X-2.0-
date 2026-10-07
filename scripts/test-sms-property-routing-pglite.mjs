// SIMULATION ONLY: isolated in-memory SQL. No provider, network, billing, or protected-function definitions.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const pg=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const q=(s,p=[])=>pg.query(s,p);const one=async(s,p=[])=>(await q(s,p)).rows[0];
const rpc=async(n,args)=>Object.values(await one(`select ${n}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args))[0];
const a=randomUUID(),b=randomUUID(),s1=randomUUID(),s2=randomUUID(),d1=randomUUID(),d2=randomUUID(),l1=randomUUID(),l2=randomUUID(),rate=randomUUID();
const phone='+12145550123',sender='+14243948384';
try {
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean default false);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,snapshot jsonb,state text,result jsonb);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text default 'draft',terms jsonb);
 create table icash_operation_rates(id uuid primary key,operation text,enabled boolean,expires_at timestamptz,verified_at timestamptz default now(),charge_cents bigint default 1);
 create table icash_operating_budget(id integer primary key);insert into icash_operating_budget values(1);
 create table icash_seller_intakes(id uuid primary key,phone text,ai_consented boolean,state text,consent_version text,contact_consent_scope text,consent_text text,created_at timestamptz default now(),data_rights_until timestamptz,attribution jsonb);
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
 create table icash_customer_identities(account_id uuid,principal text);
 create table icash_timezone_names(name text);insert into icash_timezone_names values('America/Chicago');
 create table icash_contact_suppressions(contact_key text);
 create table icash_property_controls(account_id uuid,property_id text,manual boolean,updated_at timestamptz,unique(account_id,property_id));
 create table icash_handoffs(account_id uuid,screening_id uuid,state text);
 create table icash_communication_prices(operation text,customer_micros bigint);insert into icash_communication_prices values('sms_segment',10000);
 create table icash_contact_permissions(id uuid primary key default gen_random_uuid(),account_id uuid,screening_id uuid,party text,phone text,contact_key text,timezone text,local_start_hour integer,local_end_hour integer,permission_evidence text,permission_until timestamptz,dnc_checked_at timestamptz not null,dnc_clear boolean,review_request_id uuid,buyer_id uuid,revoked_at timestamptz,unique(account_id,screening_id,party,contact_key));
 create function icash_outreach_voice_current(uuid) returns boolean language sql as $$select true$$;
 create function icash_outreach_sms_current(uuid) returns boolean language sql as $$select true$$;
 create function icash_sms_intake_rate_current(uuid) returns boolean language sql as $$select true$$;`);
 await pg.exec(read('config/text-messaging.sql'));
 await pg.exec(read('config/text-ai.sql').split('create function public.icash_claim_text_ai')[0]);
 await pg.exec(read('config/reply-signals.sql').split('-- Preserve deployed functions')[0]);
 await pg.exec(`alter table icash_text_threads add column party text default 'seller',add column manual_only boolean default false,add column sms_review_request_id uuid,add column operational_contact_id uuid;`);
 await pg.exec(read('config/seller-intake-contacts.sql'));
 // Apply exact retired-thread schema and exact relevant prepare/ingest patches, not unrelated protected definitions.
 const retired=read('supabase/migrations/20261006235709_seller_snapshot_and_retired_practice_threads.sql');
 await pg.exec(retired.slice(0,retired.indexOf('do $patch$'))+'commit;');
 await pg.exec(`alter function icash_ingest_text_event(jsonb,boolean) rename to icash_ingest_text_event_before_operational;
 create function icash_ingest_text_event(p_event jsonb,p_optout boolean) returns void language plpgsql as $$begin perform 1 from icash_operating_budget where id=1 for update;perform icash_ingest_text_event_before_operational(p_event,p_optout);end$$;`);
 for(const block of retired.match(/do \$patch\$[\s\S]*?end \$patch\$;/g)) if(/icash_prepare_seller_contacts|icash_ingest_text_event_before_operational/.test(block))await pg.exec(block);
 // Production inbound duplicate-provider-ID patch.
 await pg.exec(`do $$declare d text;begin d:=pg_get_functiondef('icash_ingest_text_event_before_operational(jsonb,boolean)'::regprocedure);execute replace(d,'state,event_id) values(t.id,t.account_id,''incoming'',coalesce(v->>''body'',''''),coalesce(v->''attachments'',''[]''),''received'',p_event->>''id'') on conflict(event_id) do nothing','state,event_id,provider_id) values(t.id,t.account_id,''incoming'',coalesce(v->>''body'',''''),coalesce(v->''attachments'',''[]''),''received'',p_event->>''id'',nullif(v->>''message_id'','''')) on conflict do nothing');end$$;
 create function icash_claim_customer_text(p_account uuid,p_message uuid,p_sender text) returns jsonb language plpgsql as $$begin
 return jsonb_build_object('testOnly',true);end$$;
 create function icash_decide_authority_review(uuid,uuid,text,text,jsonb) returns void language plpgsql as $$begin
 -- on conflict(sender,recipient) where retired_at is null
 end$$;
 create function icash_project_operational_sms_contacts(uuid) returns void language plpgsql as $$begin
 -- on conflict(sender,recipient) where retired_at is null
 end$$;`);
 for(const [name,args] of [['icash_queue_ai_reply','uuid,uuid,text'],['icash_queue_ai_reply_before_campaign','uuid,uuid,text'],['icash_queue_buyer_package_text','uuid,uuid,text'],['icash_queue_seller_opener','uuid,uuid'],['icash_queue_seller_opener_before_campaign','uuid,uuid'],['icash_prepare_manual_text','uuid,uuid,uuid,text,jsonb']])await pg.exec(`create function ${name}(${args}) returns void language plpgsql as $$begin null;end$$;`);
 await pg.exec(read('config/owner-practice-replies.sql'));
 await q('insert into icash_accounts(id,owner_user_id) values($1,$1),($2,$2)',[a,b]);
 await q("insert into icash_operation_rates(id,operation,enabled,expires_at) values($1,'sms_send',true,now()+interval '1 day')",[rate]);
 await q("insert into icash_customer_identities values($1,'SIMULATION business')",[a]);
 for(const [s,d,l,address] of [[s1,d1,l1,'604 Crozier Street, Dallas TX'],[s2,d2,l2,'2149 Arden Rd, Dallas TX']]){
 await q("insert into icash_screening_jobs values($1,$2,jsonb_build_object('propertyId',$3::text),'complete','{}')",[s,a,d]);
 await q("insert into icash_deal_files(id,account_id,screening_id,terms) values($1,$2,$3,jsonb_build_object('address',$4::text))",[d,a,s,address]);
 await q("insert into icash_seller_intakes values($1,$2,true,'assigned','homeoffer-seller-contact-2026-10-05.4','homeoffer_network_and_matched_buyers','I agree to marketing calls, texts and emails about my property from HomeOffer Network and its matched buyers, including automated texts and AI-generated voice calls. Consent is not a condition of buying or selling. Message/data rates may apply. Reply STOP to texts or unsubscribe from emails.',now(),now()+interval '2 days','{\"contactTimezone\":\"America/Chicago\",\"contactTimezoneSource\":\"seller_browser\"}')",[l,phone]);
 await q('insert into icash_seller_matches values($1,$2,$3)',[l,a,s]);
 }
 const prepare=(l,s,d)=>rpc('icash_prepare_seller_contacts',[a,l,s,d]);
 await prepare(l1,s1,d1);const t1=(await one('select id from icash_text_threads where deal_id=$1',[d1])).id;
 await q("update icash_text_threads set paused=true,manual_only=true,ai_mode='off' where id=$1",[t1]);
 const legacyOut=await rpc('icash_queue_text',[a,t1,randomUUID(),'Existing unambiguous queue',[]]);
 const retiredThread=(await one("insert into icash_text_threads(account_id,deal_id,sender,recipient,paused,retired_at) values($1,$2,$3,$4,true,now()) returning id",[a,d1,sender,phone])).id;
 const retiredMessage=(await one("insert into icash_text_messages(thread_id,account_id,direction,body,state) values($1,$2,'outgoing','Retired queue','ready') returning id",[retiredThread,a])).id;
 await pg.exec(read('config/sms-property-routing.sql'));
 assert.equal(await rpc('icash_sms_message_route_current',[a,legacyOut]),true,'migration preserves existing sole-property queue');
 assert.equal((await one('select route_revision from icash_text_messages where id=$1',[retiredMessage])).route_revision,null,'retired queue never grandfathered');
 await assert.rejects(q('update icash_text_threads set retired_at=null where id=$1',[retiredThread]),/cannot be reopened/);
 await Promise.all(Array.from({length:12},()=>prepare(l2,s2,d2)));
 assert.equal(await rpc('icash_sms_message_route_current',[a,legacyOut]),false,'second property invalidates pre-migration queued route');
 const t2=(await one('select id from icash_text_threads where deal_id=$1',[d2])).id;
 assert.equal((await one('select count(*)::int n from icash_text_threads where retired_at is null')).n,2,'separate property plus repeated prepare');
 assert.equal((await one('select paused and manual_only and ai_mode=\'off\' intact from icash_text_threads where id=$1',[t1])).intact,true);
 const event=(body,id=randomUUID(),provider=randomUUID(),type='text.incoming.sms')=>({id,type,timestamp:Date.now()/1000,data:{from:phone,to:sender,body,message_id:provider}});
 const ingest=(e,stop=false)=>rpc('icash_ingest_text_event',[e,stop]);
 const route=body=>rpc('icash_sms_resolve_property',[sender,phone,body]);
 assert.equal(await route('2149 Arden Rd yes'),t2);assert.equal(await route('604 Crozier Street $150000'),t1);
 for(const body of ['yes','$150000','send contract','2149 Arden Rd and 604 Crozier Street'])assert.equal(await route(body),null);
 let e=event('yes');await ingest(e);let m=await one('select * from icash_text_messages where event_id=$1',[e.id]);
 assert.equal(m.thread_id,null);assert.equal(m.state,'needs_review');assert.equal((await one('select count(*)::int n from icash_text_ai_jobs')).n,0,'actual AI trigger ignores unrouted text');assert.equal((await one('select count(*)::int n from icash_text_attention')).n,0,'actual property-signal trigger ignores unrouted text');assert.equal((await one('select count(*)::int n from icash_sms_route_reviews')).n,1);
 const rev=(await one('select revision from icash_sms_routes')).revision;await ingest(e);await ingest({...e,id:randomUUID()});assert.equal((await one('select revision from icash_sms_routes')).revision,rev,'duplicate events and provider retries are no-ops');
 await assert.rejects(rpc('icash_queue_text',[a,t2,randomUUID(),'Hello',[]]),/routing requires review/);
 e=event('2149 Arden Rd yes');await ingest(e);m=await one('select * from icash_text_messages where event_id=$1',[e.id]);assert.equal(m.thread_id,t2);
 const key=randomUUID();const out=await rpc('icash_queue_text',[a,t2,key,'Hello',[]]);assert.equal(await rpc('icash_queue_text',[a,t2,key,'Hello',[]]),out);
 assert.equal(await rpc('icash_sms_message_route_current',[a,out]),true);assert.deepEqual(await rpc('icash_claim_customer_text',[a,out,sender]),{testOnly:true});
 await ingest(event('604 Crozier Street yes'));assert.equal(await rpc('icash_sms_message_route_current',[a,out]),false,'route CAS blocks stale queued reply');assert.equal(await rpc('icash_claim_customer_text',[a,out,sender]),null);assert.equal((await one('select state from icash_text_messages where id=$1',[out])).state,'needs_review');
 // Even a stale AI result queued after context changes cannot pass dispatch.
 const staleOut=await rpc('icash_queue_text',[a,t2,randomUUID(),'Stale reply',[]]);
 await q('update icash_text_ai_jobs set outgoing_id=$1 where message_id=$2',[staleOut,m.id]);assert.equal(await rpc('icash_sms_message_route_current',[a,staleOut]),false);
 await assert.rejects(q('update icash_text_threads set deal_id=$1 where id=$2',[d2,t1]),/immutable/);
 await assert.rejects(q('update icash_text_messages set thread_id=$1 where id=$2',[t1,m.id]),/immutable/);
 const d3=randomUUID();await q("insert into icash_deal_files(id,account_id,terms) values($1,$2,'{}')",[d3,b]);
 await assert.rejects(q('insert into icash_text_threads(account_id,deal_id,sender,recipient) values($1,$2,$3,$4)',[b,d3,sender,phone]),/another account/);
 const d4=randomUUID();await q("insert into icash_deal_files(id,account_id,terms) values($1,$2,'{}')",[d4,a]);
 await assert.rejects(q("insert into icash_text_threads(account_id,deal_id,sender,recipient,party) values($1,$2,$3,$4,'buyer')",[a,d4,sender,phone]),/Mixed-role/);
 await assert.rejects(q("insert into icash_text_threads(account_id,deal_id,sender,recipient) values($1,$2,$3,$4)",[a,d4,sender,phone]),/Separate assigned/);
 await ingest(event('STOP'),true);assert.equal((await one('select count(*)::int n from icash_text_suppressions')).n,1);
 assert.equal((await one("select count(*)::int n from icash_text_messages where direction='outgoing' and state='ready'")).n,0,'STOP cancels every property queue');
 // Delivery receipt still updates the exact provider-bound outgoing message despite other property activity.
 await q("update icash_text_messages set state='dispatching' where id=$1",[out]);
 const receipt='simulation-receipt';await ingest({id:randomUUID(),type:'text.delivery.confirmed',timestamp:Date.now()/1000,data:{from:sender,to:phone,message_id:receipt}});
 await rpc('icash_accept_text',[a,out,receipt]);assert.equal((await one('select state from icash_text_messages where id=$1',[out])).state,'delivered');
 // Owner review is account-scoped and revision-checked, and never rebinds the raw quote.
 const reviews=(await q('select * from icash_sms_route_review_items($1,0,7)',[a])).rows;
 assert.ok(reviews.length);assert.equal((await q('select * from icash_sms_route_review_items($1,0,7)',[b])).rows.length,0);
 for(const review of reviews){
 assert.equal(await rpc('icash_review_sms_route',[a,b,review.message_id,review.revision]),false);
 assert.equal(await rpc('icash_review_sms_route',[a,a,review.message_id,review.revision-1]),false);
 assert.equal(await rpc('icash_review_sms_route',[a,a,review.message_id,review.revision]),true);
 assert.equal(await rpc('icash_review_sms_route',[a,a,review.message_id,review.revision]),true,'same review is idempotent');
 assert.equal((await one('select thread_id from icash_text_messages where id=$1',[review.message_id])).thread_id,null);
 }
 assert.equal((await one('select needs_review from icash_sms_routes where recipient=$1',[phone])).needs_review,false);
 assert.equal((await one('select count(*)::int n from icash_text_suppressions')).n,1,'review never removes STOP');
 // Single-property number remains unambiguous for ordinary short responses.
 const singlePhone='+12145550999';await q('insert into icash_text_threads(account_id,deal_id,sender,recipient) values($1,$2,$3,$4)',[a,d1,sender,singlePhone]);
 assert.ok(await rpc('icash_sms_resolve_property',[sender,singlePhone,'yes']));
 assert.equal((await one("select count(*)::int n from information_schema.routine_privileges where routine_name in ('icash_sms_thread_binding','icash_sms_route_changed','icash_sms_normalize_address','icash_sms_resolve_property','icash_sms_message_route','icash_sms_save_route_review','icash_sms_message_route_current') and grantee in ('PUBLIC','anon','authenticated')")).n,0);
 console.log('PASS isolated SQL: distinct-property consent, idempotent prepare/queue/provider retries, manual preservation, explicit/ambiguous routes, CAS/stale AI, immutable history, cross-account/mixed-role/consent rejection, phone-global STOP, late receipt, single-property regression, service-only access. No provider sends.');
} catch(error) {console.error(error.message);console.error(error.where??'');process.exitCode=1;} finally {await pg.close();}
