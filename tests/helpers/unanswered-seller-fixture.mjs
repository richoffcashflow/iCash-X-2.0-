import {readFileSync} from 'node:fs';
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export function unansweredFixtureSql(){
 const tables=new Map();
 for(const name of ['seller-phone-spacing-schema','seller-text-health-schema'])for(const t of JSON.parse(read('tests/fixtures/'+name+'.json'))){
  if(!tables.has(t.name))tables.set(t.name,new Map());
  for(const c of t.columns)tables.get(t.name).set(c.name,c.type);
 }
 let sql=`create role anon;create role authenticated;create role service_role bypassrls;
 create schema icash_recording_private;create schema icash_seller_recovery_private;create schema icash_seller_agreement_private;
 grant usage on schema icash_seller_recovery_private to service_role;`;
 for(const [name,cols] of tables)sql+=`create table public.${name} (${[...cols].map(([n,t])=>`"${n}" ${t}`).join(',')});\n`;
 sql+=`
 alter table icash_voice_jobs add primary key(id),alter column id set default gen_random_uuid(),alter column created_at set default now(),alter column state set default 'ready';
 alter table icash_call_recordings add column if not exists last_action text;
 create unique index icash_voice_operational_first_once on public.icash_voice_jobs(operational_contact_id) where callback_id is null and cancellation_notice_id is null;
 create table icash_recording_private.terminal_cost_receipts(recording_id uuid,receipt jsonb);
 create table icash_seller_agreement_private.call_history(contact_key text,transcript jsonb);
 create table icash_cancellation_notices(account_id uuid,sms_id uuid);
 create table icash_seller_recovery_attempts(account_id uuid,thread_id uuid,reason text,assigned_at timestamptz);
 create table icash_text_suppressions(phone text);
 create table icash_property_controls(account_id uuid,screening_id uuid,manual boolean);
 create table icash_outreach_campaigns(account_id uuid,mode text);
 create table icash_dnc_verification_receipts(id uuid,evidence_kind text);
 create table fixture_eligibility(account_id uuid,contact_id uuid,allowed boolean);
 create view public.icash_voice_contact_targets as select id,account_id,screening_id,phone,contact_key,party,permission_until,revoked_at,'operator_record'::text eligibility_source from icash_contact_permissions
 union all select id,account_id,screening_id,phone,contact_key,'seller',eligibility_until,revoked_at,'operational_checks_only' from icash_operational_contacts;
 create function icash_outreach_voice_current(uuid) returns boolean language sql as $$select not exists(select 1 from public.icash_outreach_campaigns where account_id=$1 and mode='sms_inbound')$$;
 -- Boundary substitute only. Actual contact/financial/hour admission remains
 -- covered by the existing operational and final dial suites.
 create function icash_operational_contact_current(uuid,uuid,text,boolean) returns boolean language sql as $$select coalesce((select allowed from public.fixture_eligibility where account_id=$1 and contact_id=$2),false)$$;
 create function icash_seller_response_operation_allowed(uuid,text) returns boolean language sql as $$select not exists(select 1 from public.icash_voice_jobs j join public.icash_operational_contacts c on c.id=j.operational_contact_id and c.account_id=j.account_id where j.account_id=$1 and 'voice:'||j.id=$2 and (exists(select 1 from public.icash_text_suppressions s where s.phone=c.phone) or exists(select 1 from public.icash_property_controls p where p.account_id=c.account_id and p.screening_id=c.screening_id and p.manual)))$$;
 create function icash_voice_outreach_context(uuid,uuid) returns jsonb language sql as $$select '{"activeConversation":false}'::jsonb$$;
 create function icash_requested_seller_call_current(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_meta_followup_call_current(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_owner_demo_call_current(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_prepare_operational_contacts() returns void language sql as $$select$$;
 create function icash_queue_voice_jobs_before_operational() returns void language sql as $$select$$;
 insert into icash_operating_budget(id,enabled) values(1,true);
 set check_function_bodies=off;`;
 const source=read('config/seller-response-policy.sql');
 sql+=source.slice(source.indexOf('create function public.icash_seller_direct_response_match'),source.indexOf('create function public.icash_seller_response_disposition'));
 for(const row of JSON.parse(read('tests/fixtures/unanswered-seller-predecessors.json')))sql+=row.definition+';\n';
 const terminal=read('config/seller-call-terminal-progress.sql');
 sql+=terminal.slice(terminal.indexOf('create function public.icash_seller_recorded_call_finished'),terminal.indexOf('do $patch$'));
 sql+='set check_function_bodies=on;';
 return sql;
}

export const unansweredNativeSeedSql=`
update icash_seller_recovery_private.unanswered_policy set enabled=true,activated_at=now()-interval '12 hours';
insert into icash_accounts(id,bot_paused) values('00000000-0000-4000-8000-000000000001',false);
insert into icash_wallets(account_id,balance_cents,reserved_cents) values('00000000-0000-4000-8000-000000000001',1000,0);
insert into icash_operational_contacts(id,account_id,screening_id,phone,contact_key,channel,eligibility_until)
 values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','+12145550123','fixture-contact','voice',now()+interval '10 hours');
insert into fixture_eligibility values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',true);
insert into icash_voice_jobs(id,account_id,operational_contact_id,state,created_at)
 values('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','dispatched',now()-interval '4 hours');
insert into icash_call_recordings(id,account_id,voice_job_id,screening_id,party,operation_key,to_phone,from_phone,contact_key,dial_claimed_at,call_ended_at,call_sid,conversation_id)
 values('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003','seller','voice:00000000-0000-4000-8000-000000000004','+12145550123','+17205550100','fixture-contact',now()-interval '3 hours',now()-interval '175 minutes','CAfixture','conv-fixture');
insert into icash_operation_spend(operation_key,account_id,state) values('voice:00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','settled');
insert into icash_live_conversations(id,account_id,screening_id,party,operation_key,contact_key,conversation_id,state,completed_at,result)
 values('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','seller','voice:00000000-0000-4000-8000-000000000004','fixture-contact','conv-fixture','complete',now()-interval '175 minutes','{"contactEvidence":"no_response","transcript":[{"role":"user","message":"..."}]}');
grant usage on schema public to service_role;
grant select on all tables in schema public to service_role;
grant insert on icash_voice_jobs to service_role;
grant update on icash_operating_budget to service_role;
`;
export function unansweredNativeFixtureSql(){return unansweredFixtureSql()+"begin;"+read('config/seller-call-answer-context.sql')+read('config/unanswered-seller-followups.sql')+read('config/seller-call-automated-greetings.sql')+read('config/seller-specific-price-answers.sql')+read('config/seller-unmarked-price-answers.sql')+"commit;"+unansweredNativeSeedSql;}
