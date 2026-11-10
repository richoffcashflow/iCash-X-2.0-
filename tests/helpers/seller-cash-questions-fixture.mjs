import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setupSql as v5Setup,migration as v5,seedSql,queueSql} from './seller-sms-learning-v5-fixture.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const original=JSON.parse(read('tests/fixtures/seller-cash-copy-before.json')),extra=JSON.parse(read('tests/fixtures/seller-cash-extra-before.json'));
export const setupSql=v5Setup+seedSql+v5+`
create schema icash_text_receipt_private;create schema icash_sender_private;
-- Shared sender capacity is an explicit fixture; final transport is never invoked.
create function icash_text_receipt_private.sender_opener_available(text) returns boolean language sql as $$select true$$;
create function icash_sender_private.cohort(uuid,uuid) returns text language sql as $$select 'fixture'::text$$;
create function icash_sender_private.room(text,boolean,uuid,text) returns boolean language sql as $$select true$$;
alter table icash_sms_seller_openings add owner_reply_id uuid,add interest_message_id uuid;
alter table icash_text_ai_jobs add account_id uuid,add thread_id uuid,add message_id uuid unique,add state text,add analysis jsonb;
alter table icash_operation_spend add dispatched_at timestamptz;
create table icash_inbound_voice_routes(business_number text,enabled boolean,reviewed_until timestamptz,agent_config_hash text,called_number text);
create table icash_seller_progress_settings(id int,enabled boolean,dialogue_enabled boolean,voice_text_enabled_at timestamptz,initial_reply_enabled_at timestamptz);
insert into icash_seller_progress_settings values(1,true,true,now(),now());
create function icash_seller_limited_contact(uuid,uuid) returns boolean language sql as $$select false$$;
create function icash_sms_reply_time(uuid) returns numeric language sql as $$select extract(epoch from created_at) from public.icash_text_messages where id=$1$$;
create function icash_seller_response_disposition(text) returns text language sql as $$select case when $1='STOP' then 'opt_out' end$$;
create function icash_seller_conversation_context(uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('address','123 Main St #4/2','principal','Fixture Investor','assistantName','Alex')$$;
create function icash_seller_conversation_human(text) returns boolean language sql as $$select false$$;
create function icash_text_signal(text,text) returns text language sql as $$select null::text$$;
create function icash_seller_identity_question(text) returns boolean language sql as $$select true$$;
create function icash_seller_direct_response_match(text,text) returns boolean language sql as $$select false$$;
create function icash_seller_contact_stop(text) returns boolean language sql as $$select $1='STOP'$$;
create function icash_seller_post_call_identity_reply(uuid,uuid) returns text language sql as $$select null::text$$;
create function icash_seller_voice_text_context(uuid,uuid) returns boolean language sql as $$select false$$;
create function icash_sms_inbound_campaign_current(uuid) returns boolean language sql as $$select true$$;

grant usage on schema icash_text_receipt_private,icash_sender_private to service_role;
grant select,insert,update on all tables in schema public to service_role;
`+
['icash_queue_seller_opener','icash_seller_opener_candidate_body'].map(n=>original.find(f=>f.proname===n).definition+';').join('\n')+
['icash_prepare_sms_inbound_reply','icash_prepare_sms_reply_before_owner_question','icash_seller_dialogue_context','icash_seller_reply_before_viewings'].map(n=>extra.find(f=>f.proname===n).definition+';').join('\n');
export const migration=read('config/seller-cash-questions.sql');
export const enableSql="update icash_learning_policy_private.cash_question_settings set enabled_at=now();";
export {queueSql};
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify({setupSql,migration,enableSql,queueSql}));
