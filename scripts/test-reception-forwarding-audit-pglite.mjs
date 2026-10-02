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
 const originalPhone={sid:'PN'+'1'.repeat(32),account_sid:'AC'+'2'.repeat(32),phone_number:'+17816093521',
  voice_url:'https://original.example/inbound',voice_method:'POST',voice_fallback_url:'https://original.example/fallback',voice_fallback_method:'POST',
  status_callback:'https://original.example/status',status_callback_method:'POST',voice_application_sid:null,trunk_sid:null,
  sms_url:'https://original.example/sms',sms_method:'POST'};
 const setupClaim=(action,n=1,phone=null,fingerprint=hash)=>value('select public.icash_claim_reception_setup($1,$2,$3,$4)',[action,setupNonce(n),fingerprint,phone===null?null:JSON.stringify(phone)]);
 const setupComplete=(action,n=1,result={})=>value('select public.icash_complete_reception_setup($1,$2,$3)',[action,setupNonce(n),JSON.stringify(result)]);
 const initialConfig=await value('select public.icash_get_general_reception_config()');
 const initialWallet=await value('select to_jsonb(w) from icash_wallets w');
 const initialSetup=await setup();
 await db.exec(read('config/general-reception-forwarding-audit.sql'));
 eq(await value('select public.icash_get_general_reception_config()'),initialConfig);eq(await value('select to_jsonb(w) from icash_wallets w'),initialWallet);eq(await setup(),initialSetup);
 const forwarding=()=>value('select public.icash_get_reception_forwarding()');
 const originalSetting={enabled:false,to:null};
 const claimForwarding=(n=1,setting=originalSetting,fingerprint=hash)=>value('select public.icash_claim_reception_forwarding($1,$2,$3)',[setupNonce(n),fingerprint,setting===null?null:JSON.stringify(setting)]);
 const completeForwarding=(n=1,result={enabled:true,to:'+17816093521',status:'queued'},fingerprint=hash)=>value('select public.icash_complete_reception_forwarding($1,$2,$3)',[setupNonce(n),fingerprint,result===null?null:JSON.stringify(result)]);
 const audit=()=>admin(()=>value('select to_jsonb(a) from icash_reception_private.forwarding_attempt a'));
 const ready=async()=>{await prepare();eq(await setupClaim('route',10,originalPhone),true);eq(await setupComplete('route',10,{}),true);};
 scenarios++;console.log('PASS forwarding audit installation leaves configuration, financial records and prior setup unchanged');
 await scenario('forwarding singleton defaults empty and all access is service RPC-only',async()=>{
  eq(await forwarding(),{schema_version:1,attempt:null});
  eq(await value("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='icash_reception_private' and c.relname='forwarding_attempt'"),true);
  await denies(()=>q('select * from icash_reception_private.forwarding_attempt'));
  for(const role of ['anon','authenticated','outsider']){
   await q(`set local role ${role}`);await denies(forwarding);await denies(()=>claimForwarding());await denies(()=>completeForwarding());
  }
  await q('set local role service_role');
 });
 await scenario('claim needs verified route, active target gate and exact original settings',async()=>{
  eq(await claimForwarding(),false);await prepare();eq(await claimForwarding(),false);
  eq(await setupClaim('route',10,originalPhone),true);eq(await claimForwarding(),false);eq(await setupComplete('route',10,{}),true);
  for(const setting of [null,{},[],{enabled:true,to:null},{enabled:false,to:'+15555555555'},{enabled:false,to:''},{enabled:false,to:null,extra:true}])eq(await claimForwarding(1,setting),false);
  eq(await claimForwarding(1,originalSetting,'bad'),false);
  await admin(()=>q('update icash_reception_private.config set enabled=false'));eq(await claimForwarding(),false);
  await admin(()=>q('update icash_reception_private.config set enabled=true'));
  await q('update icash_operation_rates set enabled=false where id=$1',[rate]);eq(await claimForwarding(),false);await q('update icash_operation_rates set enabled=true where id=$1',[rate]);
  const before=await snapshot();eq(await claimForwarding(),true);eq(await snapshot(),before);
 });
 await scenario('one durable claim precedes provider write, preserves original and never repeats',async()=>{
  await ready();const before=await snapshot(),beforeSetup=await setup();
  eq(await Promise.all([claimForwarding(1),claimForwarding(2)]),[true,false]);
  const r=await audit();eq(r.state,'started');eq(r.original_setting,originalSetting);eq(r.source_number,'+14243948384');eq(r.destination_number,'+17816093521');
  eq(r.account_id,account);eq(r.owner_user_id,owner);eq(r.nonce,setupNonce(1));eq(r.fingerprint,hash);eq(r.accepted_at,null);eq(r.result,null);
  eq(await claimForwarding(1),false);eq(await claimForwarding(3),false);eq(await snapshot(),before);eq(await setup(),beforeSetup);
  const exposed=(await forwarding()).attempt;eq(Object.keys(exposed).sort(),['accepted_at','destination_number','provider_status','source_number','started_at','state']);
 });
 await scenario('exact queued acceptance is honest, immutable and does not enable retries',async()=>{
  await ready();eq(await claimForwarding(),true);const original=await audit();
  for(const result of [null,{},[],{enabled:false,to:'+17816093521',status:'queued'},
   {enabled:true,to:'+15555555555',status:'active'},{enabled:true,to:'+17816093521',status:'failed'},
   {enabled:true,to:'+17816093521',status:'queued',extra:true}])eq(await completeForwarding(1,result),false);
  eq(await completeForwarding(2),false);eq(await completeForwarding(1,{enabled:true,to:'+17816093521',status:'queued'},'f'.repeat(64)),false);
  eq(await completeForwarding(),true);const r=await audit();eq(r.state,'accepted');eq(r.provider_status,'queued');ok(r.accepted_at);
  for(const key of ['account_id','owner_user_id','source_number','destination_number','nonce','fingerprint','started_at','original_setting'])eq(r[key],original[key]);
  eq(await completeForwarding(),true,'identical completion readback is idempotent, no provider retry');
  eq(await completeForwarding(1,{enabled:true,to:'+17816093521',status:'active'}),false,'GET polling cannot rewrite queued command receipt');
  eq(await claimForwarding(2),false);eq((await forwarding()).attempt.provider_status,'queued');
  await admin(()=>denies(()=>q("update icash_reception_private.forwarding_attempt set provider_status='active'"),/immutable/));
 });
 await scenario('active acceptance records actual provider response without financial mutation',async()=>{
  await ready();eq(await claimForwarding(),true);const before=await snapshot();
  // Auditing a completed POST must remain possible if the target gate later pauses.
  await admin(()=>q('update icash_reception_private.config set enabled=false'));
  eq(await completeForwarding(1,{enabled:true,to:'+17816093521',status:'active'}),true);
  eq((await forwarding()).attempt.provider_status,'active');eq(await snapshot(),before);eq(await value('select bot_paused from icash_accounts'),true);
 });
 await scenario('unknown outcome cannot reset, change original, delete or truncate',async()=>{
  await ready();eq(await claimForwarding(),true);
  for(const change of ["nonce=repeat('f',32)","fingerprint=repeat('f',64)","original_setting='{}'::jsonb","source_number='+15555555555'","destination_number='+15555555555'","state='started'"])
   await admin(()=>denies(()=>q(`update icash_reception_private.forwarding_attempt set ${change}`),/immutable|cannot be reset/));
  await admin(()=>denies(()=>q('delete from icash_reception_private.forwarding_attempt'),/cannot be removed/));
  await admin(()=>denies(()=>q('truncate icash_reception_private.forwarding_attempt'),/cannot be removed/));
  eq(await claimForwarding(2),false);eq((await forwarding()).attempt.state,'started');
 });
 await scenario('restored route or expiring target approval cannot be used as forwarding target',async()=>{
  await ready();
  await admin(()=>q("update icash_reception_private.config set reviewed_until=clock_timestamp()+interval '119 seconds'"));eq(await claimForwarding(),false);
  await admin(()=>q("update icash_reception_private.config set reviewed_until=clock_timestamp()+interval '1 day'"));
  await admin(()=>q("update icash_reception_private.setup_attempts set started_at=clock_timestamp()-interval '31 seconds' where action='route'"));
  eq(await setupClaim('restore',11),true);eq(await claimForwarding(),false);
 });
 // Commit claim before any hypothetical provider POST; a different transaction
 // must observe it as held and cannot claim again after an uncertain response.
 await q('begin');await q('set local role service_role');await ready();eq(await claimForwarding(),true);await q('commit');
 await q('begin');await q('set local role service_role');eq((await forwarding()).attempt.state,'started');eq(await claimForwarding(2),false);eq((await audit()).original_setting,originalSetting);await q('rollback');
 scenarios++;console.log('PASS committed pre-POST forwarding claim survives transaction boundary without replay');
 console.log(`PASS forwarding audit: ${scenarios} scenarios, ${assertions} assertions; local serialized PGlite, no provider or financial operations`);
}catch(e){console.error('FAIL',e.message,e.stack);process.exitCode=1;}finally{await db.close();}
