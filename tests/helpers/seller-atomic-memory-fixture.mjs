import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setup as receiptSetup,migration as receiptMigration} from './seller-memory-receipt-fixture.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const predecessors=[...JSON.parse(read('tests/fixtures/seller-atomic-predecessors.json')),...JSON.parse(read('tests/fixtures/seller-atomic-extra-predecessors.json'))];
const lockDependencies=JSON.parse(read('tests/fixtures/seller-atomic-lock-dependencies.json'));
export function atomicMigration(){return read('config/seller-agreement-memory-admission.sql');}

/** Actual captured authority/source functions run over bounded fictional rows.
 * Money, provider transport and unrelated classifier dependencies are explicit
 * sentinels. This fixture cannot demonstrate production financial admission. */
export async function setup(pg){
 await receiptSetup(pg);
 await pg.exec(`
 create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create schema icash_call_offer_private;create schema icash_callback_private;create schema icash_reception_private;
 create table icash_call_offer_private.offers(account_id uuid,deal_id uuid primary key,snapshot jsonb,state jsonb,version bigint default 1);
 alter table icash_accounts add owner_user_id uuid,add bot_paused boolean not null default false;
 alter table icash_accounts add billing_model text default 'fixture_nonmembership';
 create table icash_memberships(account_id uuid,mode text,state text,paid_through timestamptz);
 alter table icash_screening_jobs add account_id uuid,add state text default 'complete',add snapshot jsonb default '{}',add result jsonb default '{}',add completed_at timestamptz default now();
 alter table icash_deal_files add updated_at timestamptz default now(),add seller_signed_at timestamptz;
 alter table icash_text_threads add sender text default '+14243948384',add paused boolean default false,add manual_only boolean default false,add ai_mode text default 'auto',add dnc_checked_at timestamptz;
 alter table icash_text_messages alter created_at set default now();
 alter table icash_text_messages add attachments jsonb default '[]',add asset_ids uuid[] default '{}',add customer_author_id uuid,add updated_at timestamptz default now(),add request_key text,add route_revision bigint default 1;
 alter table icash_text_messages add unique(event_id),add unique(provider_id),add unique(request_key);
 alter table icash_live_conversations add tool_token_hash text,add tool_expires_at timestamptz;
 alter table icash_call_recordings add id uuid default gen_random_uuid(),add screening_id uuid,add contact_key text,add party text,add conversation_id text,add stop_token_hash text,add to_phone text,add call_ended_at timestamptz,add end_requested_at timestamptz,add dial_claimed_at timestamptz;
 drop table icash_seller_agreement_private.call_history;
 create table icash_seller_agreement_private.call_history(session_id uuid primary key,account_id uuid,screening_id uuid,contact_key text,conversation_id text,completed_at timestamptz,transcript jsonb);
 create table icash_recorded_reception_private.configs(id uuid primary key,enabled boolean default true,context_policy text default 'seller_agreement_v3',reviewed_until timestamptz default now()+interval '1 day');
 alter table icash_recorded_reception_private.sessions add primary key(id),add config_id uuid,add operation_key text,add row_version bigint default 1,add configuration jsonb default '{}',add stop_token_hash text,
 add state text default 'recording',add recording_authorized_at timestamptz,add recording_sid text,add end_requested_at timestamptz,add call_deadline_at timestamptz,add register_claimed_at timestamptz,
 add provider_account_sid text,add call_sid text,add to_phone text,add direction text default 'inbound',add call_terminal_status text,add last_action text,add last_error text,
 add created_at timestamptz default now(),add updated_at timestamptz default now(),add call_started_at timestamptz,add consent_deadline_at timestamptz,
 add setup_claimed_at timestamptz,add setup_confirmed_at timestamptz,add consent_at timestamptz,add consent_evidence jsonb,add start_claimed_at timestamptz,
 add final_provider_started_at timestamptz,add ended_at timestamptz,add duration_seconds integer,add audio_expires_at timestamptz,add provider_recording_price_micros bigint,
 add price_is_estimate boolean default true,add next_reconcile_at timestamptz,add next_delete_at timestamptz,add deleted_at timestamptz,
 add reconcile_lease_token uuid,add reconcile_lease_expires_at timestamptz,add reconcile_attempts integer default 0,add deletion_lease_token uuid,add deletion_lease_expires_at timestamptz,add deletion_attempts integer default 0,
 add billing_state text default 'reserved';
 create table icash_seller_agreement_private.inbound_bindings(session_id uuid primary key,account_id uuid,deal_id uuid,thread_id uuid);
 create table icash_seller_agreement_private.confirmations(id uuid primary key default gen_random_uuid(),call_key text unique,account_id uuid,deal_id uuid,confirmation jsonb,terms jsonb,envelope_id uuid,state text default 'preparing',created_at timestamptz default now());
 create table icash_seller_agreement_private.delivery_recovery(id uuid primary key default gen_random_uuid(),request_key text unique,account_id uuid,requested_by uuid,deal_id uuid,phone text,seller_name text,expected_terms jsonb,authorization_reference text,state text default 'queued',expires_at timestamptz,created_at timestamptz default now(),claimed_at timestamptz,envelope_id uuid,result jsonb);
 create table icash_signing_templates(id uuid primary key,enabled boolean default true,reviewed_until timestamptz default now()+interval '1 day',kind text default 'purchase',template_scope text default 'standard',state_code text,signer_count integer default 1,test_mode boolean default false);
 create table icash_signing_envelopes(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,kind text,template_id uuid,terms jsonb,terms_hash text,recipients jsonb,test_mode boolean default false,consent_version text,requested_by uuid,provider_id text,state text default 'creating',created_at timestamptz default now(),updated_at timestamptz default now());
 create table icash_contract_text_deliveries(account_id uuid,envelope_id uuid,signer_id text,message_id uuid,thread_id uuid);
 create table icash_agreement_cancellations(id uuid default gen_random_uuid(),deal_id uuid,late_activity boolean default false);
 create table icash_operating_budget(id integer primary key);insert into icash_operating_budget values(1);
 create table icash_property_controls(account_id uuid,property_id text,manual boolean default false,updated_at timestamptz default now(),primary key(account_id,property_id));
 create table icash_text_suppressions(phone text primary key,reason text);
 create table icash_contact_suppressions(account_id uuid,contact_key text,source_conversation uuid,unique(account_id,contact_key));
 create table icash_text_senders(phone text primary key,enabled boolean default true);
 create table icash_sms_routes(sender text,recipient text,account_id uuid,needs_review boolean default false,revision bigint default 1,primary key(sender,recipient));
 create table icash_text_ai_jobs(id uuid primary key default gen_random_uuid(),account_id uuid,thread_id uuid,message_id uuid,state text default 'drafted',analysis jsonb default '{}',provider_id text,usage jsonb,outgoing_id uuid,updated_at timestamptz default now());
 create table icash_seller_reply_progress(message_id uuid,account_id uuid,state text,milestone text,reason text,wait_trigger text,next_step text,next_check_at timestamptz);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,state text);
 create table icash_handoffs(id uuid primary key default gen_random_uuid(),conversation_id uuid unique,account_id uuid,screening_id uuid,state text default 'open',summary text,party text,reason text,next_action text);
 create table icash_inbound_voice_receipts(live_call_id uuid);
 create table icash_live_callbacks(conversation_id uuid primary key,account_id uuid,screening_id uuid,due_at timestamptz,timezone text,evidence jsonb,state text);
 create table icash_timezone_names(name text primary key);insert into icash_timezone_names values('UTC');
 create table icash_seller_intakes(id uuid primary key,phone text,state text,attribution jsonb,created_at timestamptz);
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
 create table icash_seller_events(lead_id uuid,event_name text,occurred_at timestamptz,evidence_ref text,unique(lead_id,event_name,evidence_ref));
 create table icash_customer_identities(account_id uuid,principal text);
 create table icash_conversations(account_id uuid,deal_id uuid,human_takeover boolean default false);
 create table icash_seller_progress_settings(enabled boolean,offer_enabled boolean,offer_enabled_at timestamptz);
 insert into icash_seller_progress_settings values(true,true,'2020-01-01');
 create table icash_outreach_campaigns(id uuid,account_id uuid);
 create table icash_sms_inbound_invitations(account_id uuid,message_id uuid,thread_id uuid,sender text,recipient text,deal_id uuid,expires_at timestamptz,called_number text,reply_id uuid);
 create table icash_sms_seller_openings(thread_id uuid,owner_question_id uuid);
 create table icash_seller_opener_assignments(account_id uuid,message_id uuid);
 create table icash_inbound_voice_routes(called_number text,business_number text,enabled boolean,reviewed_until timestamptz,agent_config_hash text);
 create table fixture_text_admissions(account_id uuid,message_id uuid);
 create function icash_claim_text_before_campaign(uuid,uuid,text) returns jsonb language plpgsql as $$begin insert into public.fixture_text_admissions values($1,$2);return jsonb_build_object('messageId',$2);end$$;
 create function icash_buyer_package_data(uuid,uuid) returns jsonb language sql stable as $$select null::jsonb$$;
 create function icash_buyer_factual_text(uuid,uuid,text) returns text language sql stable as $$select null::text$$;
 create function icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql stable as $$select true$$;
 create function icash_outreach_sms_current(uuid) returns boolean language sql stable as $$select true$$;
 create function icash_sms_resolve_property(text,text,text) returns uuid language sql stable as $$select id from public.icash_text_threads where sender=$1 and recipient=$2 and retired_at is null limit 1$$;
 create function icash_sms_owner_reply_resolution_current(uuid,uuid,uuid,bigint) returns boolean language sql stable as $$select false$$;
 create function icash_seller_clarification_current(uuid,uuid,text,text,bigint) returns boolean language sql stable as $$select false$$;
 create function icash_fresh_intake_opener_current(uuid,uuid,text,text,bigint) returns boolean language sql stable as $$select false$$;
 create function icash_seller_call_disposition(jsonb) returns text language sql immutable as $$select case when $1->'optedOut'='true'::jsonb then 'opt_out' else 'interested' end$$;
 create function icash_seller_human_answer(jsonb) returns boolean language sql immutable as $$select false$$;
 create function icash_automatic_cash_offer_price(jsonb) returns bigint language sql immutable as $$select 9000000::bigint$$;
 create function icash_seller_response_disposition(text) returns text language sql immutable as $$select null::text$$;
 create function icash_seller_contact_stop(text) returns boolean language sql immutable as $$select false$$;
 create function icash_seller_conversation_human(text) returns boolean language sql immutable as $$select false$$;
 create function icash_seller_dialogue_context(uuid,uuid) returns jsonb language sql stable as $$select '{}'::jsonb$$;
 create function icash_seller_conversion_source(uuid,uuid) returns boolean language sql stable as $$select false$$;
 create function icash_seller_conversion_intent(text) returns text language sql immutable as $$select null::text$$;
 create function icash_seller_memory_interest_reply(uuid,uuid) returns boolean language sql stable as $$select false$$;
 create function icash_seller_recovery_reply_action(uuid,uuid) returns text language sql stable as $$select null::text$$;
 create function icash_seller_recorded_call_finished(uuid,uuid) returns boolean language sql stable as $$select false$$;
 create function icash_recorded_reception_private.clock_now() returns timestamptz language sql volatile as $$select clock_timestamp()$$;
 create function icash_recorded_reception_private.keys(jsonb,text[]) returns boolean language sql immutable as $$select jsonb_typeof($1)='object' and $1-$2='{}'::jsonb$$;
 `);
 for(const signature of ['icash_customer_authored_text(uuid,uuid)','icash_seller_recovery_nonprice_current(uuid,uuid)','icash_seller_information_action(text)','icash_seller_conversation_message_current(uuid,uuid)','icash_seller_limited_contact(uuid,uuid)','icash_limited_seller_text_current(uuid,uuid)','icash_manual_handoff_reply(uuid,uuid)','icash_sms_inbound_campaign_current(uuid)'])await pg.exec(`create function ${signature} returns boolean language sql stable as $$select false$$;`);
 for(const row of lockDependencies){
  await pg.exec(row.source);
  await pg.exec(`revoke all on function public.${row.signature} from public,anon,authenticated,service_role;`);
  if(row.acl.includes('service_role='))await pg.exec(`grant execute on function public.${row.signature} to service_role;`);
 }
 for(const row of [...predecessors].sort((a,b)=>Number(b.name==='icash_signing_action_allowed')-Number(a.name==='icash_signing_action_allowed'))){
  await pg.exec(row.source);
  await pg.exec(`revoke all on function public.${row.signature} from public,anon,authenticated,service_role;`);
  if(row.acl.includes('service_role='))await pg.exec(`grant execute on function public.${row.signature} to service_role;`);
 }
 await pg.exec('create trigger fixture_sms_route before insert or update on public.icash_text_messages for each row execute function public.icash_sms_message_route();');
 await pg.exec(receiptMigration);
 await pg.exec('grant usage on schema public to service_role;grant select,insert,update,delete on all tables in schema public to service_role;');
 const records=(await pg.query("select oid::regprocedure::text signature,md5(pg_get_functiondef(oid)) hash from pg_proc where pronamespace='public'::regnamespace")).rows;
 for(const row of [...predecessors,...lockDependencies])if(row.name!=='icash_seller_memory_context')assert.equal(records.find(r=>r.signature===row.signature)?.hash,row.source_hash,'actual predecessor '+row.signature);
}

export const rpc=(pg,name,args={})=>pg.query(`select to_jsonb(public.${name}(${Object.keys(args).map((_,i)=>'$'+(i+1)).join(',')})) value`,Object.values(args).map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v)).then(r=>r.rows[0].value);
export async function scenario(pg,{phone='+12125550123',enabled=true}={}){
 const user=randomUUID(),account=randomUUID(),screen=randomUUID(),deal=randomUUID(),thread=randomUUID(),call=randomUUID(),template=randomUUID(),conversation='conv_'+call.replaceAll('-',''),hash=call.replaceAll('-','').repeat(2);
 const closing=new Date(Date.now()+14*86400000).toISOString().slice(0,10);
 const terms={address:'45 Oak Road',buyer:'Fixture Buyer',seller:'Jane Seller',state:'TX',priceCents:9000000,closingDate:closing,inspectionDays:10,assignmentFeeCents:1000000};
 const confirmation={sellerLegalName:terms.seller,agreedPriceCents:terms.priceCents,closingDate:closing,soleOwner:true,allDecisionMakersAgree:true,inspectionAccess:'no',priceAndDateConfirmed:true,termsConfirmed:true,sendTextRequested:true,materialFactsChanged:false};
 const snapshot={propertyId:'property-'+screen,raw:{data:{full_address:terms.address}}};
 const offerState={acceptedPriceCents:terms.priceCents,quotedPriceCents:terms.priceCents,contractBlocked:false,acceptanceConditional:false,factsPending:false,conditionPending:false,agreementRevisionRequired:false,payoffPending:false,textThreadId:thread};
 await pg.query("insert into auth.users values($1,'fixture@example.test',now());",[user]);
 await pg.query('insert into icash_accounts(id,owner_user_id) values($1,$2)',[account,user]);
 await pg.query('insert into icash_screening_jobs(id,account_id,snapshot) values($1,$2,$3)',[screen,account,snapshot]);
 await pg.query("insert into icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$3,'draft',$4)",[deal,account,screen,terms]);
 await pg.query("insert into icash_text_threads(id,account_id,deal_id,recipient,party) values($1,$2,$3,$4,'seller')",[thread,account,deal,phone]);
 await pg.query("insert into icash_sms_routes(sender,recipient,account_id) values('+14243948384',$1,$2) on conflict do nothing",[phone,account]);
 await pg.query('insert into icash_customer_identities values($1,$2)',[account,terms.buyer]);
 await pg.query('insert into icash_call_offer_private.offers(account_id,deal_id,snapshot,state) values($1,$2,$3,$4)',[account,deal,snapshot,offerState]);
 await pg.query("insert into icash_live_conversations(id,account_id,screening_id,contact_key,party,state,operation_key,conversation_id,tool_token_hash,tool_expires_at) values($1,$2,$3,encode(sha256(convert_to($4,'UTF8')),'hex'),'seller','waiting','voice:'||($1::uuid)::text,$5,$6,now()+interval '10 minutes')",[call,account,screen,phone,conversation,hash]);
 await pg.query("insert into icash_call_recordings(account_id,operation_key,provider_started_at,screening_id,contact_key,party,conversation_id,stop_token_hash,to_phone,dial_claimed_at) values($1,'voice:'||$2::text,now()-interval '1 minute',$3,encode(sha256(convert_to($4,'UTF8')),'hex'),'seller',$5,$6,$4,now()-interval '1 minute')",[account,call,screen,phone,conversation,hash]);
 await pg.query('insert into icash_signing_templates(id) values($1)',[template]);
 await pg.query('update icash_seller_memory_private.settings set enabled=$1,enabled_at=coalesce(enabled_at,now()-interval \'1 day\')',[enabled]);
 const context=()=>rpc(pg,'icash_seller_memory_context',{p_account:account,p_screening:screen,p_phone:phone});
 const source=await context();
 const args={p_hash:hash,p_conversation:conversation,p_confirmation:confirmation,p_expected_terms:terms,p_terms:terms,p_memory_fingerprint:source?.fingerprint??null,p_call_prefix:{version:'seller-call-prefix-v2',conversationId:conversation,pairCount:1,turnCount:2,fingerprint:'f'.repeat(64)}};
 const claim=(client=pg,overrides={})=>rpc(client,'icash_claim_seller_agreement',{...args,...overrides});
 const begin=(client=pg)=>rpc(client,'icash_begin_signing',{p_user:user,p_account:account,p_deal:deal,p_kind:'purchase',p_template:template,p_hash:'a'.repeat(64),p_recipients:[{id:'seller',name:terms.seller,phone},{id:'buyer',name:terms.buyer,email:'fixture@example.test'}]});
 const incoming=async(client=pg,body='Actually there is a mortgage.')=>rpc(client,'icash_ingest_text_event_before_operational',{p_event:{id:randomUUID(),type:'text.incoming.sms',timestamp:Date.now()/1000,data:{from:phone,to:'+14243948384',body,message_id:randomUUID()}},p_optout:false});
 return {pg,user,account,screen,deal,thread,call,phone,template,conversation,hash,terms,confirmation,snapshot,offerState,args,context,claim,begin,incoming};
}

export async function ownedContract(s,claim,envelope){
 const {pg}=s,message=randomUUID();
 await pg.query("update public.icash_signing_envelopes set state='awaiting_counterparty',provider_id='original-fixture-document' where id=$1",[envelope.id]);
 await pg.query("update icash_seller_agreement_private.confirmations set state='ready',envelope_id=$2 where id=$1",[claim.id,envelope.id]);
 await pg.query("insert into public.icash_text_messages(id,account_id,thread_id,direction,state,body) values($1,$2,$3,'outgoing','ready','Review your contract: https://docuseal.com/s/original-fixture')",[message,s.account,s.thread]);
 await pg.query("insert into public.icash_contract_text_deliveries values($1,$2,'seller',$3,$4)",[s.account,envelope.id,message,s.thread]);
 return message;
}

export async function textScenario(pg,options={}){
 const s=await scenario(pg,options);
 await pg.query('delete from public.icash_call_recordings where account_id=$1',[s.account]);
 await pg.query('delete from public.icash_live_conversations where account_id=$1',[s.account]);
 const question=randomUUID(),incoming=randomUUID(),event=randomUUID(),job=randomUUID();
 await pg.query("insert into public.icash_text_messages(id,account_id,thread_id,direction,state,body,provider_id,created_at,last_delivery_at) values($1,$2,$3,'outgoing','delivered','May we text the agreement for $90,000?', $4,now()-interval '3 seconds',now()-interval '2 seconds')",[question,s.account,s.thread,randomUUID()]);
 await rpc(pg,'icash_ingest_text_event_before_operational',{p_event:{id:event,type:'text.incoming.sms',timestamp:Date.now()/1000,data:{from:s.phone,to:'+14243948384',body:'Yes, send the agreement for 90000.',message_id:incoming}},p_optout:false});
 const message=(await pg.query('select id from public.icash_text_messages where event_id=$1',[event])).rows[0].id;
 await pg.query('insert into public.icash_text_ai_jobs(id,account_id,thread_id,message_id) values($1,$2,$3,$4)',[job,s.account,s.thread,message]);
 const context=await rpc(pg,'icash_seller_text_offer_context',{p_account:s.account,p_message:message});
 assert(context?.memoryFingerprint,'actual text context retains canonical fingerprint');
 await pg.query('update public.icash_text_ai_jobs set analysis=$2 where id=$1',[job,{offerPolicy:'seller-text-offer-v1',offerFingerprint:context.fingerprint,offerState:context.offerState,offerPlan:{kind:'agreement',terms:s.terms,confirmation:s.confirmation}}]);
 return {...s,job,message,textContext:context,textClaim:(client=pg)=>rpc(client,'icash_claim_seller_text_agreement',{p_account:s.account,p_job:job})};
}

export async function inbound(s,{ended=false}={}){
 const id=randomUUID(),config=randomUUID(),token=randomUUID(),conversation='conv_'+id.replaceAll('-','');
 const payload={callSid:'CA'+'1'.repeat(32),providerAccountSid:'AC'+'2'.repeat(32),fromPhone:s.phone,toPhone:'+14243948384',direction:'inbound',status:'completed'};
 await s.pg.query('insert into icash_recorded_reception_private.configs(id) values($1)',[config]);
 await s.pg.query(`insert into icash_recorded_reception_private.sessions(id,account_id,config_id,operation_key,provider_started_at,conversation_id,from_phone,to_phone,provider_account_sid,call_sid,recording_authorized_at,recording_sid,call_deadline_at,register_claimed_at,start_claimed_at,call_ended_at,call_terminal_status,reconcile_lease_token,reconcile_lease_expires_at)
 values($1,$2,$3,'recorded-reception:'||$4,now()-interval '2 minutes',$5,$6,$7,$8,$4,now()-interval '2 minutes','RE' || repeat('3',32),now()+interval '5 minutes',now()-interval '1 minute',now()-interval '1 minute',case when $9 then now()-interval '1 second' end,case when $9 then 'completed' end,$10,now()+interval '5 minutes')`,[id,s.account,config,payload.callSid,conversation,s.phone,payload.toPhone,payload.providerAccountSid,ended,token]);
 await s.pg.query('insert into icash_seller_agreement_private.inbound_bindings values($1,$2,$3,$4)',[id,s.account,s.deal,s.thread]);
 const transcript=[{role:'agent',message:'Is there a mortgage?'},{role:'user',message:'There is a mortgage.'}];
 return {id,conversation,token,payload,transcript,history:(client=s.pg)=>rpc(client,'icash_save_seller_inbound_history',{p_session:id,p_conversation:conversation,p_transcript:transcript}),terminal:(client=s.pg)=>rpc(client,'icash_transition_recorded_reception',{p_id:id,p_account:s.account,p_operation:'recorded-reception:'+payload.callSid,p_expected_version:1,p_action:'call_ended',p_payload:payload}),finish:(client=s.pg)=>rpc(client,'icash_finish_recorded_reception_work',{p_id:id,p_account:s.account,p_operation:'recorded-reception:'+payload.callSid,p_kind:'reconcile',p_lease_token:token,p_expected_version:1,p_outcome:'call_ended',p_payload:payload})};
}

export async function baseline(pg){
 const s=await scenario(pg,{phone:'+12125550101'});
 await s.incoming();
 const old={...s.args};delete old.p_memory_fingerprint;delete old.p_call_prefix;
 const accepted=await rpc(pg,'icash_claim_seller_agreement',old);
 assert(accepted?.claimed,'captured predecessor reproduces stale call consent admitted after new incoming source');
}

export async function cases(pg){
 {
  const s=await scenario(pg,{phone:'+12125550102'}),old={...s.args};delete old.p_memory_fingerprint;delete old.p_call_prefix;
  assert.equal(await rpc(pg,'icash_claim_seller_agreement',old),null,'old worker cannot assert absent memory review');
  assert.equal(await s.claim(pg,{p_memory_fingerprint:'0'.repeat(64)}),null,'wrong snapshot is refused before original claim');
  assert.equal(await s.claim(pg,{p_call_prefix:{...s.args.p_call_prefix,conversationId:'conv_wrong'}}),null);
  const c=await s.claim();assert(c?.claimed);
  const row=(await pg.query('select * from icash_seller_agreement_memory_private.admissions where confirmation_id=$1',[c.id])).rows[0];
  assert.equal(row.original_fingerprint,s.args.p_memory_fingerprint);assert.deepEqual(row.call_prefix,s.args.p_call_prefix);
  assert.equal((await s.claim()).claimed,false,'same original claim is idempotent');
  await s.incoming();
  await assert.rejects(s.begin(),/memory|source|admission/i,'a newer incoming source blocks document creation');
  assert.equal(Number((await pg.query('select count(*) n from icash_signing_envelopes where account_id=$1',[s.account])).rows[0].n),0);
 }
 {
  const s=await scenario(pg,{phone:'+12125550103'}),c=await s.claim(),e=await s.begin();assert(e?.id);
  const message=await ownedContract(s,c,e);
  assert.equal(await rpc(pg,'icash_confirmed_seller_contract_text_current',{p_account:s.account,p_message:message}),true,'exact owned original link must not invalidate itself');
  await s.incoming();
  assert.equal(await rpc(pg,'icash_confirmed_seller_contract_text_current',{p_account:s.account,p_message:message}),false,'new reply blocks final original contract text');
  assert.equal(await rpc(pg,'icash_claim_text_before_owner_question',{p_account:s.account,p_message:message,p_sender:'+14243948384'}),null,'actual final text claim preserves source hold before financial delegate');
  const original=(await pg.query('select state,provider_id from icash_signing_envelopes where id=$1',[e.id])).rows[0];
  assert.deepEqual(original,{state:'awaiting_counterparty',provider_id:'original-fixture-document'},'later source never expires or recreates original provider document');
  assert.equal(Number((await pg.query('select count(*) n from fixture_text_admissions where message_id=$1',[message])).rows[0].n),0);
 }
 {
  const s=await textScenario(pg,{phone:'+12125550104'}),c=await s.textClaim();assert(c?.claimId,'actual text-only claim works');
  const a=(await pg.query('select fingerprint,phone from icash_seller_agreement_memory_private.admissions where confirmation_id=$1',[c.claimId])).rows[0];
  assert.equal(a.fingerprint,s.textContext.memoryFingerprint);assert.equal(a.phone,s.phone);
  assert((await s.begin())?.id,'text-only admission authorizes exactly its original document');
 }
 {
  const s=await scenario(pg,{phone:'+12125550105',enabled:false}),old={...s.args};delete old.p_memory_fingerprint;delete old.p_call_prefix;
  assert((await rpc(pg,'icash_claim_seller_agreement',old))?.claimed,'disabled cohort retains actual original caller');
  assert((await s.begin())?.id);
  await pg.exec('update icash_seller_memory_private.settings set enabled=true');
 }
 {
  const s=await scenario(pg,{phone:'+12125550106'});
  await pg.exec('set role service_role');try{assert((await s.claim())?.claimed);assert((await s.begin())?.id);}finally{await pg.exec('reset role');}
  const t=await textScenario(pg,{phone:'+12125550107'});
  await pg.exec('set role service_role');try{assert((await t.textClaim())?.claimId);assert((await t.begin())?.id);}finally{await pg.exec('reset role');}
  assert.equal((await pg.query("select has_table_privilege('service_role','icash_seller_agreement_memory_private.admissions','update') allowed")).rows[0].allowed,false);
 }
 {
  const manual=await scenario(pg,{phone:'+12125550108'});
  assert((await manual.begin())?.id,'manual purchase without automatic confirmation retains original admission');
  const assignment=await scenario(pg,{phone:'+12125550109'});
  await pg.query("update icash_deal_files set stage='under_contract',seller_signed_at=now() where id=$1",[assignment.deal]);
  await pg.query("update icash_signing_templates set kind='assignment' where id=$1",[assignment.template]);
  assert((await rpc(pg,'icash_begin_signing',{p_user:assignment.user,p_account:assignment.account,p_deal:assignment.deal,p_kind:'assignment',p_template:assignment.template,p_hash:'a'.repeat(64),p_recipients:[{id:'seller',name:assignment.terms.seller,phone:assignment.phone},{id:'buyer',name:assignment.terms.buyer,email:'fixture@example.test'}]}))?.id,'assignment admission remains unchanged');
 }
 {
  const old=await scenario(pg,{phone:'+12125550110'});
  await pg.query("insert into icash_seller_agreement_private.confirmations(call_key,account_id,deal_id,confirmation,terms) values($1,$2,$3,$4,$5)",['outbound:'+old.call,old.account,old.deal,old.confirmation,old.terms]);
  assert.equal(await old.claim(),null,'new code must not attach retrospective proof to an older confirmation');
  assert.equal(Number((await pg.query('select count(*) n from icash_seller_agreement_memory_private.admissions where account_id=$1',[old.account])).rows[0].n),0);
 }
 const action=(await pg.query("select md5(pg_get_functiondef('public.icash_signing_action_allowed(uuid,uuid)'::regprocedure)) hash")).rows[0].hash;
 assert.equal(action,'0c8dd6053164498e0f2e400d8e55d3b7','memory source changes never become cancellation authority');
 for(const role of ['anon','authenticated'])for(const fn of ['icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb,text,jsonb)','icash_defer_seller_agreement(text,text,jsonb,jsonb,jsonb,text,jsonb)'])assert.equal((await pg.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,'public.'+fn])).rows[0].allowed,false);
 await recoveryCases(pg);
 await rawProtocolCases(pg);
}

export async function recoveryCases(pg){
 // This suite proves database source CAS, original identity and admission only.
 // It deliberately uses an opaque prefix hash; the TS suite must independently
 // prove the exact ordered live transcript, consent and neutral suffix.
 let n=400;
 async function deferred({prefix=true}={}){
  const s=await scenario(pg,{phone:'+12125550'+String(++n).padStart(3,'0')});
  const args={...s.args};if(!prefix)delete args.p_call_prefix;
  const queued=await rpc(pg,'icash_defer_seller_agreement',args);assert(queued?.queued);
  const confirmation=(await pg.query('select id from icash_seller_agreement_private.confirmations where account_id=$1',[s.account])).rows[0].id;
  return {...s,recovery:queued.id,confirmationId:confirmation};
 }
 const complete=s=>rpc(pg,'icash_save_live_result',{p_call:s.call,p_result:{party:'seller',summary:'Original completed call',humanRequested:false,optedOut:false,transcript:[{role:'agent',message:'May we text the confirmed agreement?'},{role:'user',message:'Yes.'},{role:'agent',message:'Thank you.'},{role:'user',message:'Goodbye.'}]}});
 const job=()=>rpc(pg,'icash_claim_agreement_delivery_recovery',{});
 const context=s=>rpc(pg,'icash_seller_agreement_memory_context',{p_account:s.account,p_recovery:s.recovery});
 const refresh=(s,c,overrides={})=>rpc(pg,'icash_refresh_seller_agreement_memory',{p_account:s.account,p_confirmation:s.confirmationId,p_expected_fingerprint:c.admission.fingerprint,p_new_fingerprint:c.current?.fingerprint,p_call_prefix:s.args.p_call_prefix,...overrides});
 {
  const s=await deferred();
  await pg.query('update icash_call_recordings set call_ended_at=now() where account_id=$1',[s.account]);
  assert.equal(await job(),null,'known terminal missing original transcript stays queued');
  assert.equal((await pg.query('select state from icash_seller_agreement_private.delivery_recovery where id=$1',[s.recovery])).rows[0].state,'queued');
  await complete(s);const j=await job();assert.equal(j.id,s.recovery);assert.equal(j.memoryReviewRequired,true);
  const c=await context(s);assert.equal(c.confirmationId,s.confirmationId);assert.equal(c.originalCall.conversationId,s.conversation);assert.equal(c.originalCall.sourceId,'call:'+s.call);
  assert.equal(await refresh(s,c,{p_expected_fingerprint:'0'.repeat(64)}),false);
  assert.equal(await refresh(s,c,{p_call_prefix:{...s.args.p_call_prefix,fingerprint:'0'.repeat(64)}}),false);
  assert.equal(await refresh(s,c),true,'exact original completion refreshes the same admission');
  assert.equal(await refresh(s,c),false,'old fingerprint cannot refresh the changed admission twice');
  assert.equal(Number((await pg.query('select count(*) n from icash_seller_agreement_memory_private.reviews where confirmation_id=$1',[s.confirmationId])).rows[0].n),1);
  assert((await s.begin())?.id,'freshly reviewed original admission permits one original document');
 }
 {
  const s=await deferred();await complete(s);assert.equal((await job()).id,s.recovery);const c=await context(s);
  await s.incoming();assert.equal(await refresh(s,c),false,'a later unrelated source changes the immutable manifest');
  assert.equal((await pg.query('select fingerprint from icash_seller_agreement_memory_private.admissions where confirmation_id=$1',[s.confirmationId])).rows[0].fingerprint,c.admission.fingerprint);
 }
 {
  const s=await scenario(pg,{phone:'+12125550490'}),args={...s.args};delete args.p_call_prefix;
  assert.equal(await rpc(pg,'icash_defer_seller_agreement',args),null,'missing original prefix cannot promise automatic deferred delivery');
  assert.equal(Number((await pg.query('select count(*) n from icash_seller_agreement_private.delivery_recovery where account_id=$1',[s.account])).rows[0].n),0);
  const claim=await rpc(pg,'icash_claim_seller_agreement',args);assert(claim?.claimed,'direct current-source claim may still omit future recovery proof');
  await complete(s);
  assert.equal((await pg.query('select icash_seller_agreement_memory_private.review_ready($1) ready',[claim.id])).rows[0].ready,false,'six-argument admission cannot invent a transcript prefix after completion');
 }
 {
  const s=await deferred();await complete(s);assert.equal((await job()).id,s.recovery);const c=await context(s);
  await pg.query("insert into icash_signing_envelopes(account_id,deal_id,kind,state) values($1,$2,'purchase','needs_review')",[s.account,s.deal]);
  assert.equal(await refresh(s,c),false,'an existing uncertain envelope prevents any recovery readmission');
 }
}

export async function rawProtocolCases(pg){
 // Protocol composition only: this synthetic wrapper preserves the actual 7a
 // receipt projection and adds one fictional historical raw voice projection.
 // It does not install or prove the raw capture migration, transcript clocks,
 // provider receipt authenticity, or TS transcript-prefix interpretation.
 const prior=(await pg.query("select md5(pg_get_functiondef('public.icash_seller_memory_context(uuid,uuid,text)'::regprocedure)) hash")).rows[0].hash;
 await pg.exec(`begin;
 create table public.fixture_raw_call_protocol(mode text not null);
 insert into public.fixture_raw_call_protocol values('valid');
 alter function public.icash_seller_memory_context(uuid,uuid,text) rename to icash_seller_memory_fixture_receipt_context;
 create function public.icash_seller_memory_context(p_account uuid,p_screening uuid,p_phone text) returns jsonb
 language plpgsql stable security definer set search_path='' as $fixture$
 declare base jsonb;source jsonb;voice jsonb;sms jsonb;calls jsonb;mode text;
 begin
  base:=public.icash_seller_memory_fixture_receipt_context(p_account,p_screening,p_phone);
  if base is null then return null;end if;
  select f.mode into mode from public.fixture_raw_call_protocol f;
  select c into sms from jsonb_array_elements(base->'conversations') c where c->>'sourceId'='sms';
  voice:=jsonb_build_object('sourceId','call:00000000-0000-0000-0000-000000000001','conversationId','conv_fixture_historical',
   'channel','voice','at','2020-01-02T00:00:02+00:00','startedAt','2020-01-02T00:00:00+00:00',
   'transcript',jsonb_build_array(jsonb_build_object('role','agent','message','Can we discuss the property?','time_in_call_secs',0),
    jsonb_build_object('role','user','message','Yes.','time_in_call_secs',1)),
   'complete',true,'sourceCoverage','verified','rawSha256',repeat('b',64),'rawTurnCount',2);
  if mode='voice_incomplete' then voice:=jsonb_set(voice,'{complete}','false');
  elsif mode='voice_complete_string' then voice:=jsonb_set(voice,'{complete}','"true"');
  elsif mode='voice_bad_transcript' then voice:=jsonb_set(voice,'{transcript}','{}');
  elsif mode='voice_missing_id' then voice:=voice-'sourceId';
  elsif mode='sms_incomplete' then sms:=jsonb_set(sms,'{receiptSourceComplete}','false');
  elsif mode='sms_count_string' then sms:=jsonb_set(sms,'{rawSourceCount}','"0"');
  elsif mode='sms_count_fractional' then sms:=jsonb_set(sms,'{rawSourceCount}','0.5');
  elsif mode='sms_count_overflow' then sms:=jsonb_set(sms,'{rawSourceCount}','1001');end if;
  calls:=jsonb_build_array(voice,sms);
  if mode='voice_count_overflow' then
   select jsonb_agg(jsonb_set(voice,'{sourceId}',to_jsonb('call:fixture-'||n::text)) order by n)||jsonb_build_array(sms) into calls from generate_series(1,101) n;
  elsif mode='duplicate_voice' then calls:=calls||jsonb_build_array(voice);
  elsif mode='duplicate_sms' then calls:=calls||jsonb_build_array(sms);
  elsif mode='missing_sms' then calls:=jsonb_build_array(voice);end if;
  source:=base||jsonb_build_object('conversations',calls,'callSourceVersion','seller-call-source-v1','callSourceComplete',true,
   'callSourceCutover','2020-01-01T00:00:00+00:00','complete',false,'receiptSourceComplete',false,'cached',null);
  if mode='unknown_version' then source:=jsonb_set(source,'{callSourceVersion}','"seller-call-source-v999"');
  elsif mode='top_incomplete' then source:=jsonb_set(source,'{callSourceComplete}','false');
  elsif mode='top_complete_string' then source:=jsonb_set(source,'{callSourceComplete}','"true"');
  elsif mode='missing_cutover' then source:=source-'callSourceCutover';
  elsif mode='invalid_cutover' then source:=jsonb_set(source,'{callSourceCutover}','"not-a-timestamp"');
  elsif mode='impossible_cutover' then source:=jsonb_set(source,'{callSourceCutover}','"2020-02-31T00:00:00+00:00"');
  elsif mode='future_cutover' then source:=jsonb_set(source,'{callSourceCutover}','"9999-01-01T00:00:00+00:00"');end if;
  source:=jsonb_set(source,'{fingerprint}',to_jsonb(encode(sha256(convert_to(jsonb_build_object('conversations',source->'conversations',
   'callSourceVersion',source->'callSourceVersion','callSourceComplete',source->'callSourceComplete','cutover',source->'callSourceCutover')::text,'UTF8')),'hex')));
  if mode='wrong_fingerprint' then source:=jsonb_set(source,'{fingerprint}',to_jsonb(repeat('0',64)));end if;
  return source;
 end $fixture$;
 revoke all on function public.icash_seller_memory_context(uuid,uuid,text) from public,anon,authenticated;
 grant execute on function public.icash_seller_memory_context(uuid,uuid,text) to service_role;`);
 try{
  const s=await scenario(pg,{phone:'+12125550501'}),source=await s.context();
  assert.equal(source.complete,false);assert.equal(source.receiptSourceComplete,false);assert.equal(source.callSourceComplete,true);
  const c=await s.claim();assert(c?.claimed,'exact raw protocol admits the reviewed original even while legacy completeness is false');
  const e=await s.begin();assert(e?.id,'exact raw protocol permits original document creation');
  const message=await ownedContract(s,c,e);
  const owned=(await pg.query('select icash_seller_agreement_memory_private.current_source($1,$2,$3,$4) value',[s.account,s.screen,s.phone,c.id])).rows[0].value;
  assert.equal(owned?.fingerprint,s.args.p_memory_fingerprint,'owned-link removal recomputes the exact raw protocol JSON fingerprint');
  assert.equal(await rpc(pg,'icash_confirmed_seller_contract_text_current',{p_account:s.account,p_message:message}),true);
  assert.equal((await rpc(pg,'icash_claim_text_before_owner_question',{p_account:s.account,p_message:message,p_sender:'+14243948384'}))?.messageId,message,'actual final text guard reaches only the fixture financial sentinel for valid raw context');
  await s.incoming();
  assert.equal(await rpc(pg,'icash_confirmed_seller_contract_text_current',{p_account:s.account,p_message:message}),false,'raw protocol retains later incoming reply hold');
  assert.equal(await rpc(pg,'icash_claim_text_before_owner_question',{p_account:s.account,p_message:message,p_sender:'+14243948384'}),null);
  assert.deepEqual((await pg.query('select state,provider_id from icash_signing_envelopes where id=$1',[e.id])).rows[0],{state:'awaiting_counterparty',provider_id:'original-fixture-document'});
  assert.equal(Number((await pg.query('select count(*) n from fixture_text_admissions where message_id=$1',[message])).rows[0].n),1,'later reply does not reach the fixture financial sentinel again');
  let n=510;
  for(const mode of ['unknown_version','top_incomplete','top_complete_string','voice_incomplete','voice_complete_string','voice_bad_transcript','voice_missing_id','voice_count_overflow','duplicate_voice','duplicate_sms','missing_sms','sms_incomplete','sms_count_string','sms_count_fractional','sms_count_overflow','missing_cutover','invalid_cutover','impossible_cutover','future_cutover','wrong_fingerprint']){
   await pg.query('update public.fixture_raw_call_protocol set mode=$1',[mode]);
   const bad=await scenario(pg,{phone:'+12125550'+String(++n)});
   assert.equal(await bad.claim(),null,'malformed raw protocol holds claim: '+mode);
   assert.equal(Number((await pg.query('select count(*) n from icash_seller_agreement_private.confirmations where account_id=$1',[bad.account])).rows[0].n),0,'malformed raw protocol creates no original confirmation: '+mode);
  }
 }finally{await pg.exec('rollback');}
 assert.equal((await pg.query("select md5(pg_get_functiondef('public.icash_seller_memory_context(uuid,uuid,text)'::regprocedure)) hash")).rows[0].hash,prior,'synthetic raw wrapper never replaces the actual fixture source outside its test transaction');
}
