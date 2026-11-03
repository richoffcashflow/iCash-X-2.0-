// Disposable local database only. Extract actual session constraints, immutable
// guard, claim, transition and completion code; no production configuration.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const id='00000000-0000-4000-8000-000000000001',account='00000000-0000-4000-8000-000000000002';
export const call='CA'+'b'.repeat(32),operation='recorded-reception:'+call;
const source=read('config/recorded-reception.sql');
export function fn(name){
 const start=source.indexOf('create function '+name+'(');if(start<0)throw Error(name);
 const begin=source.indexOf('$$',start),end=source.indexOf('$$;',begin+2);
 return source.slice(start,end+3);
}
const start=source.indexOf('create table icash_recorded_reception_private.sessions ('),end=source.indexOf('\n);',start);
export const setupSql=`
drop schema if exists icash_recorded_reception_private cascade;
drop schema public cascade;create schema public;create schema icash_recorded_reception_private;
create table public.icash_accounts(id uuid primary key,bot_paused boolean default false);
create table public.icash_operation_rates(id uuid primary key);
create table public.icash_operation_spend(operation_key text primary key,account_id uuid,state text,charge_cap_cents bigint,reserved_micros bigint,receipt jsonb);
create table icash_recorded_reception_private.configs(id uuid primary key);
create table icash_recorded_reception_private.cost_policies(id uuid primary key);
${fn('icash_recorded_reception_private.clock_now')}
${fn('icash_recorded_reception_private.keys')}
${source.slice(start,end+4)}
${fn('public.icash_transition_recorded_reception')}
${fn('public.icash_claim_recorded_reception_work')}
${fn('public.icash_finish_recorded_reception_work')}
insert into public.icash_accounts values('${account}',true);
insert into public.icash_operation_rates values('${id}');
insert into icash_recorded_reception_private.configs values('${id}');
insert into public.icash_operation_spend values('${operation}','${account}','dispatched',600,123456,'{"original":"immutable synthetic receipt"}');
insert into icash_recorded_reception_private.sessions(
 id,configuration,config_id,account_id,operation_key,provider_account_sid,call_sid,recording_sid,direction,from_phone,to_phone,
 caller_hash,contact_key,config_hash,agent_id,branch_id,version_id,call_profile,rate_id,rate_snapshot,reserved_micros,charge_cap_cents,max_total_seconds,
 standard_cost_multiplier,elevenlabs_cost_multiplier,nonce_hash,stop_token_hash,disclosure_version,pricing_policy,state,
 created_at,updated_at,call_started_at,call_deadline_at,consent_deadline_at,setup_claimed_at,setup_confirmed_at,consent_at,consent_evidence,
 start_claimed_at,register_claimed_at,provider_started_at,ended_at,duration_seconds,audio_expires_at,end_requested_at,call_ended_at,call_terminal_status,
 provider_recording_price_micros,price_is_estimate,next_reconcile_at,reconcile_attempts)
 values('${id}','{"original":"configuration"}','${id}','${account}','${operation}','AC'||repeat('a',32),'${call}','RE'||repeat('c',32),'inbound','+12125550199','+12125550123',
 repeat('d',64),encode(sha256(convert_to('+12125550199','UTF8')),'hex'),'original-hash','agent_fixture','branch_fixture','version_fixture','normal','${id}','{"original":"rate"}',123456,600,600,
 2,2,repeat('e',64),repeat('f',64),'original-disclosure','{"original":"pricing"}','available',
 now()-interval '2 days',now(),now()-interval '2 days',now()-interval '2 days'+interval '600 seconds',now()-interval '2 days'+interval '45 seconds',
 now()-interval '2 days',now()-interval '2 days',now()-interval '2 days','{"original":"consent"}',
 now()-interval '2 days',now()-interval '2 days',now()-interval '2 days',now()-interval '2 days'+interval '10 seconds',10,now()+interval '28 days',
 now()-interval '2 days'+interval '11 seconds',now()-interval '2 days'+interval '11 seconds','completed',2500,false,now()-interval '1 second',11);
${fn('icash_recorded_reception_private.guard_session')}
create trigger recorded_reception_session_guard before update or delete on icash_recorded_reception_private.sessions for each row execute function icash_recorded_reception_private.guard_session();
revoke all on function public.icash_finish_recorded_reception_work(uuid,uuid,text,text,uuid,bigint,text,jsonb) from public;
`;
export const migration=read('config/recorded-reception-identity-backoff.sql');
export const finishSql=`select public.icash_finish_recorded_reception_work(id,account_id,operation_key,'reconcile',reconcile_lease_token,row_version,'retry','{"reason":"conversation_identity_required"}') from icash_recorded_reception_private.sessions`;
export const bindSql=`select public.icash_transition_recorded_reception(id,account_id,operation_key,row_version,'bind_conversation','{"conversationId":"conv_originalfixture","agentId":"agent_fixture","branchId":"branch_fixture","versionId":"version_fixture"}') from icash_recorded_reception_private.sessions`;
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify({setupSql,migration,finishSql,bindSql,id,account,operation}));
