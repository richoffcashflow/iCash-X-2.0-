// Actual current final reservation/dial functions and their phone/hours delegates.
// Explicit external eligibility fixtures never call providers or spend money.
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export async function setupOwnerDemoFinalAdmissionFixture(pg){
 await pg.exec(`create table icash_dnc_verification_receipts(id uuid,checked_at timestamptz,clear boolean);
 create table icash_recording_private.capacity_quarantines(operation_key text);
 create function icash_recording_private.clock_now() returns timestamptz language sql as $$select clock_timestamp()$$;
 -- Non-demo context pathways and credit ledger are deliberately isolated. The
 -- source/permission/spacing/hour delegates and final state machine are actual.
 create function icash_voice_outreach_context(uuid,uuid) returns jsonb language sql as $$select '{"timezone":"America/Chicago","activeConversation":false}'::jsonb$$;
 create function icash_requested_seller_call_current(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_meta_followup_call_current(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_outreach_window_open(text,text,timestamptz) returns boolean language sql as $$select false$$;
 create function icash_operational_contact_current(uuid,uuid,text,boolean) returns boolean language sql as $$select false$$;
 create function icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_seller_response_operation_allowed(uuid,text) returns boolean language sql as $$select true$$;
 alter table icash_operation_spend add primary key(operation_key);
 create table fixture_reservation_attempts(account_id uuid,operation_key text primary key,permission_until timestamptz);
 create function icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean) returns void language sql as $$insert into public.fixture_reservation_attempts values($1,$2,$4) on conflict do nothing;insert into public.icash_operation_spend(account_id,operation_key,permission_until,state) values($1,$2,$4,'reserved') on conflict do nothing$$;
 `);
 const targets=read('config/operational-contact-eligibility.sql');await pg.exec(targets.slice(targets.indexOf('create view public.icash_voice_contact_targets'),targets.indexOf('-- Update read/plumbing consumers')));
 const recording=read('config/required-call-recording.sql');await pg.exec(recording.slice(recording.indexOf('create function icash_recording_private.keys('),recording.indexOf('create function public.icash_create_call_recording(')));
 await pg.exec('set check_function_bodies=off;');
 for(const file of ['tests/fixtures/owner-demo-final-predicates-live-functions.json','tests/fixtures/owner-demo-final-admission-live-functions.json'])for(const row of JSON.parse(read(file)))await pg.exec(row.definition);
 await pg.exec('set check_function_bodies=on;');
}
