import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
// LOCAL ONLY. Real source-extracted wallet and operation primitives; no network,
// credentials, production queries, deployment, credits injected into live data,
// or provider calls. PGlite serializes sessions: independent PostgreSQL lock
// contention remains a required staging check, not a claimed result here.
if (!process.argv[2]) throw new Error('Pass local @electric-sql/pglite/dist/index.js');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const table=(p,n)=>{const s=read(p),m=new RegExp('create table public\\.'+n+'\\s*\\(','i').exec(s);assert(m,n);return s.slice(m.index,s.indexOf(';',m.index)+1);};
const fn=(p,n)=>{const s=read(p),m=new RegExp('create(?: or replace)? function public\\.'+n+'\\s*\\(','i').exec(s);assert(m,n);const begin=s.indexOf('AS $function$',m.index);const dollar=s.indexOf('$$',m.index);const delim=begin>=0 && (dollar<0||begin<dollar)?'$function$':'$$';const start=s.indexOf(delim,m.index),end=s.indexOf(delim,start+delim.length);return s.slice(m.index,s.indexOf(';',end)+1);};
const foundation='supabase/migrations/20260928015041_icash_accounts_deals_credit_foundation.sql';
const credit='supabase/migrations/20260928015153_icash_atomic_credits_and_engine_evidence.sql';
const costs='supabase/migrations/20260928195902_atomic_operating_costs.sql';
const account='48dfb798-8c1a-404f-88c0-c396cc067062', owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';
const normalRate='e827a7c9-8648-4999-885c-f136fd07100e';
const rate='f93ace00-83fc-4d09-a37c-6d9d9f0a38f0', otherRate='f93ace00-83fc-4d09-a37c-6d9d9f0a38f1';
const hash='a'.repeat(64),caller='b'.repeat(64),agent='agent_receptionFixture',branch='agtbrch_receptionFixture',version='agtvrsn_receptionFixture';
const sid=n=>'CA'+n.toString(16).padStart(32,'0'),nonce=n=>n.toString(16).padStart(64,'0');
const q=async(sql,args=[])=>{try{return await db.query(sql,args);}catch(e){if(!['42501','P0001','25P02','23514'].includes(e.code))console.error('SQL ERROR',e.message,sql);throw e;}};
const value=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
const reserve=(n=1,over={})=>value('select public.icash_reserve_general_reception($1,$2,$3,$4,$5,$6)',[over.call??sid(n),over.to??'+17816093521',over.caller??caller,over.nonce??nonce(n),over.hash??hash,over.version??version]);
const finish=(n=1,over={})=>value('select public.icash_finish_general_reception($1,$2,$3,$4,$5,$6,$7,$8)',[over.call??sid(n),over.nonce??nonce(n),over.agent??agent,over.version??version,over.branch??branch,over.conv??`conv_test${n}`,over.state??'completed',JSON.stringify(over.statements??[])]);
let assertions=0,scenarios=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);assertions++;};
const ok=(a,message)=>{assert.ok(a,message);assertions++;};
async function admin(f){await q('reset role');const result=await f();await q('set local role service_role');return result;}
async function denies(f,re=/permission denied|must be owner/i){await q('savepoint deny');try{await assert.rejects(f,re);assertions++;}finally{await q('rollback to savepoint deny');await q('release savepoint deny');}}
async function scenario(name,f){await q('begin');try{await q('set local role service_role');await f();scenarios++;console.log('PASS '+name);}finally{await q('rollback');}}
async function prepare(extra='',profile='owner_quick_test'){
 await admin(()=>q(`update icash_reception_private.config set config_hash=$1,agent_id=$2,branch_id=$3,reviewed_version_id=$4,
 call_profile=$5,rate_id=$6,max_duration_seconds=$7,customer_charge_cap_cents=$8,
 owner_quick_test_enabled=$9,owner_quick_test_approval_reference=$10,owner_caller_hash=$11,
 approved_at=clock_timestamp()-interval '1 hour',reviewed_until=clock_timestamp()+interval '1 day',approval_reference='LOCAL SYNTHETIC PROVIDER REVIEW',
 allow_inbound_while_paused=true,inbound_pause_approval_reference='LOCAL SYNTHETIC INBOUND-ONLY APPROVAL',enabled=true ${extra}`,[hash,agent,branch,version,profile,profile==='normal'?normalRate:rate,profile==='normal'?600:60,profile==='normal'?430:65,profile==='owner_quick_test',profile==='owner_quick_test'?'EXPLICIT LOCAL OWNER-ONLY QUICK TEST':null,profile==='owner_quick_test'?caller:null]));
}
const snapshot=()=>admin(async()=>({wallet:await value('select to_jsonb(w) from icash_wallets w where account_id=$1',[account]),
 budget:await value('select to_jsonb(b) from icash_operating_budget b'),receipts:Number(await value('select count(*) from icash_reception_private.receipts')),
 ops:Number(await value('select count(*) from icash_operation_spend')),credits:Number(await value('select count(*) from icash_credit_reservations')),
 ledger:Number(await value('select count(*) from icash_credit_ledger'))}));
const zeroMutation=async f=>{const before=await snapshot();await f();eq(await snapshot(),before);};
try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create role outsider nologin;create schema auth;create table auth.users(id uuid primary key);
 grant usage on schema public to public;`);
 for(const n of ['icash_accounts','icash_wallets','icash_credit_ledger','icash_credit_reservations'])await db.exec(table(foundation,n));
 for(const n of ['icash_operating_budget','icash_operation_rates','icash_operation_spend','icash_cost_observations'])await db.exec(table(costs,n));
 for(const n of ['icash_post_credit','icash_reserve_credit','icash_finish_credit'])await db.exec(fn(credit,n));
 for(const n of ['icash_reserve_operation','icash_claim_operation','icash_settle_operation','icash_record_cost_observation'])await db.exec(fn(costs,n));
 await db.exec(table('config/fulfillment-completion.sql','icash_cost_manifests'));
 await db.exec(fn('config/fulfillment-completion.sql','icash_settle_complete_costs'));
 // Unrelated domain table shapes only; no fake reserve, claim, wallet or margin implementation.
 await db.exec(`alter table icash_operation_rates add column voice_max_duration_seconds integer;
 create table icash_text_messages(id uuid,account_id uuid,direction text,asset_ids uuid[]);
 create table icash_communication_prices(operation text,customer_micros bigint);
 create table icash_funding_orders(account_id uuid,mode text,state text,credited_at timestamptz);
 create table icash_voice_jobs(account_id uuid,callback_id uuid,state text);
 create table icash_deal_files(account_id uuid,stage text);`);
 await db.exec(read('config/communication-fractional-billing.sql'));
 const margins=read('config/customer-funded-margins.sql');
 await db.exec(margins.slice(0,margins.indexOf('CREATE OR REPLACE FUNCTION public.icash_reserve_before_fractional')));
 await db.exec(fn('config/customer-funded-margins.sql','icash_reserve_before_fractional'));
 await db.exec(fn('config/customer-funded-margins.sql','icash_claim_operation'));
 await db.exec(fn('config/customer-funded-margins.sql','icash_account_margin_ok'));
 await db.exec(read('config/scoped-spend-activation.sql'));
 // Production current entrypoint is activation -> fractional -> customer-funded
 // reserve. Do not load a newer inventory wrapper not present in current RPC.
 await q('insert into auth.users values($1)',[owner]);
 await q("insert into icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values($1,$2,'local fixture',true,300)",[account,owner]);
 await q('insert into icash_wallets(account_id,balance_cents) values($1,85)',[account]);
 await q("insert into icash_operating_budget(id,enabled,require_company_reserve) values(1,true,false)");
 await q('insert into icash_spend_activations(account_id,enabled,customer_cap_cents) values($1,true,300)',[account]);
 await q("insert into icash_funding_orders values($1,'live','paid',now())",[account]);
 const cats=['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'];
 const amounts=Object.fromEntries(cats.map(x=>[x,x==='elevenlabs'?91200:x==='twilio'?12900:x==='support_and_overhead'?1000:0]));
 for(const [id,operation] of [[rate,'incoming_call'],[otherRate,'other']])await q(`insert into icash_operation_rates(id,operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds)
 values($1::uuid,$2,$1::text,65,$3,'SYNTHETIC LOCAL PLANNING ONLY',now()-interval '1 day',now()+interval '2 days',true,60)`,[id,operation,JSON.stringify(amounts)]);
 const normalAmounts={...amounts,elevenlabs:912000,twilio:129000};
 await q(`insert into icash_operation_rates(id,operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds)
 values($1,'incoming_call','normal-local',430,$2,'SYNTHETIC NORMAL PLANNING ONLY',now()-interval '1 day',now()+interval '2 days',true,600)`,[normalRate,JSON.stringify(normalAmounts)]);
 await db.exec(`grant select,insert,update,delete on all tables in schema public to service_role;
 revoke all on all functions in schema public from public,anon,authenticated;grant execute on all functions in schema public to service_role;`);
 await db.exec(read('config/general-reception.sql'));
 // Installed-path upgrade fixture: old setup existed before either profile.
 // Synthetic private-table fixtures are local only and model an uncertain
 // routing write whose original settings MUST survive every schema upgrade.
 await db.exec(read('tests/fixtures/reception-setup-preprofiles.sql'));
 const preservedPhone={phone_number:'+17816093521',sid:'PN'+'9'.repeat(32),account_sid:'AC'+'8'.repeat(32),
  voice_url:'https://previous.example/inbound',voice_method:'POST',voice_fallback_url:'https://previous.example/fallback',voice_fallback_method:'POST',
  sms_url:'https://previous.example/sms',status_callback:'https://previous.example/status'};
 await q(`insert into icash_reception_private.setup_attempts(action,nonce,fingerprint,original_phone)
 values('route',$1,$2,$3)`,['f'.repeat(32),'e'.repeat(64),JSON.stringify(preservedPhone)]);
 const preservedAttempt=await value("select to_jsonb(a) from icash_reception_private.setup_attempts a where action='route'");
 const originalCredit=await value("select pg_get_functiondef('public.icash_reserve_credit(uuid,text,bigint)'::regprocedure)");
 const originalClaim=await value("select pg_get_functiondef('public.icash_claim_before_activation(text)'::regprocedure)");
 await db.exec(read('config/general-reception-customer-funding.sql'));
 await db.exec('alter table public.icash_operation_spend add column cost_basis text');
 await db.exec(fn('config/account-margin.sql','icash_settle_operation'));
 await db.exec(read('config/general-reception-settlement.sql'));
 const op=n=>'reception:'+sid(n);
 const attestation=(r,over={})=>({schemaVersion:1,binding:{receiptId:r.receipt_id,operationKey:r.operation_key,accountId:r.account_id,
  callSid:r.call_sid,receiptNonce:r.receipt_nonce,configHash:r.config_hash,agentId:r.agent_id,branchId:r.branch_id,versionId:r.reviewed_version_id,
  conversationId:r.conversation_id,callProfile:r.call_profile,rateId:r.rate_id,maxDurationSeconds:r.max_duration_seconds,customerChargeCapCents:r.customer_charge_cap_cents},
  durationSeconds:30,providers:{twilio:{currency:'USD',amountMicros:8500,receiptHash:'c'.repeat(64)},elevenlabs:{currency:'USD',amountMicros:29000,receiptHash:'d'.repeat(64)}},...over});
 const manifest=(a,estimated=false)=>Object.fromEntries(cats.map(cat=>[cat,{amountMicros:cat==='twilio'?a.providers.twilio.amountMicros:cat==='elevenlabs'?a.providers.elevenlabs.amountMicros:cat==='support_and_overhead'?1000:0,evidenceRef:'SYNTHETIC LOCAL VERIFIED OR N/A '+cat,basis:estimated&&cat==='support_and_overhead'?'estimated':'verified'}]));
 const reviewed=async(a,parts=manifest(a))=>admin(()=>q('insert into icash_reception_private.cost_reviews(operation_key,receipt_id,attestation,components,evidence_ref,reviewed_by) values($1,$2,$3,$4,$5,$6)',[a.binding.operationKey,a.binding.receiptId,JSON.stringify(a),JSON.stringify(parts),'SYNTHETIC LOCAL REVIEW ONLY','Local test reviewer']));
 const settle=a=>value('select public.icash_settle_general_reception($1,$2)',[a.binding.operationKey,JSON.stringify(a)]);
 const admitted=async(n=1)=>{await prepare();eq((await reserve(n)).allowed,true);return attestation(await finish(n));};
 const financial=()=>admin(async()=>({wallet:await value('select to_jsonb(w) from icash_wallets w where account_id=$1',[account]),budget:await value('select to_jsonb(b) from icash_operating_budget b'),ledger:await value('select coalesce(jsonb_agg(to_jsonb(l)),\'[]\'::jsonb) from icash_credit_ledger l'),operations:await value('select coalesce(jsonb_agg(to_jsonb(o)),\'[]\'::jsonb) from icash_operation_spend o'),manifests:await value('select coalesce(jsonb_agg(to_jsonb(m)),\'[]\'::jsonb) from icash_cost_manifests m')}));
 await scenario('missing review never releases the reservation',async()=>{const a=await admitted();const before=await financial();eq((await settle(a)).reason,'cost_review_required');eq(await financial(),before);eq(before.wallet.balance_cents,85);eq(before.wallet.reserved_cents,65);});
 await scenario('exact receipt settles real ledger and releases unused reserve once',async()=>{
  const a=await admitted();await reviewed(a);const result=await settle(a);eq(result,{settled:true,chargedCents:14,costBasis:'verified',providerMarginVerified:true});
  const after=await financial();eq(after.wallet.balance_cents,71);eq(after.wallet.reserved_cents,0);eq(after.operations[0].actual_micros,38500);eq(after.operations[0].state,'settled');eq(after.budget.reserved_micros,0);eq(after.budget.spent_micros,38500);
  eq(await settle(a),result);eq(await value('select public.icash_get_general_reception_settlement($1)',[a.binding.operationKey]),result);eq(await financial(),after);const other={...a,providers:{...a.providers,twilio:{...a.providers.twilio,receiptHash:'e'.repeat(64)}}};eq((await settle(other)).reason,'settlement_status_unconfirmed');eq(await financial(),after);
 });
 await scenario('explicit reviewed estimates stay labelled estimated',async()=>{const a=await admitted();await reviewed(a,manifest(a,true));eq(await settle(a),{settled:true,chargedCents:14,costBasis:'estimated',providerMarginVerified:false});eq((await financial()).operations[0].cost_basis,'estimated');});
 await scenario('above owner 65-cent cap stays held without clamping',async()=>{const a=await admitted();a.providers.twilio.amountMicros=200000;await reviewed(a);const before=await financial();eq((await settle(a)).reason,'charge_exceeds_cap');eq(await financial(),before);});
 await scenario('exact 65-cent cap settles without increasing it',async()=>{const a=await admitted();a.providers.elevenlabs.amountMicros=0;a.providers.twilio.amountMicros=129000;await reviewed(a);eq((await settle(a)).chargedCents,65);eq((await financial()).wallet.balance_cents,20);});
 await scenario('foreign binding and unknown/incomplete costs cannot be approved',async()=>{
  const a=await admitted();
  for(const key of Object.keys(a.binding)){const bad=structuredClone(a);bad.binding[key]=typeof bad.binding[key]==='number'?bad.binding[key]+1:'foreign';await denies(()=>reviewed(bad),/binding mismatch|receipt|invalid input/i);}
  for(const cat of cats){const parts=manifest(a);delete parts[cat];await denies(()=>reviewed(a,parts),/16 cost categories/);}
  for(const amount of [-1,0.1,9007199254740992]){const b=structuredClone(a);b.providers.twilio.amountMicros=amount;await denies(()=>reviewed(b),/Invalid provider cost/);}
  const noReceipt=structuredClone(a);delete noReceipt.providers.twilio.amountMicros;await denies(()=>reviewed(noReceipt),/Verified USD receipt/);
  const mismatch=manifest(a);mismatch.elevenlabs.amountMicros++;await denies(()=>reviewed(a,mismatch),/receipt does not match/);
  const estimatedProvider=manifest(a);estimatedProvider.twilio.basis='estimated';await denies(()=>reviewed(a,estimatedProvider),/receipt does not match/);
  const llm=manifest(a);llm.llm.amountMicros=1;await denies(()=>reviewed(a,llm),/Inclusive ElevenLabs/);
  const duration={...a,durationSeconds:63};await denies(()=>reviewed(duration),/Duration/);
 });
 await scenario('changed provider receipt after approval and missing reservation stay held',async()=>{const a=await admitted();await reviewed(a);const before=await financial();const bad=structuredClone(a);bad.providers.elevenlabs.amountMicros++;eq((await settle(bad)).reason,'cost_review_mismatch');eq(await financial(),before);await admin(()=>q('update icash_operation_spend set charge_cap_cents=66 where operation_key=$1',[a.binding.operationKey]));const changed=await financial();eq((await settle(a)).reason,'reservation_mismatch');eq(await financial(),changed);});
 await scenario('review cannot be created by service, anonymous or authenticated roles',async()=>{const a=await admitted();await reviewed(a);const before=await financial();
  for(const role of ['service_role','anon','authenticated','outsider']){await q('set local role '+role);await denies(()=>q('select * from icash_reception_private.cost_reviews'));await denies(()=>q('insert into icash_reception_private.cost_reviews default values'));if(role!=='service_role')await denies(()=>settle(a));}
  await q('set local role service_role');eq(await financial(),before);
  await denies(()=>admin(()=>q('update icash_reception_private.cost_reviews set reviewed_by=\'different\'')),/immutable/);
  await denies(()=>admin(()=>q('delete from icash_reception_private.cost_reviews')),/immutable/);
  await denies(()=>admin(()=>q('truncate icash_reception_private.cost_reviews')),/immutable/);
 });
 await scenario('zero reviewed cost releases once with no debit',async()=>{const a=await admitted();a.providers.twilio.amountMicros=0;a.providers.elevenlabs.amountMicros=0;const parts=manifest(a);parts.support_and_overhead.amountMicros=0;await reviewed(a,parts);eq((await settle(a)).chargedCents,0);const after=await financial();eq(after.wallet.balance_cents,85);eq(after.wallet.reserved_cents,0);eq((await value('select public.icash_get_general_reception_settlement($1)',[a.binding.operationKey])).chargedCents,0);await settle(a);eq(await financial(),after);});
 await scenario('normal profile retains its separate 430-cent ceiling',async()=>{await admin(()=>q('update icash_wallets set balance_cents=500 where account_id=$1',[account]));await admin(()=>q('update icash_accounts set daily_limit_cents=500 where id=$1',[account]));await admin(()=>q('update icash_spend_activations set customer_cap_cents=500 where account_id=$1',[account]));await prepare('','normal');eq((await reserve()).allowed,true);const a=attestation(await finish());a.providers.elevenlabs.amountMicros=0;a.providers.twilio.amountMicros=859000;await reviewed(a);eq((await settle(a)).chargedCents,430);eq((await financial()).wallet.balance_cents,70);});
 await scenario('existing budget overrun safeguard remains in force',async()=>{const a=await admitted();a.providers.elevenlabs.amountMicros=150000;await reviewed(a);eq((await settle(a)).settled,true);const after=await financial();eq(after.budget.enabled,false);eq(after.operations[0].cost_basis,'verified');});
 console.log(`PASS reception settlement: ${scenarios} scenarios, ${assertions} assertions; real atomic ledger, synthetic local evidence only`);
}catch(e){console.error('FAIL',e.message,e.stack);process.exitCode=1;}finally{await db.close();}
