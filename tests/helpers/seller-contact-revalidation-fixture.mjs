// Synthetic isolated database only; no providers or production access.
import {readFileSync} from 'node:fs';
import {createOperationalContactFixture} from './operational-contact-fixture.mjs';
export async function createSellerRevalidationFixture(modulePath){
 const f=await createOperationalContactFixture(modulePath,{automaticChannels:true});
 const {pg,q,rpc,one,account}=f;
 const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
 try{
 const original=read('supabase/migrations/20261009223901_seller_gap_recovery_learning.sql');
 await pg.exec(original.slice(original.indexOf('create table public.icash_seller_gaps('),original.indexOf('create function public.icash_seller_contact_stop')));
 await pg.exec(original.slice(original.indexOf('do $$ declare definition text;begin'),original.indexOf('alter function public.icash_next_automation() rename to icash_next_before_seller_recovery;')));
 await pg.exec(`
 alter table icash_text_threads add column if not exists manual_only boolean not null default false;
 alter table icash_text_threads add column if not exists retired_at timestamptz;
 alter table icash_text_threads add column if not exists seller_intake_id uuid;
 alter table icash_text_messages add column if not exists customer_author_id uuid;
 create or replace function icash_seller_conversation_context(uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create or replace function icash_seller_sms_permission_current(uuid,uuid,boolean) returns boolean language sql as $$select false$$;
 create or replace function icash_current_viewing_slots(uuid,uuid) returns jsonb language sql as $$select '[]'::jsonb$$;
 create or replace function icash_choose_seller_recovery(uuid,text,text,text,integer) returns text language sql as $$select 'no-response-v1'::text$$;
 create or replace function icash_sms_outreach_window_current(uuid,uuid) returns boolean language sql as $$select true$$;
 create or replace function icash_quarantine_stalled_voice_slots(integer) returns integer language sql as $$select 0$$;
 create or replace function icash_issue_due_signing_result() returns jsonb language sql as $$select null::jsonb$$;
 create or replace function icash_issue_due_voice_result() returns jsonb language sql as $$select null::jsonb$$;
 create or replace function icash_issue_due_text_ai() returns jsonb language sql as $$select null::jsonb$$;
 create or replace function icash_issue_due_title_followup() returns jsonb language sql as $$select null::jsonb$$;
 create or replace function icash_issue_ready_fulfillment() returns jsonb language sql as $$select null::jsonb$$;
 create or replace function icash_recover_unstarted_seller_opener() returns jsonb language sql as $$select '{"token":"continuous-prospecting"}'::jsonb$$;
 create or replace function icash_resume_prospecting_ticket() returns jsonb language sql as $$select null::jsonb$$;
 create or replace function icash_next_before_prospecting_budget() returns jsonb language sql as $$select null::jsonb$$;
 `);
 for(const row of JSON.parse(read('tests/fixtures/seller-followup-window-baseline.json')))await pg.exec(row.definition);

 await pg.exec(read('config/seller-followup-window.sql'));
 const cadence=read('config/seller-text-cadence.sql');
 await pg.exec(cadence.slice(cadence.indexOf('create function public.icash_seller_text_cadence_current'),cadence.indexOf('-- Evaluate again')));
 const refusals=read('config/seller-response-policy.sql');
 await pg.exec(refusals.slice(refusals.indexOf('create function public.icash_seller_direct_response_match'),refusals.indexOf('create function public.icash_seller_call_disposition')));
 await pg.exec(read('config/seller-natural-refusals.sql'));
 await pg.exec(read('config/seller-text-active-priority.sql'));
 await pg.exec(`create table icash_cancellation_notices(account_id uuid,sms_id uuid);
 create or replace function icash_call_has_seller_response(jsonb) returns boolean language sql as $$select false$$;`);
 for(const signature of ['icash_open_seller_gap(uuid,uuid,text,uuid,text,text,timestamptz)','icash_seller_recovery_current(uuid)']){
  let def=(await one('select pg_get_functiondef($1::regprocedure) def',['public.'+signature])).def;
  if(signature.startsWith('icash_open')){
   const needle="due:=greatest(now(),p_at+interval '4 hours');";
   if(!def.includes(needle)||!cadence.includes("due:=greatest(now(),p_at+interval ''3 days'');"))throw Error('Production cadence scheduling prerequisite changed');
   def=def.replace(needle,"due:=greatest(now(),p_at+interval '3 days');");
  }else def=def.replace(' anchor:=g.source_at;'," if not public.icash_seller_text_cadence_current(g.account_id,t.id,g.outgoing_id,g.reason='no_response') then return false;end if;\n anchor:=g.source_at;");
  await pg.exec(def);
 }
 await f.prepare();await f.project();
 const thread=(await one('select id from icash_text_threads where account_id=$1',[account])).id;
 await q('create table icash_sms_routes(sender text,recipient text,account_id uuid,needs_review boolean not null default false,revision bigint default 1)');
 await q('insert into icash_sms_routes(sender,recipient,account_id) select sender,recipient,account_id from icash_text_threads where id=$1',[thread]);
 const fresh=(await one('select operational_contact_id id from icash_text_threads where id=$1',[thread])).id;
 const oldReceipt=(await one(`insert into icash_dnc_verification_receipts(source_id,phone,contact_key,provider_reference,receipt_hash,checked_at,expires_at,clear,contact_timezone,timezone_source_reference)
 select source_id,phone,contact_key,'SIMULATION original expired receipt',receipt_hash,now()-interval '4 days 1 hour',now()-interval '3 days 1 hour',clear,contact_timezone,timezone_source_reference
 from icash_dnc_verification_receipts where id=$1 returning id`,[f.dnc])).id;
 const oldContact=(await one(`insert into icash_operational_contacts(account_id,screening_id,channel,phone,contact_key,timezone,timezone_basis,local_start_hour,local_end_hour,owner_user_id,sending_principal,source_hash,dnc_receipt_id,eligibility_until,created_at)
 select account_id,screening_id,channel,phone,contact_key,timezone,timezone_basis,local_start_hour,local_end_hour,owner_user_id,sending_principal,source_hash,$2,now()-interval '3 days 1 hour',now()-interval '4 days 1 hour' from icash_operational_contacts where id=$1 returning id`,[fresh,oldReceipt])).id;
 await q(`update icash_text_threads set operational_contact_id=$2,eligibility_until=now()-interval '3 days 1 hour',dnc_checked_at=now()-interval '4 days 1 hour' where id=$1`,[thread,oldContact]);
 const message=(await one(`insert into icash_text_messages(account_id,thread_id,direction,body,state,provider_id,created_at) values($1,$2,'outgoing','SIMULATION Is this the owner?','delivered','SIMULATION original delivery',now()-interval '4 days') returning id,created_at`,[account,thread]));
 await q("update icash_screening_jobs set completed_at=now()-interval '4 days 1 hour' where id=$1",[f.screening]);
 const gap=await rpc('icash_open_seller_gap',{p_account:account,p_thread:thread,p_source:'text',p_source_id:message.id,p_reason:'no_response',p_quote:'SIMULATION unanswered owner question',p_at:new Date(message.created_at).toISOString()});
 await pg.exec(read('config/seller-contact-revalidation.sql'));
 const snapshot=()=>rpc('icash_seller_contact_revalidation_snapshot',{p_gap:gap,p_contact:fresh});
 const review=async(candidate=fresh)=>rpc('icash_review_seller_contact_revalidation',{p_gap:gap,p_contact:candidate,p_expected_hash:(await one("select encode(sha256(convert_to(public.icash_seller_contact_revalidation_snapshot($1,$2)::text,'UTF8')),'hex') hash",[gap,candidate])).hash,p_reference:'SIMULATION exact receipt and same-thread review'});
 const apply=id=>rpc('icash_apply_seller_contact_revalidation',{p_review:id});
 const enable=()=>q('update icash_seller_recovery_private.contact_revalidation_policy set enabled=true where id=1');
 return {...f,thread,fresh,oldReceipt,oldContact,message:message.id,gap,snapshot,review,apply,enable};
 }catch(e){await pg.close();throw e;}
}
