import {readFileSync, readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const migrations=readdirSync(new URL('../../supabase/migrations/',import.meta.url));
const migrationFor=suffix=>{const names=migrations.filter(n=>n.endsWith(suffix));if(names.length!==1)throw Error(suffix);return read('supabase/migrations/'+names[0]);};
export const migration=migrationFor('_deferred_sender_fairness.sql');
export const predecessors=JSON.parse(read('tests/fixtures/sender-fairness-before.json'));
export const dependencies=JSON.parse(read('tests/fixtures/sender-fairness-dependencies.json'));
// Actual queue, retry, delay, transactional classification and sender admission.
// Local copy/financial adapters below are explicit boundaries, never providers.
export const setup=read('tests/fixtures/contiguity-volume-predecessors.sql')+
 read('tests/fixtures/contiguity-volume-admission.sql')+migrationFor('_contiguity_sender_volume.sql')+
 read('config/november-sender-pacing.sql')+read('config/november-sender-200.sql')+`
 create table public.icash_seller_limited_text_replies(message_id uuid,account_id uuid,thread_id uuid,source_id uuid,body text);
 create table public.icash_seller_text_replies(id uuid,message_id uuid,account_id uuid,thread_id uuid,source_id uuid,body text);
 create table public.icash_sms_seller_openings(thread_id uuid,account_id uuid,owner_question_id uuid,owner_reply_id uuid,interest_message_id uuid);
 create table public.icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
 create table public.fixture_admission(id integer primary key,allowed boolean);
 insert into public.fixture_admission values(1,true);
 insert into public.icash_operating_budget(id,enabled) values(1,true);
 update public.icash_deal_files set stage='draft',terms='{"address":"123 Fixture Street"}';
 insert into public.icash_customer_identities(account_id,principal) values(md5('owner')::uuid,'Fixture Buyer');
 create function public.icash_outreach_sms_current(uuid) returns boolean language sql stable as $$select allowed from public.fixture_admission where id=1$$;
 create function public.icash_seller_text_cadence_current(uuid,uuid) returns boolean language sql stable as $$select true$$;
 create function public.icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql stable as $$select allowed from public.fixture_admission where id=1$$;
 create function public.icash_conversation_street(text) returns text language sql immutable as $$select $1$$;
 create function public.icash_seller_contact_evidence(uuid,uuid,uuid,text) returns jsonb language sql stable as $$select '{}'::jsonb$$;
 create function public.icash_seller_recipient_opener(uuid,uuid,text,text,text) returns text language sql stable as $$select 'Hello, this is Fixture Buyer about 123 Fixture Street.'::text$$;
 create function public.icash_seller_sms_learning_active(uuid,uuid) returns boolean language sql stable as $$select false$$;
 create function public.icash_seller_identity_opener(text,text) returns text language sql stable as $$select 'Hello, this is Fixture Buyer about 123 Fixture Street.'::text$$;
 create function public.icash_seller_cash_questions_enabled() returns boolean language sql stable as $$select false$$;
 create function public.icash_assign_seller_opener_v6(p_account uuid,p_thread uuid) returns jsonb language plpgsql as $$begin
  insert into public.icash_seller_opener_assignments(thread_id,account_id,created_at) values(p_thread,p_account,clock_timestamp());
  return '{"context":"fixture"}'::jsonb;
 end$$;
 create function public.icash_queue_text(p_account uuid,p_thread uuid,p_key uuid,p_body text,p_assets jsonb) returns uuid language plpgsql as $$
 declare result uuid:=gen_random_uuid();begin
  insert into public.icash_text_messages(id,account_id,thread_id,request_key,direction,state,body,created_at)
   values(result,p_account,p_thread,p_key,'outgoing','ready',p_body,clock_timestamp());
  update public.icash_seller_opener_assignments set message_id=result where account_id=p_account and thread_id=p_thread;
  return result;
 end$$;
 `+Object.values(dependencies).map(d=>d+';').join('\n')+Object.values(predecessors).map(d=>d+';').join('\n')+`
 grant usage on schema public to service_role;
 grant select,insert,update,delete on all tables in schema public to service_role;
 revoke all on all functions in schema public from public,anon,authenticated;
 grant execute on all functions in schema public to service_role;
 revoke all on all functions in schema icash_sender_private from public,anon,authenticated;
 grant execute on all functions in schema icash_sender_private to service_role;
 set check_function_bodies=on;
 `;
export const seedDelay=`
 select fixture_message('delay',fixture_thread('delay'));
 update public.icash_text_messages set state='accepted',provider_id='synthetic-delay-original',created_at=now()-interval '3 hours' where id=md5('messagedelay')::uuid;
 insert into public.icash_operation_spend(operation_key,account_id,state,dispatched_at,reserved_micros,actual_micros,charged_cents)
 values('text:'||md5('messagedelay')::uuid,md5('owner')::uuid,'dispatched',now()-interval '3 hours',10000,null,null);
 insert into public.icash_text_events(id,type,payload) values('synthetic-delay','numbers.delayed',jsonb_build_object(
 'id','synthetic-delay','type','numbers.delayed','timestamp',extract(epoch from now()-interval '2 hours'),
 'data',jsonb_build_object('reason','number_temporary_unavailable','original_number','+14155550100','affected_id','synthetic-delay-original')));
 select fixture_message('waiting',fixture_thread('waiting'));
 select icash_sender_private.defer(md5('owner')::uuid,md5('messagewaiting')::uuid,'+14155550100','automatic');
 update icash_sender_private.waiting set queued_at=now()-interval '20 minutes',next_check_at=now()-interval '1 second';
`;
export const ageAssignments=`update public.icash_seller_opener_assignments set created_at=now()-interval '6 minutes';`;
export const readyRetry=`update icash_sender_private.waiting set next_check_at=now()-interval '1 second';`;
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 console.log(JSON.stringify({setup,migration,seedDelay,ageAssignments,readyRetry}));
