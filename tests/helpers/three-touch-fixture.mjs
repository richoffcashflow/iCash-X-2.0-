import {unansweredNativeFixtureSql,read} from './unanswered-seller-fixture.mjs';
export {read};
export function threeTouchFixtureSql(){
 let sql=unansweredNativeFixtureSql();
 for(const t of JSON.parse(read('tests/fixtures/three-touch-schema.json'))){
  sql+=`create table if not exists public.${t.name}();`;
  for(const c of t.columns)sql+=`alter table public.${t.name} add column if not exists "${c.name}" ${c.type};`;
 }
 sql+=`alter table public.icash_seller_gaps alter column id set default gen_random_uuid();
 create table public.icash_seller_recovery_variants(key text,reason text,body text,enabled boolean);
 insert into public.icash_seller_recovery_variants values('no-response-v1','no_response','Would you still like to discuss a possible cash offer?',true);
 create table public.icash_contact_suppressions(contact_key text);
 create table public.icash_text_assets(id uuid,account_id uuid,deal_id uuid,url text,bytes bigint,verified_until timestamptz);
 alter table public.icash_text_messages alter column id set default gen_random_uuid(),alter column created_at set default now(),add unique(request_key);
 alter table public.icash_seller_recovery_attempts alter column assigned_at set default now();
 create function public.icash_seller_conversation_context(uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function public.icash_seller_sms_permission_current(uuid,uuid,boolean) returns boolean language sql as $$select false$$;
 create function public.icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql as $$select exists(select 1 from public.icash_text_threads t join public.fixture_eligibility e on e.contact_id=t.operational_contact_id and e.account_id=t.account_id where t.id=$2 and t.account_id=$1 and t.eligibility_until>now() and e.allowed)$$;
 create function public.icash_current_viewing_slots(uuid,uuid) returns jsonb language sql as $$select '[]'::jsonb$$;
 create function public.icash_seller_recovery_context_variant(uuid,uuid) returns text language sql as $$select null::text$$;
 create function public.icash_choose_seller_recovery(uuid,text,text,text,integer) returns text language sql as $$select 'no-response-v1'::text$$;
 create function public.icash_sms_single_segment(text) returns boolean language sql as $$select length($1)<=160$$;
 create unique index fixture_gap_source on public.icash_seller_gaps(source,source_id,reason);
 create schema icash_text_receipt_private;
 create function icash_text_receipt_private.canonical_update(icash_text_messages,icash_text_messages) returns boolean language sql as $$select false$$;
 create function public.icash_seller_contact_stop(text) returns boolean language sql as $$select coalesce($1 ~* 'stop',false)$$;
 set check_function_bodies=off;`;
 for(const f of JSON.parse(read('tests/fixtures/three-touch-predecessors.json')))sql+=f.definition+';';
 sql+='set check_function_bodies=on;';
 return sql;
}
export function threeTouchMigrations(){return ['calls','texts','catchup'].map(n=>read('config/three-touch-seller-'+n+'.sql')).join('\n');}
export function threeTouchMetaFixtureSql(){return `
 alter table public.icash_voice_jobs alter column due_at set default now();
 alter table public.icash_voice_jobs add constraint icash_voice_jobs_meta_followup_lead_id_key unique(meta_followup_lead_id);
 create function public.icash_membership_work_allowed(uuid) returns boolean language sql as $$select true$$;
 create function public.icash_seller_voice_permission_current(uuid,uuid) returns boolean language sql as $$select exists(select 1 from public.icash_contact_permissions where id=$2 and account_id=$1 and revoked_at is null and permission_until>now())$$;
 create function public.icash_voice_attempt_recorded(uuid) returns boolean language sql as $$select exists(select 1 from public.icash_call_recordings where voice_job_id=$1 and call_sid is not null and call_ended_at is not null)$$;
 create function public.icash_meta_queue_message(uuid,text,text,text) returns uuid language sql as $$select null::uuid$$;
 create function public.icash_meta_call_outcome(jsonb) returns text language sql as $$select case when public.icash_call_has_seller_response($1) then 'responded' else 'no_response' end$$;
 -- Provider/message transport, entitlement and final permission are explicit
 -- fixture boundaries. Queue and all third-call proof checks are real SQL.
 `;}
