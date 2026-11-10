// Shared isolated PostgreSQL fixture. All services remain offline.
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export async function setupOwnerDemoRunFixture({pg,account,owner,other,phone,sender,distinct=true}){
 const q=(s,a=[])=>pg.query(s,a);
 await pg.exec('create role anon;create role authenticated;create role service_role;create schema icash_recording_private;create schema icash_recorded_reception_private;');
 for(const t of JSON.parse(read('tests/fixtures/seller-phone-spacing-schema.json')))await pg.exec(`create table ${t.name} (${t.columns.map(c=>`"${c.name}" ${c.type}`).join(',')});`);
 await pg.exec(`
 alter table icash_seller_intakes add primary key(id);alter table icash_seller_intakes alter id set default gen_random_uuid();alter table icash_seller_intakes alter created_at set default now();
 alter table icash_seller_intakes add unique(request_id);
 alter table icash_text_messages alter id set default gen_random_uuid();alter table icash_text_messages alter created_at set default now();alter table icash_text_messages add unique(event_id);alter table icash_text_messages add unique(provider_id);alter table icash_text_messages add unique(request_key);
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid,operation_key text);
 create table icash_deal_files(id uuid,account_id uuid,screening_id uuid,stage text,terms jsonb);
 create table icash_text_ai_jobs(id uuid,account_id uuid,thread_id uuid,state text,updated_at timestamptz);
 create table icash_seller_responses(lead_id uuid,account_id uuid,screening_id uuid,state text,detail text,updated_at timestamptz);
 create table icash_signing_envelopes(id uuid,account_id uuid,deal_id uuid,state text,terms jsonb,provider_evidence jsonb);
 create table icash_seller_gaps(account_id uuid,screening_id uuid,state text,updated_at timestamptz);
 create table icash_optin_call_requests(lead_id uuid,request_id uuid,phone text,account_id uuid,requested_by uuid,source text,request_version text,request_reference text,requested_at timestamptz,expires_at timestamptz);
 create table icash_text_suppressions(phone text primary key,reason text);create table icash_webinar_phone_suppressions(phone text);create table icash_contact_suppressions(contact_key text);
 create table icash_recording_private.terminal_cost_receipts(recording_id uuid,created_at timestamptz,receipt jsonb);
 create table icash_recorded_reception_private.sessions(from_phone text,call_ended_at timestamptz,settled_at timestamptz);
 create table icash_timezone_names(name text);insert into icash_timezone_names values('America/Chicago');
 create table icash_sms_routes(sender text,recipient text,account_id uuid,needs_review boolean default false,revision bigint default 1,primary key(sender,recipient));
 create table icash_text_events(id text primary key,type text,payload jsonb,received_at timestamptz default now());
 create table icash_text_senders(phone text primary key,enabled boolean);
 create function icash_seller_voice_permission_current(p_account uuid,p_permission uuid) returns boolean language sql as $$select exists(select 1 from public.icash_contact_permissions where id=p_permission and account_id=p_account and revoked_at is null)$$;
 create function icash_prepare_seller_contacts(p_account uuid,p_lead uuid,p_screening uuid,p_deal uuid) returns void language plpgsql as $$declare e jsonb:='{}';begin
 if e is null then return;end if;
 end$$;
 `);
 const submitSource=read('config/bot-demo-intake.sql');
 let submitDefinition=submitSource.slice(submitSource.indexOf('create function public.icash_submit_bot_demo_intake'),submitSource.indexOf('-- Preserve the current assignment'));
 // Reviewed identity patch's distinct-request predicate; production integration
 // applies config/distinct-demo-submissions.sql in the same atomic bundle.
 if(distinct)submitDefinition=submitDefinition.replace(/ select id into canonical[\s\S]*?order by created_at limit 1;/,' canonical:=null;');
 await pg.exec(submitDefinition);
 const ownerSource=read('config/owner-demo-call-spacing.sql');await pg.exec(ownerSource.slice(ownerSource.indexOf('create or replace function'),ownerSource.indexOf('do $patch$')));
 const routeSource=read('config/sms-property-routing.sql');
 for(const [start,end] of [['create function public.icash_sms_normalize_address','-- Replace only inbound'],['create function public.icash_sms_message_route()','create function public.icash_sms_save_route_review()'],['create function public.icash_sms_route_changed()','drop index public.icash_text_threads_active_number']])await pg.exec(routeSource.slice(routeSource.indexOf(start),routeSource.indexOf(end)));
 let ingest=read('config/text-messaging.sql');ingest=ingest.slice(ingest.indexOf('create function public.icash_ingest_text_event('),ingest.indexOf('create function public.icash_accept_text('));
 ingest=ingest.replace('icash_ingest_text_event(', 'icash_ingest_text_event_before_operational(').replace("where sender=v->>'to' and recipient=v->>'from';", "where id=public.icash_sms_resolve_property(v->>'to',v->>'from',v->>'body');");await pg.exec(ingest);
 await q('insert into icash_accounts(id,owner_user_id,bot_paused) values($1,$2,false),($3,$4,false)',[account,owner,other,randomUUID()]);
 await pg.exec('insert into icash_operating_budget(id) values(1)');await q('insert into icash_text_senders values($1,true)',[sender]);
 await q('insert into icash_sms_routes(sender,recipient,account_id) values($1,$2,$3)',[sender,phone,account]);

 await pg.exec(`
 create table icash_owner_buyer_tests(id uuid,account_id uuid,thread_id uuid,sender text,phone text,created_at timestamptz,active boolean default false);
 create view icash_non_test_text_threads as select * from icash_text_threads where owner_buyer_test_id is null;
 create table icash_sms_conversation_focus(sender text,recipient text,account_id uuid,thread_id uuid,expires_at timestamptz,route_revision bigint);
 create table icash_sms_route_reviews(message_id uuid primary key,account_id uuid,sender text,recipient text,candidate_threads uuid[],reason text,created_at timestamptz,resolved_at timestamptz,resolution_revision bigint);
 create table icash_seller_text_replies(id uuid,source_id uuid,account_id uuid,thread_id uuid,kind text,action text,body text,route_revision bigint,message_id uuid,created_at timestamptz);
 create table icash_sms_owner_reply_resolutions(source_id uuid primary key,question_id uuid,account_id uuid,thread_id uuid,route_revision bigint);
 create table icash_property_controls(account_id uuid,property_id text,manual boolean);
 create table icash_handoffs(account_id uuid,screening_id uuid,state text);
 create table icash_communication_prices(operation text,customer_micros bigint);
 create table icash_customer_identities(account_id uuid,principal text);
 create function icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql as $$select exists(select 1 from public.icash_owner_buyer_tests where account_id=$1 and thread_id=$2 and active)$$;
 create function icash_sms_recent_owner_question(text,text,timestamptz default now()) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_seller_sms_call_current(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_seller_clarification_current(uuid,uuid,uuid,text,bigint) returns boolean language sql as $$select false$$;
 create function icash_fresh_intake_opener_current(uuid,uuid,uuid,text,bigint) returns boolean language sql as $$select false$$;
 create function icash_outreach_voice_current(uuid) returns boolean language sql as $$select true$$;
 create function icash_outreach_sms_current(uuid) returns boolean language sql as $$select true$$;
 create function icash_property_text_sender(uuid,uuid,text) returns text language sql as $$select '${sender}'::text$$;
 create function icash_sms_intake_rate_current(uuid) returns boolean language sql as $$select true$$;
 create function icash_retire_expired_practice_threads(uuid,text,text) returns void language plpgsql as $$begin return;end$$;
 alter table icash_contact_permissions alter id set default gen_random_uuid();
 alter table icash_contact_permissions add unique(account_id,screening_id,party,contact_key);
 alter table icash_text_threads alter id set default gen_random_uuid();
 create unique index fixture_active_thread on icash_text_threads(account_id,deal_id,sender,recipient) where retired_at is null and owner_buyer_test_id is null;
 alter table icash_signing_envelopes add column provider_id uuid;
 `);
 await q("insert into icash_customer_identities values($1,'Fixture principal')",[account]);
 await q("insert into icash_operation_rates(id,operation,verified_at) values(gen_random_uuid(),'sms_send',now())");
 await q("insert into icash_communication_prices values('sms_segment',1000)");
 const continuation=read('config/seller-text-continuation.sql');
 await pg.exec(continuation.slice(continuation.indexOf('alter function public.icash_sms_resolve_property'),continuation.indexOf('create function public.icash_remember_sms_property')));
 await pg.exec('alter function public.icash_sms_resolve_property(text,text,text) rename to icash_sms_resolve_before_owner_buyer_test;set check_function_bodies=off;');
 for(const row of JSON.parse(read('tests/fixtures/owner-demo-run-predecessors.json'))){
  let definition=row.definition;
  if(row.signature.startsWith('icash_submit_bot_demo_intake')&&distinct)definition=definition.replace(/ select id into canonical[\s\S]*?order by created_at limit 1;/,' canonical:=null;');
  await pg.exec(definition);
 }
 const source=read('config/sms-property-routing.sql');await pg.exec(source.slice(source.indexOf('create function public.icash_sms_save_route_review()'),source.indexOf('-- Keep legacy permissions')));
 const textEvent=continuation.slice(continuation.indexOf('create function public.icash_prepare_seller_text_event'),continuation.indexOf('-- Revalidate exact source')).replace('icash_prepare_seller_text_event(', 'icash_prepare_seller_text_event_before_call_now(');await pg.exec(textEvent);
 await pg.exec('set check_function_bodies=on;');
 const contact=read('config/seller-intake-contacts.sql');
 await pg.exec(contact.slice(contact.indexOf('create function public.icash_seller_contact_evidence'),contact.indexOf('create function public.icash_seller_voice_permission_current')));
 const consent=read('config/bot-demo-intake.sql');await pg.exec(consent.slice(consent.indexOf('do $patch$'),consent.indexOf('end $patch$;')+'end $patch$;'.length));

}
