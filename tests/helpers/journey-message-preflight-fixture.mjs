// Isolated SQL fixture. No transport, credentials, customer rows or billing.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
export function functionSql(file,name){
 const source=read(file),start=source.indexOf(`create function public.${name}(`);
 assert(start>=0,name);return source.slice(start,source.indexOf('$$;',source.indexOf('as $$',start)+5)+3);
}
export const migration=read('config/journey-message-preflight-retry.sql');
assert.equal(migration,read('supabase/migrations/20261116224226_journey_message_preflight_retry.sql'));
export async function applyMigration(pg){
 await pg.exec('begin');
 try{await pg.exec(migration);await pg.exec('commit');}
 catch(error){await pg.exec('rollback');throw error;}
}
export const ids={account:'00000000-0000-4000-8000-000000000001',deal:'00000000-0000-4000-8000-000000000002',screen:'00000000-0000-4000-8000-000000000003',thread:'00000000-0000-4000-8000-000000000004',journey:'00000000-0000-4000-8000-000000000005',message:'00000000-0000-4000-8000-000000000006',request:'00000000-0000-4000-8000-000000000007',other:'00000000-0000-4000-8000-000000000008',envelope:'00000000-0000-4000-8000-000000000009',showing:'00000000-0000-4000-8000-000000000010'};
export const reset=`
 truncate icash_journey_messages,icash_text_messages,icash_text_suppressions,icash_deal_journeys,icash_journey_blockers,icash_text_threads,icash_showing_requests,icash_buyer_deposit_receipts,icash_property_controls,icash_handoffs,icash_accounts,icash_deal_files,icash_screening_jobs,icash_signing_envelopes;
 update fixture_gates set review=true,admit=false,admissions=0;
 insert into icash_accounts values('${ids.account}',false);
 insert into icash_screening_jobs values('${ids.screen}','${ids.account}','complete','{"propertyId":"fixture"}');
 insert into icash_deal_files values('${ids.deal}','${ids.account}','${ids.screen}','under_contract','{}');
 insert into icash_signing_envelopes values('${ids.envelope}','${ids.account}','${ids.deal}','purchase','completed',false);
 insert into icash_text_threads values('${ids.thread}','${ids.account}','${ids.deal}',false,false,null,'+12145550101');
 insert into icash_deal_journeys values('${ids.journey}','${ids.account}','${ids.deal}','${ids.thread}','${ids.request}',now()+interval '14 days','collecting',true,false,null);
 insert into icash_journey_messages(id,journey_id,account_id,thread_id,event_key,state,body) values('${ids.message}','${ids.journey}','${ids.account}','${ids.thread}','buyer_intake','ready','Fixture buyer intake link');
`;
export async function setup(pg){
 await pg.exec(`
 do $$begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;
 create table icash_accounts(id uuid primary key,bot_paused boolean);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,state text,snapshot jsonb);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb);
 create table icash_signing_envelopes(id uuid primary key,account_id uuid,deal_id uuid,kind text,state text,test_mode boolean);
 create table icash_property_controls(account_id uuid,property_id text,manual boolean);
 create table icash_handoffs(account_id uuid,screening_id uuid,state text);
 create table icash_buyer_deposit_receipts(account_id uuid,deal_id uuid,envelope_id uuid);
 create table icash_journey_messages(id uuid primary key,journey_id uuid,account_id uuid,thread_id uuid,event_key text,showing_id uuid,showing_version integer,state text,body text,message_id uuid,attempts integer default 0,next_attempt_at timestamptz default now());
 create table icash_deal_journeys(id uuid primary key,account_id uuid,deal_id uuid,thread_id uuid,request_id uuid,expires_at timestamptz,state text,wants_assignment boolean,wants_viewing boolean,envelope_id uuid,last_progress_at timestamptz default now());
 create table icash_journey_blockers(journey_id uuid primary key,kind text,state text,revision integer);
 create table icash_showing_requests(id uuid,deal_id uuid,buyer_request_id uuid,version integer,state text,starts_at timestamptz,seller_confirmed_at timestamptz,buyer_confirmed_at timestamptz);
 create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,paused boolean,manual_only boolean,retired_at timestamptz,recipient text);
 create table icash_text_messages(id uuid primary key,account_id uuid,thread_id uuid,state text,provider_id text,body text);
 create table icash_text_suppressions(phone text);
 create table fixture_gates(review boolean,admit boolean,admissions integer);
 insert into fixture_gates values(true,false,0);
 create function icash_buyer_outreach_held(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_signing_action_allowed(uuid,uuid) returns boolean language sql as $$select true$$;
 create function icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql as $$select review from public.fixture_gates$$;
 create function icash_current_viewing_slots(uuid,uuid) returns jsonb language sql as $$select '[]'::jsonb$$;
 create function icash_queue_text(a uuid,t uuid,k uuid,b text,assets uuid[]) returns uuid language plpgsql as $$begin
  insert into public.icash_text_messages values(k,a,t,'ready',null,b);return k;end$$;
 -- Explicit test boundary for the unchanged final transport chain: one-use
 -- message row lock, current admission and ready/null-provider state required.
 create function icash_claim_text_before_journey(a uuid,m uuid,s text) returns jsonb language plpgsql as $$declare x public.icash_text_messages;begin
  if not (select admit from public.fixture_gates) then return null;end if;
  select * into x from public.icash_text_messages where id=m and account_id=a for update;
  if not found or x.state<>'ready' or x.provider_id is not null then return null;end if;
  update public.icash_text_messages set state='dispatching' where id=m;
  update public.fixture_gates set admissions=admissions+1;
  return jsonb_build_object('claim','permitted');end$$;
 `);
 for(const name of ['icash_journey_allowed','icash_journey_current','icash_journey_message_current','icash_claim_journey_message','icash_claim_text'])await pg.exec(functionSql('config/turnkey-deal-journey.sql',name));
 await pg.exec('alter function icash_journey_message_current(uuid) rename to icash_journey_message_current_before_completion;');
 await pg.exec(functionSql('config/closing-completion.sql','icash_journey_message_current'));
 await pg.exec('revoke all on function icash_claim_journey_message() from public;grant execute on function icash_claim_journey_message() to service_role;');
 await pg.exec(reset);
}
export function api(pg){
 const one=async(sql,args=[])=>(await pg.query(sql,args)).rows[0];
 return {
  one,
  claim:async()=>(await one('select public.icash_claim_journey_message() result')).result,
  due:()=>pg.exec("update icash_journey_messages set next_attempt_at=now()-interval '1 minute'"),
  final:async(message=ids.message,account=ids.account)=>(await one('select public.icash_claim_text($1,$2,$3) result',[account,message,'+12145550102'])).result,
  state:()=>one('select m.state,m.attempts,m.message_id,x.state text_state,x.provider_id from icash_journey_messages m left join icash_text_messages x on x.id=m.message_id'),
 };
}
