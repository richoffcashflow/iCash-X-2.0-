import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
export const migration=read('config/buyer-call-package-followthrough.sql');
assert.equal(migration,read('supabase/migrations/20261116225947_buyer_call_package_followthrough.sql'));
const fn=(file,name)=>{const text=read(file),a=text.indexOf(`create function public.${name}(`)>=0?text.indexOf(`create function public.${name}(`):text.indexOf(`create or replace function public.${name}(`);assert(a>=0,name);return text.slice(a,text.indexOf('end $$;',a)+7);};
export const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
export const started=new Date(Math.floor(Date.now()/1000)*1000-180000).toISOString(),ended=new Date(Date.parse(started)+120000).toISOString();
export const source={version:'buyer-call-package-v1',complete:true,startedAt:started,turns:[{role:'agent',message:'How can I help?',seconds:5},{role:'user',message:'Please send me the photos',seconds:40},{role:'agent',message:'I will check the current details.',seconds:41},{role:'user',message:'Thank you.',seconds:45}]};
export const projection=s=>{const rows=s.turns.filter(x=>typeof x.message==='string').map(({role,message})=>({role,message}));return rows.length>80?[...rows.slice(0,40),...rows.slice(-40)]:rows;};
export async function setup(pg){
 await pg.exec(`
 do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;
 create schema icash_recorded_reception_private;create schema icash_sender_private;
 create table icash_accounts(id uuid primary key,bot_paused boolean default false);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid);
 create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,party text,recipient text,paused boolean default false,manual_only boolean default false,ai_mode text default 'auto',retired_at timestamptz,owner_buyer_test_id uuid,timezone text default 'UTC',sender text default '+12145550102');
 create table icash_text_messages(id uuid primary key default gen_random_uuid(),account_id uuid,thread_id uuid,direction text default 'outgoing',state text,provider_id text,body text,request_key uuid unique,created_at timestamptz default now(),event_id text);
 create table icash_text_events(id text primary key,type text,payload jsonb,received_at timestamptz default now());
 create table icash_text_ai_jobs(id uuid,account_id uuid,outgoing_id uuid);
 create table icash_text_suppressions(phone text primary key);
 create table icash_contact_suppressions(contact_key text primary key);
 create table icash_seller_progress_settings(buyer_reply_enabled boolean);
 create table icash_operating_budget(id integer primary key);
 create table icash_buyer_package_links(id uuid primary key,account_id uuid,deal_id uuid,purchase_envelope_id uuid,asking_price_cents bigint,token text,revoked_at timestamptz);
 create table icash_disposition_authorities(account_id uuid,deal_id uuid,purchase_envelope_id uuid,expires_at timestamptz);
 create table icash_buyer_viewing_requests(id uuid primary key,account_id uuid,deal_id uuid,screening_id uuid,thread_id uuid,source text,source_id uuid,kind text,state text,quote text,coordination_quote text,viewing_quote text,title_quote text,reviewed_at timestamptz,created_at timestamptz default now());
 create table icash_recorded_reception_private.sessions(id uuid primary key,account_id uuid,conversation_id text,from_phone text,to_phone text,call_sid text,provider_account_sid text,call_profile text default 'normal',created_at timestamptz,call_started_at timestamptz,call_ended_at timestamptz,call_terminal_status text default 'completed',register_claimed_at timestamptz,max_total_seconds integer default 600);
 create table icash_recorded_reception_private.buyer_bindings(session_id uuid primary key,account_id uuid,deal_id uuid,thread_id uuid);
 create table icash_recorded_reception_private.buyer_history(session_id uuid primary key,account_id uuid,screening_id uuid,conversation_id text,completed_at timestamptz,transcript jsonb);
 create table fixture_reservations(message_id uuid primary key);
 create table fixture_gates(allowed boolean,review boolean,admit boolean,reserved boolean,price bigint,admissions integer default 0);
 create function icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql as $$select review from public.fixture_gates$$;
 create function icash_journey_allowed(uuid,uuid) returns boolean language sql as $$select allowed and not exists(select 1 from public.icash_accounts where id=$1 and bot_paused) from public.fixture_gates$$;
 create function icash_buyer_package_data(uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('reserved',reserved,'askingPriceCents',price) from public.fixture_gates$$;
 create function icash_seller_progress_gate(uuid,uuid) returns boolean language sql as $$select true$$;
 create function icash_sender_private.defer(uuid,uuid,text,text) returns void language sql as $$select$$;
 create function icash_queue_text(a uuid,t uuid,k uuid,b text,assets uuid[]) returns uuid language plpgsql as $$declare m uuid;begin
  insert into public.icash_text_messages(account_id,thread_id,request_key,body,state) values(a,t,k,b,'ready') on conflict(request_key) do nothing;
  select id into m from public.icash_text_messages where request_key=k and account_id=a and thread_id=t and body=b;return m;end$$;
 -- Explicit unchanged dispatch boundary: actual installed outer wrapper calls
 -- this atomic fixture instead of charging/contacting a provider.
 create function icash_claim_text_before_progress(a uuid,m uuid,s text) returns jsonb language plpgsql as $$begin
  if not (select admit from public.fixture_gates) then return null;end if;
  update public.icash_text_messages set state='dispatching' where id=m and account_id=a and state='ready' and provider_id is null;
  if not found then return null;end if;insert into public.fixture_reservations values(m);update public.fixture_gates set admissions=admissions+1;return jsonb_build_object('id',m);end$$;
 insert into icash_operating_budget values(1);insert into icash_seller_progress_settings values(true);insert into fixture_gates values(true,true,false,false,12500000,0);
 insert into icash_accounts(id) values('${id(1)}');insert into icash_deal_files values('${id(2)}','${id(1)}','${id(3)}');
 insert into icash_text_threads(id,account_id,deal_id,party,recipient) values('${id(4)}','${id(1)}','${id(2)}','buyer','+12145550101');
 insert into icash_buyer_package_links values('${id(5)}','${id(1)}','${id(2)}','${id(6)}',12500000,repeat('a',32),null);
 insert into icash_disposition_authorities values('${id(1)}','${id(2)}','${id(6)}',now()+interval '1 day');
 insert into icash_recorded_reception_private.sessions(id,account_id,conversation_id,from_phone,to_phone,call_sid,provider_account_sid,created_at,call_started_at,call_ended_at,register_claimed_at)
 values('${id(7)}','${id(1)}','conv_fixture','+12145550101','+12145550102','CAfixture','ACfixture','${started}','${started}','${ended}','${started}');
 insert into icash_recorded_reception_private.buyer_bindings values('${id(7)}','${id(1)}','${id(2)}','${id(4)}');
 `);
 await pg.query('insert into icash_recorded_reception_private.buyer_history values($1,$2,$3,$4,$5,$6)',[id(7),id(1),id(3),'conv_fixture',ended,JSON.stringify(projection(source))]);
 await pg.query("insert into icash_buyer_viewing_requests(id,account_id,deal_id,screening_id,thread_id,source,source_id,kind,state,quote,coordination_quote) values($1,$2,$3,$4,$5,'call',$6,'buyer_followup','needs_confirmation',$7,$7)",[id(8),id(1),id(2),id(3),id(4),id(7),source.turns[1].message]);
 const reply=read('config/sms-campaign-reply-attention.sql');const replyStart=reply.indexOf('create function public.icash_sms_reply_time(');await pg.exec(reply.slice(replyStart,reply.indexOf('$$;',replyStart)+3));
 await pg.exec(fn('config/buyer-compound-package-requests.sql','icash_buyer_request_action'));
 await pg.exec(fn('config/buyer-scenario-followups.sql','icash_save_buyer_inbound_history'));
 await pg.exec(read('tests/fixtures/buyer-call-package-prerequisite.sql'));
 await pg.exec('revoke all on function icash_claim_text(uuid,uuid,text),icash_buyer_request_action(text),icash_save_buyer_inbound_history(uuid,text,jsonb) from public;grant execute on function icash_claim_text(uuid,uuid,text),icash_buyer_request_action(text),icash_save_buyer_inbound_history(uuid,text,jsonb) to service_role');
}
export const apply=async pg=>{await pg.exec('begin');try{await pg.exec(migration);await pg.exec('commit');}catch(e){await pg.exec('rollback');throw e;}};
export const enable=pg=>pg.query("update icash_buyer_call_package_private.settings set enabled=true,enabled_at=$1::timestamptz-interval '1 minute'",[started]);
export function api(pg){
 const one=async(sql,args=[])=>(await pg.query(sql,args)).rows[0];
 return {one,capture:async(s=source,session=id(7),conversation='conv_fixture')=>(await one('select icash_capture_buyer_call_package($1,$2,$3) result',[session,conversation,JSON.stringify(s)])).result,
  claim:async()=>(await one('select icash_claim_buyer_call_package() result')).result,
  final:async(message,account=id(1))=>(await one('select icash_claim_text($1,$2,$3) result',[account,message,'+12145550102'])).result,
  due:()=>pg.exec("update icash_buyer_call_package_private.actions set next_attempt_at=now()-interval '1 minute'"),
 };
}

// Provider evidence fixture, including the exact production helper (above).
export async function incoming(pg,{thread=id(4),account=id(1),phone='+12145550101',body='Please email me instead',timestamp=Date.now()/1000,eventType='text.incoming.sms',patch={}}={}){
 const event='evt_'+Math.random().toString(16).slice(2),payload={id:event,type:eventType,timestamp,data:{from:phone,to:'+12145550102',body},...patch};
 await pg.query('insert into icash_text_events(id,type,payload) values($1,$2,$3)',[event,eventType,JSON.stringify(payload)]);
 return (await pg.query("insert into icash_text_messages(account_id,thread_id,direction,state,body,event_id) values($1,$2,'incoming','received',$3,$4) returning id",[account,thread,body,event])).rows[0].id;
}
