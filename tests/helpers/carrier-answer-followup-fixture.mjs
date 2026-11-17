import {unansweredFixtureSql,read} from './unanswered-seller-fixture.mjs';
export {read};
export const sources=JSON.parse(read('tests/fixtures/carrier-answer-followup-before.json'));
export async function installCarrierFollowupFixture(pg){
 await pg.exec(unansweredFixtureSql());
 await pg.exec('begin;'+read('config/seller-call-answer-context.sql')+read('config/seller-call-automated-greetings.sql')+read('config/seller-specific-price-answers.sql')+read('config/seller-unmarked-price-answers.sql')+read('config/unanswered-seller-followups.sql')+'commit;');
 await pg.exec(`alter table icash_seller_recovery_private.unanswered_policy add three_touch_enabled boolean not null default false;
 create role untrusted_test_role;
 alter table public.icash_call_recordings add primary key(id);
 create function icash_recording_private.clock_now() returns timestamptz language sql volatile set search_path='' as $$select clock_timestamp()$$;
 drop table icash_recording_private.terminal_cost_receipts;
 create table icash_recording_private.terminal_cost_receipts(recording_id uuid primary key references public.icash_call_recordings(id),receipt jsonb not null,components jsonb not null,evidence_ref text not null,charged_cents bigint not null,created_at timestamptz not null default icash_recording_private.clock_now());
 create table icash_recording_private.events(id bigint generated always as identity primary key,recording_id uuid not null references public.icash_call_recordings(id),account_id uuid not null,operation_key text not null,row_version bigint not null,action text not null,old_state text,new_state text not null,occurred_at timestamptz not null default icash_recording_private.clock_now(),unique(recording_id,row_version));
 alter table icash_recording_private.events enable row level security;
 alter table icash_recording_private.terminal_cost_receipts enable row level security;
 revoke all on icash_recording_private.events,icash_recording_private.terminal_cost_receipts from public,anon,authenticated,service_role;
 revoke all on all sequences in schema icash_recording_private from public,anon,authenticated,service_role;
 create function public.icash_prepare_unanswered_seller_texts() returns integer language sql as $$select 0$$;
 -- Ledger boundary substitute: gate settlement/identity checks below are real;
 -- the canonical wallet/reserve/manifest accounting has its own recording suite.
 create table fixture_settlements(operation_key text primary key,charged_cents bigint,components jsonb,evidence text);
 create function public.icash_settle_complete_costs(p_operation text,p_charge bigint,p_components jsonb,p_evidence text) returns void language plpgsql as $$begin
 insert into public.fixture_settlements values(p_operation,p_charge,p_components,p_evidence) on conflict do nothing;
 update public.icash_operation_spend set state='settled',charged_cents=p_charge,actual_micros=(select sum((value->>'amountMicros')::numeric) from jsonb_each(p_components)),settled_at=now() where operation_key=p_operation;
 end$$;
 set check_function_bodies=off;`);
 const recording=read('config/required-call-recording.sql');
 await pg.exec(recording.slice(recording.indexOf('create function icash_recording_private.audit_immutable()'),recording.indexOf('-- Exact allowlists')));
 await pg.exec(recording.slice(recording.indexOf('create trigger icash_recording_costs_immutable'),recording.indexOf('create function public.icash_settle_unstarted_recorded_call(')));
 await pg.exec(recording.slice(recording.indexOf('create function icash_recording_private.keys('),recording.indexOf('create function public.icash_create_call_recording(')));
 for(const source of [...sources.sources,sources.audit.function,...JSON.parse(read('tests/fixtures/carrier-answer-detection-before.json'))]){
  await pg.exec(source.definition);
  const signature=source.signature.includes('.')?source.signature:'public.'+source.signature;
  await pg.exec(`revoke all on function ${signature} from public,anon,authenticated,service_role,untrusted_test_role;`);
  if(source.acl.includes('service_role='))await pg.exec(`grant execute on function ${signature} to service_role;`);
 }
 await pg.exec(`create trigger icash_recording_audit after insert or update on public.icash_call_recordings for each row execute function icash_recording_private.audit();set check_function_bodies=on;`);
 await pg.exec('revoke all on function icash_recording_private.audit_immutable() from public,anon,authenticated,service_role,untrusted_test_role;');
 await pg.exec(read('config/carrier-answer-detection.sql'));
}
