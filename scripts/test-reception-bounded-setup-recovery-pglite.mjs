import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
// LOCAL RECOVERY TEST ONLY. Real source-extracted wallet and operation primitives; no network,
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
async function admin(f){await q('reset role');try{return await f();}finally{await q('set local role service_role');}}
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
 const changedCredit=await value("select pg_get_functiondef('public.icash_reserve_credit(uuid,text,bigint)'::regprocedure)");
 const changedClaim=await value("select pg_get_functiondef('public.icash_claim_before_activation(text)'::regprocedure)");
 eq(changedCredit.replaceAll('if a.bot_paused and not public.icash_general_reception_pause_exempt(p_account,p_operation,p_amount) then','if a.bot_paused then'),originalCredit);
 eq(changedClaim.replace('if (a.bot_paused and not public.icash_general_reception_pause_exempt(o.account_id,p_operation,o.charge_cap_cents)) or not r.enabled','if a.bot_paused or not r.enabled'),originalClaim);

 await db.exec(read('config/general-reception-profile-setup-upgrade.sql'));
 eq(await value("select to_jsonb(a) from icash_reception_private.setup_attempts a where action='route'"),preservedAttempt);
 eq((await value('select public.icash_get_reception_setup()')).original_phone,preservedPhone);
 eq(await value("select has_function_privilege('service_role','public.icash_complete_reception_setup(text,text,jsonb)','EXECUTE')"),true);
 eq(await value("select has_function_privilege('anon','public.icash_complete_reception_setup(text,text,jsonb)','EXECUTE')"),false);
 scenarios++;console.log('PASS installed old setup → profile bridge → RPC-only upgrade preserves original snapshot and attempt');
 // Reset ONLY the synthetic local row so independent scenarios start empty.
 await q('delete from icash_reception_private.setup_attempts');
 // Fresh-install and upgrade function definitions must remain identical.
 const currentCompletion=fn('config/general-reception-setup.sql','icash_complete_reception_setup').replace(/create function/i,'create or replace function');
 const upgradedCompletion=fn('config/general-reception-profile-setup-upgrade.sql','icash_complete_reception_setup');
 eq(currentCompletion,upgradedCompletion);
 const setup=()=>value('select public.icash_get_reception_setup()');
 const setupNonce=n=>n.toString(16).padStart(32,'0');
 const claim=(action,n=1,phone=null)=>value('select public.icash_claim_reception_setup($1,$2,$3,$4)',[action,setupNonce(n),hash,phone===null?null:JSON.stringify(phone)]);
 const complete=(action,n=1,result={})=>value('select public.icash_complete_reception_setup($1,$2,$3)',[action,setupNonce(n),JSON.stringify(result)]);
 const original=()=>admin(()=>value("select to_jsonb(a) from icash_reception_private.setup_attempts a where action='prepare_branch'"));
 const evidence=async()=>({observed:await value('select clock_timestamp()::text'),absent:await value('select clock_timestamp()::text')});
 const reject=async(over={})=>{const times=await evidence();return value('select public.icash_confirm_reception_setup_rejected_422($1,$2,$3,$4,$5)',[
  Object.hasOwn(over,'nonce')?over.nonce:setupNonce(1),Object.hasOwn(over,'fingerprint')?over.fingerprint:hash,
  Object.hasOwn(over,'ref')?over.ref:'LOCAL VERIFIED HTTP422 ANALYTICS AND ABSENCE EVIDENCE',
  Object.hasOwn(over,'observed')?over.observed:times.observed,Object.hasOwn(over,'absent')?over.absent:times.absent]);};
 eq(await claim('prepare_branch',1),true);
 const originalBefore=await value("select to_jsonb(a) from icash_reception_private.setup_attempts a where action='prepare_branch'");
 const configBefore=await value('select public.icash_get_general_reception_config()');
 const walletBefore=await value('select to_jsonb(w) from icash_wallets w');
 await db.exec(read('config/general-reception-rejected-setup-recovery.sql'));
 eq(await value("select to_jsonb(a) from icash_reception_private.setup_attempts a where action='prepare_branch'"),originalBefore);
 eq(await value('select public.icash_get_general_reception_config()'),configBefore);eq(await value('select to_jsonb(w) from icash_wallets w'),walletBefore);
 scenarios++;console.log('PASS recovery installation changes no original attempt, config, wallet or provider state');

 // Model the installed live state: immutable original rejected; retry1 still
 // started after an exact provider422 that has NOT been confirmed in SQL yet.
 eq(await reject(),true);eq(await claim('prepare_branch_retry',2),true);
 const priorRows=await value("select jsonb_agg(to_jsonb(a) order by action) from icash_reception_private.setup_attempts a");
 const priorConfig=await value('select public.icash_get_general_reception_config()');
 const priorWallet=await value('select to_jsonb(w) from icash_wallets w');
 await db.exec(read('config/general-reception-bounded-setup-recovery.sql'));
 eq(await value("select jsonb_agg(to_jsonb(a) order by action) from icash_reception_private.setup_attempts a"),priorRows);
 eq(await value('select public.icash_get_general_reception_config()'),priorConfig);eq(await value('select to_jsonb(w) from icash_wallets w'),priorWallet);
 scenarios++;console.log('PASS original rejected and retry1 held survive bounded recovery installation byte-for-byte');
 const genericReject=async(action,n,over={})=>{const times=await evidence();return value('select public.icash_confirm_reception_setup_rejection($1,$2,$3,$4,$5,$6)',[
  action,Object.hasOwn(over,'nonce')?over.nonce:setupNonce(n),Object.hasOwn(over,'fingerprint')?over.fingerprint:hash,
  Object.hasOwn(over,'ref')?over.ref:'LOCAL EXACT422 AND FRESH ABSENCE EVIDENCE',
  Object.hasOwn(over,'observed')?over.observed:times.observed,Object.hasOwn(over,'absent')?over.absent:times.absent]);};
 const audits=()=>admin(()=>value("select jsonb_agg(to_jsonb(a) order by action) from icash_reception_private.setup_attempts a"));
 const result={branch_id:branch,reviewed_version_id:version,config_hash:hash,call_profile:'normal',rate_id:normalRate,max_duration_seconds:600,customer_charge_cap_cents:430};
 await scenario('generic recovery ACL and safe getter cover every bounded action',async()=>{
  for(const role of ['anon','authenticated','outsider']){
   await q(`set local role ${role}`);await denies(()=>genericReject('prepare_branch_retry',2));await denies(()=>claim('prepare_branch_retry_2',3));
  }
  await q('set local role service_role');
  const original=(await setup()).attempts.prepare_branch;eq(original.state,'rejected');eq(original.provider_status,422);
  eq(Object.keys(original).sort(),['finished_at','provider_status','started_at','state']);
  eq((await setup()).attempts.prepare_branch_retry.provider_status,null);
 });
 await scenario('started or unknown predecessor never admits a later retry or skipped action',async()=>{
  const before=await audits();eq(await claim('prepare_branch_retry',7),false);eq(await claim('prepare_branch_retry_2',3),false);eq(await claim('prepare_branch_retry_3',4),false);
  for(const action of ['unknown','route','configure_branch','restore','prepare_branch_retry_4',null])eq(await genericReject(action,2),false);
  for(const over of [{nonce:setupNonce(8)},{fingerprint:'f'.repeat(64)},{ref:'bad'},{absent:'infinity'},{observed:'2099-01-01T00:00:00Z'},
   {observed:'2000-01-01T00:00:00Z'},{absent:'2000-01-01T00:00:00Z'},{nonce:null},{observed:null}])eq(await genericReject('prepare_branch_retry',2,over),false);
  eq(await audits(),before);eq(await reject(),false,'old original wrapper cannot modify rejected audit');
 });
 await scenario('confirm exact retry1 then claim retry2 once without changing any previous identity',async()=>{
  const before=await audits();eq(await genericReject('prepare_branch_retry',2),true);const after=await audits();
  eq(after.find(x=>x.action==='prepare_branch'),before.find(x=>x.action==='prepare_branch'));
  const prior=before.find(x=>x.action==='prepare_branch_retry'),updated=after.find(x=>x.action==='prepare_branch_retry');
  for(const key of ['action','nonce','fingerprint','started_at','original_phone'])eq(updated[key],prior[key]);
  eq(updated.state,'rejected');eq(updated.result.provider_status,422);eq(updated.result.attempt_action,'prepare_branch_retry');
  eq(new Date(updated.finished_at).getTime(),new Date(updated.result.recorded_at).getTime());
  eq(await genericReject('prepare_branch_retry',2),false);
  const claims=await Promise.all([claim('prepare_branch_retry_2',3),claim('prepare_branch_retry_2',8)]);eq(claims,[true,false]);
  eq(await claim('prepare_branch_retry_3',4),false);eq(await claim('prepare_branch_retry_2',9),false);
  eq((await setup()).attempts.prepare_branch_retry.provider_status,422);
 });
 await scenario('three corrected attempts are a hard ceiling even after all422 rejections',async()=>{
  eq(await genericReject('prepare_branch_retry',2),true);eq(await claim('prepare_branch_retry_2',3),true);
  eq(await genericReject('prepare_branch_retry_2',3),true);eq(await claim('prepare_branch_retry_3',4),true);
  eq(await genericReject('prepare_branch_retry_3',4),true);
  for(const action of ['prepare_branch_retry','prepare_branch_retry_2','prepare_branch_retry_3','prepare_branch_retry_4','prepare_branch_retry_5'])eq(await claim(action,9),false);
  const rows=await audits();eq(rows.length,4);for(const row of rows){eq(row.state,'rejected');eq(row.result.provider_status,422);}
  eq((await snapshot()).wallet.balance_cents,85);eq((await snapshot()).receipts,0);eq(await value('select bot_paused from icash_accounts'),true);
 });
 await scenario('second and third retries retain exact profile completion and no-enable semantics',async()=>{
  eq(await genericReject('prepare_branch_retry',2),true);eq(await claim('prepare_branch_retry_2',3),true);
  for(const bad of [{...result,customer_charge_cap_cents:65},{...result,rate_id:rate},{...result,max_duration_seconds:60},{...result,call_profile:'owner_quick_test'},{...result,extra:true}])eq(await complete('prepare_branch_retry_2',3,bad),false);
  eq(await genericReject('prepare_branch_retry_2',3),true);eq(await claim('prepare_branch_retry_3',4),true);
  const before=await snapshot();eq(await complete('prepare_branch_retry_3',9,result),false);eq(await complete('prepare_branch_retry_3',4,result),true);
  eq(await complete('prepare_branch_retry_3',4,result),false);eq(await genericReject('prepare_branch_retry_3',4),false);
  const c=await value('select public.icash_get_general_reception_config()');eq(c.enabled,false);eq(c.call_profile,'normal');eq(c.branch_id,branch);eq(await snapshot(),before);
  eq(await claim('prepare_branch_retry_4',8),false);
 });
 await scenario('all rejected audits and bounded retry identities resist reset delete and truncate',async()=>{
  eq(await genericReject('prepare_branch_retry',2),true);eq(await claim('prepare_branch_retry_2',3),true);
  for(const action of ['prepare_branch','prepare_branch_retry']){
   await admin(()=>denies(()=>q(`update icash_reception_private.setup_attempts set state='started',finished_at=null,result=null where action=$1`,[action]),/immutable/));
   await admin(()=>denies(()=>q('delete from icash_reception_private.setup_attempts where action=$1',[action]),/cannot be removed/));
  }
  await admin(()=>denies(()=>q("update icash_reception_private.setup_attempts set nonce=repeat('f',32) where action='prepare_branch_retry_2'"),/immutable/));
  await admin(()=>denies(()=>q("delete from icash_reception_private.setup_attempts where action='prepare_branch_retry_2'"),/cannot be removed/));
  await admin(()=>denies(()=>q('truncate icash_reception_private.setup_attempts'),/cannot be removed/));
 });
 await scenario('stale absence or future-finished predecessor proof is not a fresh retry grant',async()=>{
  eq(await genericReject('prepare_branch_retry',2),true);
  // Trusted synthetic rejected row models aged evidence without waiting10min.
  // Existing immutable real audit rows remain untouched in this fixture.
  for(const delta of ['-11 minutes','1 minute']){
   await q('savepoint proof_fixture');
   await admin(()=>q(`insert into icash_reception_private.setup_attempts(action,nonce,fingerprint,state,started_at,finished_at,result)
    select 'prepare_branch_retry_2',$1,$2,'rejected',clock_timestamp()-interval '20 minutes',stamp,
     jsonb_build_object('provider_status',422,'branch_absent',true,'evidence_reference','LOCAL TIME FIXTURE',
      'provider_observed_at',stamp,'branch_absence_checked_at',stamp,'recorded_at',stamp)
    from (select clock_timestamp()+$3::interval stamp) x`,[setupNonce(3),hash,delta]));
   eq(await claim('prepare_branch_retry_3',4),false);
   await q('rollback to savepoint proof_fixture');await q('release savepoint proof_fixture');
  }
 });
 await scenario('existing branch and real receipt continue blocking generic rejection',async()=>{
  await admin(()=>q("update icash_reception_private.config set branch_id='agtbrch_existing'"));eq(await genericReject('prepare_branch_retry',2),false);
  await admin(()=>q('update icash_reception_private.config set branch_id=null'));await prepare();eq((await reserve()).allowed,true);
  await admin(()=>q('update icash_reception_private.config set enabled=false'));eq(await genericReject('prepare_branch_retry',2),false);eq(await claim('prepare_branch_retry_2',3),false);
 });
 await q('begin');await q('set local role service_role');eq(await genericReject('prepare_branch_retry',2),true);eq(await claim('prepare_branch_retry_2',3),true);await q('commit');
 await q('begin');await q('set local role service_role');eq((await setup()).attempts.prepare_branch_retry.provider_status,422);
 eq((await setup()).attempts.prepare_branch_retry_2.state,'started');eq(await claim('prepare_branch_retry_2',8),false);eq(await claim('prepare_branch_retry_3',4),false);await q('rollback');
 scenarios++;console.log('PASS committed retry1 rejection and held retry2 remain durable and non-repeatable');
 console.log(`PASS bounded reception recovery: ${scenarios} scenarios, ${assertions} assertions; local serialized PGlite, no provider operations`);
}catch(e){console.error('FAIL',e.message,e.stack);process.exitCode=1;}finally{await db.close();}
