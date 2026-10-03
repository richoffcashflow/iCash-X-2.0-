import {settleRecordingGateOnly} from '../lib/required-call-recording-billing.ts';
import {settleBoundVoiceUsage} from '../lib/voice-usage-service.ts';
import {costCategories} from '../lib/cost-guard.ts';
import {maintainRecordings} from '../lib/required-call-recording-maintenance.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHmac} from 'node:crypto';
import {recordingService} from '../lib/required-call-recording-service.ts';
import {canonical,sha,recordingPolicy,recordingBaseUrl} from '../lib/required-call-recording.ts';
// LOCAL ONLY. No credentials, provider calls, real database URL or external writes.
// PGlite serializes queries: replay tests do NOT prove real PostgreSQL lock contention.
if (!process.argv[2]) throw Error('Pass local @electric-sql/pglite/dist/index.js');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const pg=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const table=(p,n)=>{const s=read(p),start=s.indexOf('create table public.'+n+' (');assert(start>=0,n);return s.slice(start,s.indexOf(';',start)+1);};
const fn=(p,n)=>{const s=read(p),start=s.indexOf('create function public.'+n+'(');assert(start>=0,n);return s.slice(start,s.indexOf('$$;',start)+3);};
const foundation='supabase/migrations/20260928015041_icash_accounts_deals_credit_foundation.sql';
const costs='supabase/migrations/20260928195902_atomic_operating_costs.sql';
const live='supabase/migrations/20260928235939_live_conversation_handoffs.sql';
const q=(s,a=[])=>pg.query(s,a);
const rpc=async(name,args)=>(await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
const account='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const job='cccccccc-cccc-4ccc-8ccc-cccccccccccc',permission='dddddddd-dddd-4ddd-8ddd-dddddddddddd',screening='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const operation='voice:'+job,ac='AC'+'a'.repeat(32),call='CA'+'b'.repeat(32),rec='RE'+'c'.repeat(32),nonce='d'.repeat(64),stop='e'.repeat(64);
const policy={version:'required-audio-30d-speech-v1',retentionDays:30,recordingMicrosPerMinute:2500,storageMicrosPerMinuteMonth:500,recordingAllowanceMicros:31000,speechGatherMicros:20000,estimate:true};
const context={fromPhone:'+12125550101',branchId:'agtbrch_fixture',versionId:'agtvrsn_fixture',maxTotalSeconds:600,callContext:{principal:'Fixture business',assistantName:'Fixture',firstMessage:'Fixture opening',prompt:'Fixture prior call context',strategyKey:'cash_interest'}};
const createArgs=[account,operation,ac,null,nonce,stop,'speech-disclosure-v1',policy,context];
const create=(args=createArgs)=>rpc('icash_create_call_recording',args);
const get=async()=>(await q('select to_jsonb(r) as r from public.icash_call_recordings r where operation_key=$1',[operation])).rows[0]?.r;
const trans=async(action,payload={},expected)=>{const r=await get();return rpc('icash_transition_call_recording',[r.id,account,operation,expected??r.state,action,payload]);};
const claim=kind=>rpc('icash_claim_call_recording_work',[kind,10,120]);
const finish=(r,kind,outcome,payload={},token)=>rpc('icash_finish_call_recording_work',[r.id,account,operation,kind,token??r[kind==='delete'?'deletion_lease_token':'reconcile_lease_token'],outcome,payload]);
const consentPayload=(utterance='yes',confidence=0.99)=>({nonceHash:nonce,source:'twilio_gather_speech',utterance,confidence,disclosureVersion:'speech-disclosure-v1'});
const provider=(r,extra={})=>({recordingSid:rec,providerStartedAt:r.provider_started_at??new Date().toISOString(),...extra});
let assertions=0,scenarios=0;
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);assertions++;};
const ok=(a,m)=>{assert.ok(a,m);assertions++;};
const denied=async(f,pattern=/permission denied|must be owner/i)=>{await q('savepoint probe');try{await assert.rejects(f,pattern);assertions++;}finally{await q('rollback to savepoint probe');await q('release savepoint probe');}};
async function admin(f){await q('reset role');try{return await f();}finally{await q('set local role service_role');}}
async function fixture(){
 await q("insert into auth.users(id) values($1),($2)",[account,other]);
 await q("insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused) values($1,$1,'Fixture',false),($2,$2,'Other',true)",[account,other]);
 await q('insert into public.icash_wallets(account_id,balance_cents,reserved_cents) values($1,10000,977)',[account]);
 await q("insert into public.icash_screening_jobs(id,account_id) values($1,$2)",[screening,account]);
 await q("insert into public.icash_operation_rates(id,operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) values($1,'seller_call','fixture-recorded',977,'{}','isolated fixture',now()-interval '1 day',now()+interval '1 day',false,600)",[permission]);
 await q("insert into public.icash_credit_reservations(id,account_id,operation_key,amount_cents) values($1,$2,$3,977)",[permission,account,operation]);
 await q("insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until) values($1,$2,$3,$3,977,2000000,'dispatched',now()+interval '1 day')",[operation,account,permission]);
 await q("insert into public.icash_contact_permissions(id,account_id,screening_id,party,phone,contact_key,permission_until,dnc_clear) values($1,$2,$3,'seller','+12125550102',$4,now()+interval '1 day',true)",[permission,account,screening,nonce]);
 await q("insert into public.icash_voice_configs(account_id,agent_id,max_duration_seconds,seller_rate_id) values($1,'agent_fixture',600,$2)",[account,permission]);
 await q("insert into public.icash_voice_jobs(id,account_id,permission_id,state,operation_key) values($1,$2,$3,'dispatching',$4)",[job,account,permission,operation]);
 await q("insert into public.icash_operating_budget(id,enabled,funded_micros,reserved_micros) values(1,false,100000000,2000000)");
}
async function scenario(name,body){await q('begin');try{await fixture();await q('set local role service_role');await body();scenarios++;console.log('PASS '+name);}finally{await q('rollback');}}
async function bound(){await create();await trans('claim_dial');return trans('bind_call',{callSid:call,providerAccountSid:ac,fromPhone:context.fromPhone,toPhone:'+12125550102'});}
async function starting(){await bound();await trans('consent',consentPayload());return trans('claim_start');}
async function expiredFixture(){
 await bound();
 // Fixture administrator backdates a first evidence write; never disables a trigger.
 // App roles cannot mutate rows or caller-select clock timestamps.
 await admin(()=>q("update public.icash_call_recordings set state='starting',consent_at=clock_timestamp()-interval '31 days',consent_evidence='{"+'"method":"speech","source":"fixture"'+"}',start_claimed_at=clock_timestamp()-interval '31 days',row_version=row_version+1 where operation_key=$1",[operation]));
 const r=await get(),started=new Date(Date.parse(r.consent_at)+1000).toISOString();
 return trans('available',{recordingSid:rec,providerStartedAt:started,endedAt:new Date(Date.parse(started)+20000).toISOString(),durationSeconds:20});
}
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create role untrusted_test_role;
  create schema auth;create table auth.users(id uuid primary key);grant usage on schema public to public;
  alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
  alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
 for(const n of ['icash_accounts','icash_wallets','icash_credit_ledger','icash_credit_reservations'])await pg.exec(table(foundation,n));
 for(const n of ['icash_operating_budget','icash_operation_rates','icash_operation_spend'])await pg.exec(table(costs,n));
 await pg.exec(`alter table public.icash_operation_rates add voice_max_duration_seconds integer;
  alter table public.icash_operation_spend add standard_cost_multiplier numeric default 5,add elevenlabs_cost_multiplier numeric default 2,add cost_basis text default 'unreconciled',add customer_price_micros bigint;
  create table public.icash_screening_jobs(id uuid primary key,account_id uuid references public.icash_accounts(id));
  create table public.icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid,party text,phone text,contact_key text,permission_until timestamptz,revoked_at timestamptz,dnc_clear boolean);
  create table public.icash_voice_configs(account_id uuid primary key,agent_id text,enabled boolean default true,reviewed_until timestamptz default (now()+interval '1 day'),max_duration_seconds integer,seller_rate_id uuid,buyer_rate_id uuid);
  create table public.icash_text_suppressions(phone text primary key,reason text);
  create table public.icash_operational_contacts(id uuid primary key);
  create function public.icash_operational_contact_current(uuid,uuid,text,boolean) returns boolean language sql as 'select false';
  create view public.icash_voice_contact_targets as select * from public.icash_contact_permissions;
  create table public.icash_voice_jobs(id uuid primary key,account_id uuid,permission_id uuid,operational_contact_id uuid,state text,outcome text,operation_key text,provider_call_sid text,conversation_id text,updated_at timestamptz);
  create table public.icash_voice_test_sessions(conversation_id text);create table public.icash_voice_test_config(agent_id text);`);
 await pg.exec(table(live,'icash_live_conversations'));
 await pg.exec(fn(live,'icash_validate_live_binding'));
 await pg.exec('create trigger icash_live_binding before insert on public.icash_live_conversations for each row execute function public.icash_validate_live_binding();');
 await pg.exec(fn('supabase/migrations/20260928015153_icash_atomic_credits_and_engine_evidence.sql','icash_finish_credit'));
 await pg.exec(fn(costs,'icash_settle_operation'));
 await pg.exec(table('config/fulfillment-completion.sql','icash_cost_manifests'));
 await pg.exec(fn('config/fulfillment-completion.sql','icash_settle_complete_costs'));
 await pg.exec(read('config/required-call-recording.sql'));
 await pg.exec(read('tests/required-call-recording-database.sql'));
 await scenario('service-only ACL and actual anon/auth/public denials',async()=>{
  for(const role of ['anon','authenticated','untrusted_test_role']){
   await q(`set local role ${role}`);await denied(()=>create());await denied(()=>q('select * from public.icash_call_recordings'));
   await denied(()=>claim('delete'));await denied(()=>q('select * from icash_recording_private.events'));
  }
  await q('set local role service_role');await create();
  for(const sql of ["update public.icash_call_recordings set state='recording'",'delete from public.icash_call_recordings','truncate public.icash_call_recordings','insert into public.icash_call_recordings select * from public.icash_call_recordings'])await denied(()=>q(sql));
  await denied(()=>q('select * from icash_recording_private.events'));
 });
 await scenario('creation derives operation/account/permission/rate; mismatches rejected',async()=>{
  eq(await create([other,...createArgs.slice(1)]),null);
  await admin(()=>q("update public.icash_operation_spend set state='reserved'"));eq(await create(),null);
  await admin(()=>q("update public.icash_operation_spend set state='dispatched',charge_cap_cents=965"));eq(await create(),null);
  await admin(()=>q('update public.icash_operation_spend set charge_cap_cents=977'));
  const r=await create();ok(r);eq(r.to_phone,'+12125550102');eq(r.screening_id,screening);eq(r.party,'seller');eq(r.call_context,context.callContext);eq(r.charge_cap_cents,977);
  eq((await create()).id,r.id);eq(await create([...createArgs.slice(0,4),'a'.repeat(64),...createArgs.slice(5)]),null);
  await denied(()=>create([...createArgs.slice(0,7),{...policy,retentionDays:31},context]),/Invalid recording/);
  await denied(()=>create([...createArgs.slice(0,8),{...context,callContext:{...context.callContext,token:'never'}}]),/Invalid bound call context/);
 });
 await scenario('pre-dial persisted session gives only one dial claim and immutable canonical binding',async()=>{
  await create();const results=await Promise.all([trans('claim_dial'),trans('claim_dial')]);eq(results.filter(Boolean).length,1);
  eq((await trans('dial_unknown')).last_error,'dial_outcome_unknown_no_redial');eq(await trans('claim_dial'),null);
  eq(await trans('bind_call',{callSid:call,providerAccountSid:ac,fromPhone:context.fromPhone,toPhone:'+12125550999'}),null);
  ok(await trans('bind_call',{callSid:call,providerAccountSid:ac,fromPhone:context.fromPhone,toPhone:'+12125550102'}));
  eq(await trans('bind_call',{callSid:'CA'+'f'.repeat(32),providerAccountSid:ac,fromPhone:context.fromPhone,toPhone:'+12125550102'}),null);
 });
 await scenario('strict final affirmative speech parity, confidence and nonce; one consent/start claim',async()=>{
  await bound();
  for(const text of ['okay','no','yes but do not record','i guess','yes no','yes please stop',''])eq(await trans('consent',consentPayload(text)),null,text);
  for(const conf of [0,0.89,1.01])eq(await trans('consent',consentPayload('yes',conf)),null);
  eq(await trans('consent',{...consentPayload(),nonceHash:'a'.repeat(64)}),null);
  eq(await trans('consent',{...consentPayload(),disclosureVersion:'wrong'}),null);
  eq(await trans('consent',{...consentPayload(),source:'model'}),null);
  await denied(()=>trans('consent',{...consentPayload(),transcript:'do not persist'}),/Invalid spoken consent/);
  eq(await trans('claim_start'),null);
  const won=await Promise.all([trans('consent',consentPayload("Yes that's okay!")),trans('consent',consentPayload())]);eq(won.filter(Boolean).length,1);
  const claims=await Promise.all([trans('claim_start'),trans('claim_start')]);eq(claims.filter(Boolean).length,1);eq(claims.find(Boolean).state,'starting');
  eq((await trans('start_unknown')).state,'starting');eq(await trans('claim_start'),null);eq((await get()).recording_sid,null);
 });
 for(const phrase of ['yes','yeah','yep','sure','yes please',"yes that's okay",'yes you can record','yes i agree','i agree','i consent','yes you may record'])await scenario(`affirmative allowlist: ${phrase}`,async()=>{await bound();ok(await trans('consent',consentPayload(phrase)));});
 await scenario('decline/timeout are terminal for consent and cannot record',async()=>{
  await bound();eq((await trans('decline',{reason:'timeout'})).state,'declined');eq(await trans('consent',consentPayload()),null);eq(await trans('claim_start'),null);eq(await trans('started',provider(await get())),null);
 });
 await scenario('consent-gate contact opt-out suppresses destination without recording consent',async()=>{await bound();const r=await trans('contact_opt_out',{nonceHash:nonce,utterance:'Do not call me again'});eq(r.state,'declined');eq(r.consent_at,null);eq((await q('select phone from icash_text_suppressions')).rows[0].phone,'+12125550102');eq(await trans('claim_start'),null);});
 await scenario('provider starts only after consent; retention anchored to provider, cost unknown stays NULL',async()=>{
  await bound();eq(await trans('started',provider(await get())),null);await trans('consent',consentPayload());await trans('claim_start');
  const evidence=provider(await get());const r=await trans('started',evidence);eq(r.state,'recording');eq(Date.parse(r.audio_expires_at)-Date.parse(r.provider_started_at),30*86400000);
  eq(r.provider_recording_price_micros,null);eq(r.price_is_estimate,true);
  eq(await trans('started',{...evidence,recordingSid:'RE'+'f'.repeat(32)}),null);
  eq(await trans('started',{...evidence,providerStartedAt:new Date(Date.parse(evidence.providerStartedAt)+1000).toISOString()}),null);
  eq(await trans('stop',{stopTokenHash:'a'.repeat(64)}),null);eq((await trans('stop',{stopTokenHash:stop})).state,'stopping');
  eq((await trans('started',evidence)).state,'stopping');eq((await trans('processing',evidence)).state,'processing');
  const done=await trans('available',{...evidence,endedAt:evidence.providerStartedAt,durationSeconds:0});eq(done.state,'available');eq(done.provider_recording_price_micros,null);
  eq(await trans('claim_start'),null);eq(await trans('expire'),null);
 });
 await scenario('conversation registration atomically preserves existing owned live/tool/job binding',async()=>{
  await starting();await trans('started',provider(await get()));
  const token='a'.repeat(64),conversationId='conv_fixture';const result=await trans('bind_conversation',{conversationId,toolTokenHash:token});eq(result.conversation_id,conversationId);
  const c=(await q('select * from public.icash_live_conversations where operation_key=$1',[operation])).rows[0];
  eq(c.account_id,account);eq(c.screening_id,screening);eq(c.party,'seller');eq(c.strategy_key,'cash_interest');eq(c.tool_token_hash,token);eq(c.contact_key,nonce);
  eq((await q('select conversation_id,provider_call_sid from public.icash_voice_jobs where id=$1',[job])).rows[0],{conversation_id:conversationId,provider_call_sid:call});
  eq(await trans('bind_conversation',{conversationId:'conv_other',toolTokenHash:token}),null);
 });
 await scenario('missing callback reconciliation is leased and independent of pause/funding/flags',async()=>{
  await starting();await trans('start_unknown');
  await admin(async()=>{await q('update public.icash_wallets set reserved_cents=0,balance_cents=0');await q('update public.icash_accounts set bot_paused=true');await q('update public.icash_voice_configs set enabled=false');});
  const a=await claim('reconcile');eq(a.length,1);eq((await claim('reconcile')).length,0);
  eq(await finish(a[0],'reconcile','retry',{reason:'timeout'},'ffffffff-ffff-4fff-8fff-ffffffffffff'),null);
  const done=await finish(a[0],'reconcile','started',provider(a[0]));eq(done.state,'recording');eq(done.reconcile_lease_token,null);
  eq(await finish(a[0],'reconcile','absent'),null);
 });
 await scenario('late callback cannot reset 30-day expiry; expired audio never becomes available',async()=>{
  const r=await expiredFixture();eq(r.state,'expired');ok(Date.parse(r.audio_expires_at)<Date.now());
  eq(await trans('available',{recordingSid:rec,providerStartedAt:new Date().toISOString(),endedAt:new Date().toISOString(),durationSeconds:0}),null);
  const claimed=await claim('delete');eq(claimed.length,1);eq(claimed[0].state,'deletion_pending');eq((await claim('delete')).length,0);
  eq(await finish(claimed[0],'delete','deleted',{},'ffffffff-ffff-4fff-8fff-ffffffffffff'),null);
  const deleted=await finish(claimed[0],'delete','deleted');eq(deleted.state,'deleted');ok(deleted.deleted_at);eq((await claim('delete')).length,0);
  eq(await trans('available',{recordingSid:rec,providerStartedAt:r.provider_started_at,endedAt:r.ended_at,durationSeconds:20}),null);
 });
 await scenario('failed deletion retries persist; expired lease token cannot acknowledge a new lease',async()=>{
  await expiredFixture();const first=(await claim('delete'))[0];
  await admin(()=>q("update public.icash_call_recordings set deletion_lease_expires_at=clock_timestamp()-interval '1 second',row_version=row_version+1"));
  eq(await finish(first,'delete','deleted'),null);
  const second=(await claim('delete'))[0];ok(second.deletion_lease_token!==first.deletion_lease_token);eq(second.deletion_attempts,2);
  eq(await finish(first,'delete','deleted'),null);
  const retry=await finish(second,'delete','retry',{reason:'provider_timeout'});eq(retry.state,'deletion_pending');eq(retry.deletion_lease_token,null);ok(Date.parse(retry.next_delete_at)>Date.now());
 });
 await scenario('immutable identity/evidence and append-only audit survive privileged mutation probes',async()=>{
  await starting();await trans('started',provider(await get()));
  await admin(async()=>{
   for(const expression of ["account_id='"+other+"'","operation_key='voice:other'","nonce_hash=repeat('f',64)","call_sid='CA"+'f'.repeat(32)+"'","consent_at=null,consent_evidence=null","audio_expires_at=audio_expires_at+interval '1 day'","recording_sid=null"])
    await denied(()=>q('update public.icash_call_recordings set row_version=row_version+1,'+expression),/immutable/);
   await denied(()=>q('delete from public.icash_call_recordings'),/cannot be removed/);
   await denied(()=>q('truncate public.icash_call_recordings cascade'),/cannot be removed/);
   await denied(()=>q("update icash_recording_private.events set action='fake'"),/append only/);
   const events=(await q('select count(*)::int as n from icash_recording_private.events')).rows[0].n;eq(events,Number((await get()).row_version));
  });
 });
 await scenario('terminal carrier-only settlement uses real atomic credit/ledger, no invented AI receipt, exact replay',async()=>{
  await bound();await trans('decline',{reason:'declined'});
  const r=await get(),receipt={providerAccountSid:ac,callSid:call,fromPhone:context.fromPhone,toPhone:'+12125550102',status:'completed',durationSeconds:12,priceMicros:14000,currency:'USD',speechGatherUsed:true};
  const cats=['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'];
  const parts=Object.fromEntries(cats.map(c=>[c,{amountMicros:c==='twilio'?14000:c==='other'?20000:0,basis:['elevenlabs','llm'].includes(c)?'not_applicable':c==='other'?'estimated':'verified',evidenceRef:'isolated fixture '+c}]));
  parts.other.subitems={speechGatherMicros:20000,recordingMicros:0,storageMicros:0};
  const settle=(rc=receipt,pc=parts)=>rpc('icash_settle_unstarted_recorded_call',[r.id,account,operation,rc,pc,'isolated canonical carrier receipt']);
  await denied(()=>settle({...receipt,callSid:'CA'+'f'.repeat(32)}),/Bound terminal/);
  await denied(()=>settle(receipt,{...parts,elevenlabs:{...parts.elevenlabs,basis:'verified'}}),/not applicable/);
  eq((await settle()).chargedCents,17);eq((await settle()).chargedCents,17);
  eq((await q('select balance_cents,reserved_cents from public.icash_wallets where account_id=$1',[account])).rows[0],{balance_cents:9983,reserved_cents:0});
  eq((await q('select count(*)::int as n from public.icash_credit_ledger')).rows[0].n,1);
  await denied(()=>settle({...receipt,durationSeconds:13}),/receipt conflict/);
 });
 await scenario('INDEPENDENT delayed terminal carrier price settles bound call after2 hours exactly once',async()=>{
  await bound();await trans('decline',{reason:'declined'});const row=await get();await admin(()=>q('update public.icash_operation_rates set costs_micros=$1 where id=$2',[Object.fromEntries(costCategories.map(k=>[k,0])),row.rate_id]));
  const database=async(path,method,b)=>{if(path.startsWith('rpc/'))return rpc(path.slice(4),Object.values(b));if(path.startsWith('icash_operation_rates?'))return (await q('select costs_micros from public.icash_operation_rates where id=$1',[row.rate_id])).rows;throw Error(path);};
  const carrier={getCall:async()=>({sid:call,account_sid:ac,from:row.from_phone,to:row.to_phone,direction:'outbound-api',date_created:new Date(Date.now()-2*3600000).toISOString(),status:'completed',duration:'12',price:'-0.014000',price_unit:'USD'})};
  const result=await settleRecordingGateOnly(database,carrier,row);eq(result.settled,true);eq(result.chargedCents,17);eq((await q('select reserved_cents from public.icash_wallets where account_id=$1',[account])).rows[0].reserved_cents,0);eq((await settleRecordingGateOnly(database,carrier,row)).chargedCents,17);eq((await q('select count(*)::int n from public.icash_credit_ledger where event_key=$1',['usage:'+operation])).rows[0].n,1);
 });
 await scenario('INDEPENDENT immutable recorded rate rejects legacy and zero-addon collector policies',async()=>{
  await starting();await trans('started',provider(await get()));await trans('bind_conversation',{conversationId:'conv_policyguard',toolTokenHash:'a'.repeat(64)});const row=await get();await admin(async()=>{await q("update public.icash_operation_rates set version='required-audio-30d-speech-v1:reviewer' where id=$1",[row.rate_id]);await q("update public.icash_live_conversations set state='complete',completed_at=clock_timestamp(),result='{\"durationSeconds\":0}' where operation_key=$1",[operation]);});const live=(await q('select * from public.icash_live_conversations where operation_key=$1',[operation])).rows[0];let ledgerAttempts=0;
  const database=async(path,method,b)=>{if(path.startsWith('icash_live_conversations?'))return (await q('select to_jsonb(c) r from public.icash_live_conversations c where id=$1 and account_id=$2',[live.id,account])).rows.map(x=>x.r);if(path.startsWith('icash_operation_spend?'))return (await q('select rate_id,state from public.icash_operation_spend where operation_key=$1 and account_id=$2',[operation,account])).rows;if(path.startsWith('icash_operation_rates?'))return (await q('select operation,version from public.icash_operation_rates where id=$1',[row.rate_id])).rows;if(path.startsWith('rpc/'))ledgerAttempts++;throw Error(path);};
  const base={enabled:true,rateId:row.rate_id,operation:'seller_call',components:{other:{kind:'fixed_estimate',amountMicros:0,evidenceRef:'Synthetic legacy zero audio addon'}}};for(const version of ['legacy-usd-policy-v1','required-audio-30d-speech-v1:reviewer'])eq((await settleBoundVoiceUsage(database,account,live.id,[{...base,version}])).reason,'recording_cost_policy_required');eq(ledgerAttempts,0);eq((await q('select state from public.icash_operation_spend where operation_key=$1',[operation])).rows[0].state,'dispatched');eq((await q('select reserved_cents from public.icash_wallets where account_id=$1',[account])).rows[0].reserved_cents,977);
 });
 await scenario('actual HTTP consent service against exact SQL state transitions',async()=>{
  const time=Date.now(),when=new Date(time).toISOString();let network=[];
  const config={agent_id:'agent_fixture',branch_id:'agtbrch_fixture',version_id:'agtvrsn_fixture',main_branch_id:'agtbrch_main',conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},agent:{prompt:{tool_ids:['tool_one','tool_two','tool_stop']}}},platform_settings:{privacy:{record_voice:false},auth:{enable_auth:true},call_limits:{bursting_enabled:false},queueing_config:{enabled:false},overrides:{conversation_config_override:{conversation:{max_duration_seconds:true},agent:{first_message:true,prompt:{prompt:true}},tts:{voice_id:true}}}}};
  const review={enabled:true,reviewedAt:new Date(time-1000).toISOString(),reviewedUntil:new Date(time+3600000).toISOString(),agentId:config.agent_id,branchId:config.branch_id,versionId:config.version_id,configHash:sha(JSON.stringify(canonical({conversation_config:config.conversation_config,platform_settings:config.platform_settings,workflow:null,procedures:null}))),fromPhone:context.fromPhone,providerAccountSid:ac,stopToolId:'tool_stop',toolIds:['tool_one','tool_two','tool_stop'],approvedHoldCents:977,retentionDays:30,maxTotalSeconds:600,policyVersion:recordingPolicy.version};
  const env={ICASH_RECORDED_OUTBOUND_READY:'true',RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review),TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'synthetic-recording-fixture-only',ELEVENLABS_API_KEY:'synthetic-key'};
  const tool={id:'tool_stop',tool_config:{type:'webhook',name:'icash_stop_recording',api_schema:{url:recordingBaseUrl+'/stop',method:'POST',request_headers:{Authorization:{variable_name:'secret__icash_recording_stop_token'}},request_body_schema:{type:'object',required:['recordingId'],properties:{recordingId:{type:'string',dynamic_variable:'icash_recording_id'}}}}}};
  const database=async(path,method,b)=>{if(path.startsWith('rpc/'))return rpc(path.slice(4),Object.values(b));if(path.startsWith('icash_call_recordings?'))return [(await get())];throw Error(path);};
  const provider={agent:async()=>config,tool:async()=>tool,dial:async(from,to,twiml)=>{network.push({action:'dial',twiml});return {sid:call,account_sid:ac,from,to,direction:'outbound-api',date_created:when};},getCall:async()=>({sid:call,account_sid:ac,from:context.fromPhone,to:'+12125550102',direction:'outbound-api',date_created:when,start_time:when,status:'in-progress'}),start:async()=>{network.push({action:'start'});return {sid:rec,account_sid:ac,call_sid:call,status:'in-progress',start_time:new Date().toISOString()};},register:async(r,seconds)=>{network.push({action:'register'});ok(r.consent_at&&r.recording_sid);ok(seconds<=600);return '<Response><Connect><Stream url="wss://fixture.invalid"/></Connect></Response>';},end:async()=>{network.push({action:'end'});return {sid:call,account_sid:ac,status:'completed'};}};
  const service=recordingService(env,{db:database,provider});
  eq((await service.dispatch({accountId:account,operationKey:operation,principal:'Fixture',assistantName:'Alex',firstMessage:'Fixture opening',prompt:'Fixture prompt',strategyKey:'cash_interest'})).status,'recording_consent_pending');
  const action=network[0].twiml.match(/action="([^"]+)"/)[1].replaceAll('&amp;','&');
  const body=new URLSearchParams({AccountSid:ac,CallSid:call,SpeechResult:'Yes!',Confidence:'0.99'});
  const signature=createHmac('sha1',env.TWILIO_AUTH_TOKEN).update(action+[...body.keys()].sort().map(k=>k+body.get(k)).join('')).digest('base64');
  const request=()=>new Request(action,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':signature},body:body.toString()});
  const signedRequest=(url,entries,signatureOverride)=>{const body=new URLSearchParams(entries),sig=createHmac('sha1',env.TWILIO_AUTH_TOKEN).update(url+[...body.keys()].sort().map(k=>k+body.get(k)).join('')).digest('base64');return new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':signatureOverride??sig},body:body.toString()});};
  for(const bad of [
   {name:'bad signature',entries:{AccountSid:ac,CallSid:call,SpeechResult:'yes',Confidence:'.99'},sig:'x'},
   {name:'wrong account',entries:{AccountSid:'AC'+'f'.repeat(32),CallSid:call,SpeechResult:'yes',Confidence:'.99'}},
   {name:'wrong nonce',url:action.replace(/nonce=[a-f0-9]+/,'nonce='+'f'.repeat(64)),entries:{AccountSid:ac,CallSid:call,SpeechResult:'yes',Confidence:'.99'}},
   {name:'missing confidence',state:'failed',entries:{AccountSid:ac,CallSid:call,SpeechResult:'yes'}},
   {name:'unstable speech',state:'failed',entries:{AccountSid:ac,CallSid:call,SpeechResult:'yes',Confidence:'.99',UnstableSpeechResult:'yes'}},
   {name:'ambiguous phrase',state:'declined',entries:{AccountSid:ac,CallSid:call,SpeechResult:'yes but do not record',Confidence:'.99'}},
   {name:'silence',state:'declined',entries:{AccountSid:ac,CallSid:call}},
   {name:'recording refusal',state:'declined',entries:{AccountSid:ac,CallSid:call,SpeechResult:'no thanks',Confidence:'.99'}},
   {name:'contact opt out',state:'declined',optOut:true,entries:{AccountSid:ac,CallSid:call,SpeechResult:'do not call me again',Confidence:'.99'}},
  ]){await q('savepoint reviewer_callback');const n=network.length;const response=await service.consent(signedRequest(bad.url??action,bad.entries,bad.sig));ok(!(await response.text()).includes('<Connect>'),bad.name);const r=await get();eq(r.consent_at,null,bad.name);eq(r.start_claimed_at,null,bad.name);eq(r.recording_sid,null,bad.name);eq(r.state,bad.state??'consent_pending',bad.name);eq(network.slice(n).filter(x=>x.action==='start'||x.action==='register').length,0,bad.name);eq((await q('select count(*)::int n from public.icash_text_suppressions')).rows[0].n,bad.optOut?1:0,bad.name);await q('rollback to savepoint reviewer_callback');await q('release savepoint reviewer_callback');network=network.slice(0,n);console.log('PASS INDEPENDENT SQL HTTP NEGATIVE '+bad.name);}
  await q('savepoint reviewer_start_race');const beforeRace=network.length,normalStart=provider.start;provider.start=async()=>{const receipt=await normalStart();provider.getRecording=async()=>receipt;const r=await get();const callback=await service.status(signedRequest(recordingBaseUrl+'/status?id='+r.id,{AccountSid:ac,CallSid:call,RecordingSid:rec,RecordingStatus:'in-progress'}));eq(callback.status,204);return receipt;};const raced=await service.consent(request());ok((await raced.text()).includes('<Connect>'),'Early signed in-progress callback cannot abort matching start');eq(network.slice(beforeRace).map(x=>x.action),['start','register']);eq((await get()).state,'recording');provider.start=normalStart;await q('rollback to savepoint reviewer_start_race');await q('release savepoint reviewer_start_race');network=network.slice(0,beforeRace);console.log('PASS INDEPENDENT SQL signed status wins started-CAS race; one recording and one registration');
  const response=await service.consent(request());ok((await response.text()).includes('<Connect>'));eq((await get()).state,'recording');eq(network.map(x=>x.action),['dial','start','register']);
  const withdrawalToken=createHmac('sha256',env.TWILIO_AUTH_TOKEN).update('icash-recording-stop-v1:'+operation).digest('hex');
  const endProvider=provider.end;
  for(const failStop of [false,true]){await q('savepoint reviewer_withdrawal');const current=await get(),before=network.length;provider.stop=async()=>{network.push({action:'stop'});if(failStop)throw Error('Synthetic stop outage');return {sid:rec,account_sid:ac,call_sid:call,status:'stopped'};};const stopped=await service.stop(new Request(recordingBaseUrl+'/stop',{method:'POST',headers:{authorization:'Bearer '+withdrawalToken},body:JSON.stringify({recordingId:current.id})}));eq(stopped.status,200);const outcome=await stopped.json();eq(outcome.callEnded,true);eq((await get()).state,'processing');eq(network.slice(before).map(x=>x.action),['end']);eq(network.filter(x=>x.action==='register').length,1);eq(await trans('claim_start'),null);await q('rollback to savepoint reviewer_withdrawal');await q('release savepoint reviewer_withdrawal');network=network.slice(0,before);console.log('PASS INDEPENDENT SQL WITHDRAWAL '+(failStop?'end success bypasses unnecessary stop':'whole-call end stops audio and conversation'));}
  for(const failStop of [false,true]){await q('savepoint reviewer_end_failure');const current=await get(),before=network.length;provider.end=async()=>{network.push({action:'end-failed'});throw Error('Synthetic termination outage');};provider.stop=async()=>{network.push({action:'stop'});if(failStop)throw Error('Synthetic recording-stop outage');return {sid:rec,account_sid:ac,call_sid:call,status:'stopped'};};const result=await service.stop(new Request(recordingBaseUrl+'/stop',{method:'POST',headers:{authorization:withdrawalToken},body:JSON.stringify({recordingId:current.id})}));eq(result.status,503);eq((await result.json()).callEnded,false);const waiting=await get();eq(waiting.state,'stopping');ok(waiting.end_requested_at);eq(waiting.call_ended_at,null);ok(waiting.next_reconcile_at);provider.end=endProvider;provider.getRecording=async()=>{const r=await get();return {sid:rec,account_sid:ac,call_sid:call,status:'completed',start_time:r.provider_started_at,duration:'0',price:'-0.002500',price_unit:'USD'};};const recovered=await maintainRecordings(database,provider,{...env,ICASH_RECORDED_OUTBOUND_READY:'false'});eq(recovered.reconciled,1);const after=await get();ok(after.call_ended_at);eq(after.state,'available');ok(after.next_reconcile_at,'Unbound conversation discovery must remain scheduled');eq(network.filter(x=>x.action==='start').length,1);eq(network.filter(x=>x.action==='register').length,1);await q('rollback to savepoint reviewer_end_failure');await q('release savepoint reviewer_end_failure');network=network.slice(0,before);console.log('PASS INDEPENDENT SQL END FAILURE '+(failStop?'both provider failures':'recording stopped but end unconfirmed')+' → durable off-flag termination recovery');}
  await q('savepoint reviewer_absent_end');const absentRow=await get(),beforeAbsent=network.length;provider.getRecording=async()=>({sid:rec,account_sid:ac,call_sid:call,status:'absent'});provider.end=async()=>{network.push({action:'end-failed'});throw Error('Synthetic end outage on absent audio');};
  eq((await service.status(signedRequest(recordingBaseUrl+'/status?id='+absentRow.id,{AccountSid:ac,CallSid:call,RecordingSid:rec,RecordingStatus:'absent'}))).status,503);const absentWaiting=await get();eq(absentWaiting.state,'absent');ok(absentWaiting.end_requested_at);eq(absentWaiting.call_ended_at,null);ok(absentWaiting.next_reconcile_at);
  provider.end=endProvider;provider.conversations=async()=>({has_more:false,conversations:[]});await maintainRecordings(database,provider,{...env,ICASH_RECORDED_OUTBOUND_READY:'false'});const absentRecovered=await get();ok(absentRecovered.call_ended_at);ok(absentRecovered.next_reconcile_at,'Missing conversation stays reviewable after end recovery');eq(network.filter(x=>x.action==='register').length,1);await q('rollback to savepoint reviewer_absent_end');await q('release savepoint reviewer_absent_end');network=network.slice(0,beforeAbsent);console.log('PASS signed absent-audio callback plus failed END → durable independent off-flag call termination');
  await q('savepoint reviewer_no_tools');const beforeCompletion=network.length;provider.getRecording=async()=>{const r=await get();return {sid:rec,account_sid:ac,call_sid:call,status:'completed',start_time:r.provider_started_at,duration:'0',price:'-0.002500',price_unit:'USD'};};const unbound=await get();eq((await service.status(signedRequest(recordingBaseUrl+'/status?id='+unbound.id,{AccountSid:ac,CallSid:call,RecordingSid:rec,RecordingStatus:'completed'}))).status,204);const completedUnbound=await get();eq(completedUnbound.state,'available');eq(completedUnbound.conversation_id,null);ok(completedUnbound.next_reconcile_at,'Completed no-tool calls must retain conversation discovery');await admin(()=>pg.exec("create or replace function icash_recording_private.clock_now() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()+interval '70 seconds'$$;"));provider.conversations=async()=>({has_more:false,conversations:[]});const delayed=await maintainRecordings(database,provider,{...env,ICASH_RECORDED_OUTBOUND_READY:'false'});eq(delayed.held,1);ok((await get()).next_reconcile_at);await admin(()=>pg.exec("create or replace function icash_recording_private.clock_now() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()+interval '140 seconds'$$;"));provider.conversations=async()=>({has_more:false,conversations:[{conversation_id:'conv_notools'}]});provider.conversation=async()=>({conversation_id:'conv_notools',agent_id:unbound.agent_id,branch_id:unbound.branch_id,version_id:unbound.version_id,user_id:'icash-recorded:'+unbound.id,conversation_initiation_client_data:{user_id:'icash-recorded:'+unbound.id},metadata:{phone_call:{call_sid:call,direction:'outbound',external_number:unbound.to_phone,agent_number:unbound.from_phone}}});await maintainRecordings(database,provider,{...env,ICASH_RECORDED_OUTBOUND_READY:'false'});eq((await get()).conversation_id,'conv_notools');eq((await q('select count(*)::int n from public.icash_live_conversations where operation_key=$1',[operation])).rows[0].n,1);await q('rollback to savepoint reviewer_no_tools');await q('release savepoint reviewer_no_tools');network=network.slice(0,beforeCompletion);console.log('PASS INDEPENDENT SQL completed no-tools call survives empty provider metadata then binds canonical conversation with capture OFF');
  await service.consent(request());eq(network.filter(x=>x.action==='start').length,1);ok(network.some(x=>x.action==='end'));
 });
 console.log(`Required recording SQL: ${scenarios} local scenarios and ${assertions} assertions passed.`);
 console.log('Not verified: real PostgreSQL multi-session locks, provider signatures/recording/deletion, production installation or activation.');
}finally{await pg.close();}
