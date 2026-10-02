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
const rate='f93ace00-83fc-4d09-a37c-6d9d9f0a38f0', otherRate='f93ace00-83fc-4d09-a37c-6d9d9f0a38f1';
const hash='a'.repeat(64),caller='b'.repeat(64),agent='agent_receptionFixture',branch='agtbrch_receptionFixture',version='agtvrsn_receptionFixture';
const sid=n=>'CA'+n.toString(16).padStart(32,'0'),nonce=n=>n.toString(16).padStart(64,'0');
const q=async(sql,args=[])=>{try{return await db.query(sql,args);}catch(e){if(!['42501','P0001','25P02'].includes(e.code))console.error('SQL ERROR',e.message,sql);throw e;}};
const value=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
const reserve=(n=1,over={})=>value('select public.icash_reserve_general_reception($1,$2,$3,$4,$5,$6)',[over.call??sid(n),over.to??'+17816093521',over.caller??caller,over.nonce??nonce(n),over.hash??hash,over.version??version]);
const finish=(n=1,over={})=>value('select public.icash_finish_general_reception($1,$2,$3,$4,$5,$6,$7,$8)',[over.call??sid(n),over.nonce??nonce(n),over.agent??agent,over.version??version,over.branch??branch,over.conv??`conv_test${n}`,over.state??'completed',JSON.stringify(over.statements??[])]);
let assertions=0,scenarios=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);assertions++;};
const ok=(a,message)=>{assert.ok(a,message);assertions++;};
async function admin(f){await q('reset role');try{return await f();}finally{await q('set local role service_role');}}
async function denies(f,re=/permission denied|must be owner/i){await q('savepoint deny');try{await assert.rejects(f,re);assertions++;}finally{await q('rollback to savepoint deny');await q('release savepoint deny');}}
async function scenario(name,f){await q('begin');try{await q('set local role service_role');await f();scenarios++;console.log('PASS '+name);}finally{await q('rollback');}}
async function prepare(extra=''){
 await admin(()=>q(`update icash_reception_private.config set config_hash=$1,agent_id=$2,branch_id=$3,reviewed_version_id=$4,
 approved_at=clock_timestamp()-interval '1 hour',reviewed_until=clock_timestamp()+interval '1 day',approval_reference='LOCAL SYNTHETIC PROVIDER REVIEW',
 allow_inbound_while_paused=true,inbound_pause_approval_reference='LOCAL SYNTHETIC INBOUND-ONLY APPROVAL',enabled=true ${extra}`,[hash,agent,branch,version]));
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
 await db.exec(`grant select,insert,update,delete on all tables in schema public to service_role;
 revoke all on all functions in schema public from public,anon,authenticated;grant execute on all functions in schema public to service_role;`);
 await db.exec(read('config/general-reception.sql'));
 const originalCredit=await value("select pg_get_functiondef('public.icash_reserve_credit(uuid,text,bigint)'::regprocedure)");
 const originalClaim=await value("select pg_get_functiondef('public.icash_claim_before_activation(text)'::regprocedure)");
 await db.exec(read('config/general-reception-customer-funding.sql'));
 const changedCredit=await value("select pg_get_functiondef('public.icash_reserve_credit(uuid,text,bigint)'::regprocedure)");
 const changedClaim=await value("select pg_get_functiondef('public.icash_claim_before_activation(text)'::regprocedure)");
 eq(changedCredit.replaceAll('if a.bot_paused and not public.icash_general_reception_pause_exempt(p_account,p_operation,p_amount) then','if a.bot_paused then'),originalCredit);
 eq(changedClaim.replace('if (a.bot_paused and not public.icash_general_reception_pause_exempt(o.account_id,p_operation,o.charge_cap_cents)) or not r.enabled','if a.bot_paused or not r.enabled'),originalClaim);

 await db.exec(read('config/general-reception-setup.sql'));
 const setup=()=>value('select public.icash_get_reception_setup()');
 const setupNonce=n=>n.toString(16).padStart(32,'0');
 const originalPhone={sid:'PN'+'1'.repeat(32),account_sid:'AC'+'2'.repeat(32),phone_number:'+17816093521',
  voice_url:'https://original.example/inbound',voice_method:'POST',voice_fallback_url:'https://original.example/fallback',voice_fallback_method:'POST',
  status_callback:'https://original.example/status',status_callback_method:'POST',voice_application_sid:null,trunk_sid:null,
  sms_url:'https://original.example/sms',sms_method:'POST'};
 const setupClaim=(action,n=1,phone=null,fingerprint=hash)=>value('select public.icash_claim_reception_setup($1,$2,$3,$4)',[action,setupNonce(n),fingerprint,phone===null?null:JSON.stringify(phone)]);
 const setupComplete=(action,n=1,result={})=>value('select public.icash_complete_reception_setup($1,$2,$3)',[action,setupNonce(n),JSON.stringify(result)]);
 await scenario('setup RPC ACLs and private RLS deny direct and anonymous access',async()=>{
  eq(await setup(),{schema_version:1,attempts:{},original_phone:null,route_started_at:null});
  eq(await value("select has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='icash_reception_private' and c.relname='setup_attempts'"),false);
  eq(await value("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='icash_reception_private' and c.relname='setup_attempts'"),true);
  await denies(()=>q('select * from icash_reception_private.setup_attempts'));
  for(const role of ['anon','authenticated','outsider']){
   await q(`set local role ${role}`);await denies(setup);await denies(()=>setupClaim('prepare_branch'));await denies(()=>setupComplete('prepare_branch'));
  }
  await q('set local role service_role');
 });
 await scenario('branch preparation and configuration are one-shot, bounded, disabled-only',async()=>{
  const before=await snapshot();
  eq(await setupClaim('bogus'),false);eq(await setupClaim('prepare_branch',1,originalPhone),false);
  eq(await setupClaim('prepare_branch'),true);eq(await setupClaim('prepare_branch'),false);eq(await setupClaim('prepare_branch',2),false);
  eq(await setupClaim('configure_branch',2),false,'uncertain in-progress provider operation blocks another action');
  const result={branch_id:branch,reviewed_version_id:version,config_hash:hash};
  for(const bad of [{...result,extra:true},{...result,branch_id:'agtbrch_8901m3sw5tn6fvkae4d334netswh'},{...result,config_hash:'bad'}])eq(await setupComplete('prepare_branch',1,bad),false);
  eq(await setupComplete('prepare_branch',2,result),false);eq(await setupComplete('prepare_branch',1,result),true);eq(await setupComplete('prepare_branch',1,result),false);
  const c=await value('select public.icash_get_general_reception_config()');
  eq(c.enabled,false);eq(c.agent_id,'agent_7801m3qsygdwfv5tggatf7w68y3d');eq(c.branch_id,branch);eq(c.reviewed_version_id,version);eq(c.config_hash,hash);
  eq(c.funding_mode,'customer_credits');eq(c.rate_id,rate);eq(c.allow_inbound_while_paused,false);eq(c.max_duration_seconds,60);
  eq(await value('select bot_paused from icash_accounts'),true);eq(await snapshot(),before);
  eq(await setupClaim('configure_branch',2),true);eq(await setupComplete('configure_branch',2,result),true);
  eq((await setup()).attempts.configure_branch.state,'verified');
 });
 await scenario('route original snapshot is exact and claim rejects unsafe routing shapes',async()=>{
  eq(await setupClaim('route',1,originalPhone),false,'disabled configuration cannot route');
  await prepare();
  for(const bad of [null,{},[],{...originalPhone,phone_number:'+15555555555'},{...originalPhone,sid:'PNbad'},
   {...originalPhone,account_sid:'ACbad'},{...originalPhone,voice_application_sid:'AP'+'3'.repeat(32)},
   {...originalPhone,trunk_sid:'TK'+'3'.repeat(32)},{...originalPhone,voice_method:'DELETE'},
   {...originalPhone,voice_fallback_method:'PATCH'},{...originalPhone,oversized:'x'.repeat(100000)}])eq(await setupClaim('route',1,bad),false);
  const before=await snapshot();eq(await setupClaim('route',1,originalPhone),true);
  const saved=await setup();eq(saved.original_phone,originalPhone);eq(saved.attempts.route.state,'started');ok(saved.route_started_at);
  eq(await setupClaim('route',2,{...originalPhone,voice_url:'https://changed.example'}),false);eq((await setup()).original_phone,originalPhone);
  eq(await setupComplete('route',2,{}),false);eq(await setupComplete('route',1,{extra:true}),false);eq(await setupComplete('route',1,{}),true);
  eq(await setupComplete('route',1,{}),false);eq((await setup()).original_phone,originalPhone);eq(await snapshot(),before);
  eq(await setupClaim('prepare_branch',3),false,'active reception cannot reconfigure provider branch');
 });
 await scenario('uncertain route cannot retry; restore needs saved original and delay',async()=>{
  eq(await setupClaim('restore',1),false);await prepare();eq(await setupClaim('route',1,originalPhone),true);
  eq(await setupClaim('route',2,originalPhone),false);eq(await setupClaim('restore',2),false,'minimum restore delay');
  // Trusted local clock fixture only, leaving the saved provider snapshot exact.
  await admin(()=>q("update icash_reception_private.setup_attempts set started_at=clock_timestamp()-interval '31 seconds' where action='route'"));
  eq(await setupClaim('restore',2,originalPhone),false,'restore cannot replace saved routing');
  eq(await setupClaim('restore',2),true);eq(await setupClaim('restore',3),false);eq(await setupComplete('restore',2,{}),true);
  eq((await setup()).original_phone,originalPhone);eq((await setup()).attempts.route.state,'started','unknown route result remains unknown');
  eq(await value('select bot_paused from icash_accounts'),true);eq((await snapshot()).wallet.balance_cents,85);
 });

 await scenario('disabled default; no operator amount or period; wallet and pause untouched',async()=>{
  const c=await value('select public.icash_get_general_reception_config()');eq(c.enabled,false);eq(c.funding_mode,'customer_credits');eq(c.rate_id,rate);eq(c.allow_inbound_while_paused,false);eq(c.receipt_mode,'provider_readback');eq(await value('select public.icash_latest_general_reception_receipt()'),null);
  eq(c.approved_budget_usd_micros,null);eq(c.period_starts_at,null);eq(c.period_ends_at,null);eq(c.reviewed_until,null);
  await zeroMutation(async()=>eq(await reserve(),{allowed:false,reason:'disabled'}));
  eq(await value('select bot_paused from icash_accounts'),true);eq((await snapshot()).wallet.balance_cents,85);
 });
 await scenario('paused account needs exact explicit inbound opt-in; no debit when denied',async()=>{
  await prepare();await admin(()=>q('update icash_reception_private.config set allow_inbound_while_paused=false,inbound_pause_approval_reference=null'));
  await zeroMutation(async()=>eq(await reserve(),{allowed:false,reason:'customer_funding_denied'}));
  eq(await value('select bot_paused from icash_accounts'),true);
 });
 await scenario('real reserve+claim holds exactly65c before provider; operation/evidence fixed',async()=>{
  await prepare();const result=await reserve();eq(result.allowed,true);eq(result.receipt.operation_key,'reception:'+sid(1));
  eq(result.receipt.customer_charge_cap_cents,65);eq(result.receipt.max_duration_seconds,60);eq(result.receipt.conversation_id,null);
  const s=await snapshot();eq(s.wallet.balance_cents,85);eq(s.wallet.reserved_cents,65);eq(s.receipts,1);eq(s.ops,1);eq(s.credits,1);eq(s.ledger,0);
  const operation=await value('select to_jsonb(o) from icash_operation_spend o');eq(operation.state,'dispatched');eq(operation.charge_cap_cents,65);eq(operation.reserved_micros,126120);eq(await value('select public.icash_latest_general_reception_receipt()'),result.receipt);
  eq(operation.standard_cost_multiplier,5);eq(operation.elevenlabs_cost_multiplier,3);
  eq(await value('select bot_paused from icash_accounts'),true);eq((await value('select to_jsonb(a) from icash_spend_activations a')).customer_cap_cents,300);
  eq((await reserve()).reason,'duplicate_call');eq((await reserve(2)).reason,'concurrency_limit');
  eq((await reserve(10,{call:sid(1).toLowerCase().replace('ca','CA')})).reason,'duplicate_call');
 });
 await scenario('all real existing customer guards reject atomically',async()=>{
  await prepare();
  for(const [statement,restore] of [
   ['update icash_wallets set balance_cents=64','update icash_wallets set balance_cents=85'],
   ['update icash_accounts set daily_limit_cents=64','update icash_accounts set daily_limit_cents=300'],
   ['update icash_spend_activations set enabled=false','update icash_spend_activations set enabled=true'],
   ['update icash_spend_activations set customer_cap_cents=64','update icash_spend_activations set customer_cap_cents=300'],
   ["update icash_funding_orders set state='pending'","update icash_funding_orders set state='paid'"],
   ["update icash_operation_rates set costs_micros=jsonb_set(costs_micros,'{twilio}','1000000') where id='"+rate+"'",null],
  ]){
   await q('savepoint guard');await q(statement);await zeroMutation(async()=>eq((await reserve()).reason,'customer_funding_denied'));await q('rollback to savepoint guard');await q('release savepoint guard');
  }
 });
 await scenario('claim rejection after actual credit reserve rolls back every financial write',async()=>{
  await prepare();
  await admin(()=>db.exec(`create function public.local_test_block_claim() returns trigger language plpgsql as $$
   begin update public.icash_spend_activations set enabled=false where account_id=new.account_id;return new;end $$;
   create trigger local_test_block_claim after insert on public.icash_operation_spend for each row execute function public.local_test_block_claim();`));
  await zeroMutation(async()=>eq((await reserve()).reason,'customer_funding_denied'));
  eq(await value('select enabled from icash_spend_activations'),true,'subtransaction also reverted injected claim failure');
 });
 await scenario('disabled, wrong, short, costly, stale rates and expired reviews fail closed',async()=>{
  await prepare();
  for(const change of ["enabled=false","operation='seller_call'",'charge_cents=66','charge_cents=64','voice_max_duration_seconds=59',"expires_at=clock_timestamp()+interval '30 seconds'","verified_at=clock_timestamp()+interval '1 hour'"]){
   await q('savepoint rate');await q(`update icash_operation_rates set ${change} where id=$1`,[rate]);await zeroMutation(async()=>eq((await reserve()).reason,'rate_unavailable'));await q('rollback to savepoint rate');await q('release savepoint rate');
  }
  await admin(()=>q("update icash_reception_private.config set reviewed_until=clock_timestamp()+interval '30 seconds'"));
  await zeroMutation(async()=>eq((await reserve()).reason,'outside_review'));
 });
 await scenario('no arbitrary prefix, outbound, account or charge pause exemption',async()=>{
  await prepare();
  for(const key of ['reception:'+sid(99),'voice:outbound','random']){
   eq(await value('select public.icash_general_reception_pause_exempt($1,$2,65)',[account,key]),false);
   await denies(()=>q('select public.icash_reserve_operation($1,$2,$3,now()+interval \'1 day\')',[account,key,otherRate]),/Bot paused/);
  }
  await reserve();
  eq(await value('select public.icash_general_reception_pause_exempt($1,$2,64)',[account,'reception:'+sid(1)]),false);
  eq(await value('select public.icash_general_reception_pause_exempt($1,$2,65)',['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','reception:'+sid(1)]),false);
 });
 await scenario('ordinary unpaused real reserve and claim still work under service role',async()=>{
  await q('update icash_accounts set bot_paused=false');
  const r=await value('select public.icash_reserve_operation($1,$2,$3,now()+interval \'1 day\')',[account,'ordinary:fixture',otherRate]);eq(r.state,'reserved');
  eq(await value("select public.icash_claim_operation('ordinary:fixture')"),true);
  eq((await snapshot()).wallet.reserved_cents,65);
 });
 await scenario('ordinary claim remains paused despite inbound opt-in',async()=>{
  await prepare();await q('update icash_accounts set bot_paused=false');
  await value('select public.icash_reserve_operation($1,$2,$3,now()+interval \'1 day\')',[account,'ordinary:pending',otherRate]);
  await q('update icash_accounts set bot_paused=true');
  eq(await value("select public.icash_claim_operation('ordinary:pending')"),false);
  eq(await value("select state from icash_operation_spend where operation_key='ordinary:pending'"),'reserved');
 });
 await scenario('signed exact terminal binding keeps full reserve; no automatic settlement',async()=>{
  await prepare();await reserve();
  for(const override of [{nonce:nonce(2)},{agent:'agent_other'},{version:'agtvrsn_other'},{branch:'agtbrch_other'},{call:sid(2)},{state:'unknown'}])eq(await finish(1,override),null);
  const before=await snapshot(),r=await finish();eq(r.state,'completed');eq(r.operation_key,'reception:'+sid(1));eq(r.conversation_id,'conv_test1');
  eq(await finish(),r);eq(await finish(1,{conv:'conv_other'}),null);eq(await snapshot(),before);
  const hook=await value('select public.icash_get_general_reception_reconciliation($1)',[r.operation_key]);
  eq(hook.operation_state,'dispatched');eq(hook.customer_reserved_cents,65);eq(hook.credit_state,'reserved');eq(hook.requires_authoritative_cost_reconciliation,true);eq(hook.provider_cost_basis,'planning_reserve_actual_cost_unknown');
  await zeroMutation(async()=>eq((await reserve(2)).reason,'customer_funding_denied'));
 });
 await scenario('failed terminal receipt preserves credits and supports authoritative observation binding',async()=>{
  await prepare();await reserve();const r=await finish(1,{state:'failed'});eq(r.state,'failed');
  await q('select public.icash_record_cost_observation($1,$2,$3,$4,$5)',['elevenlabs',r.conversation_id,r.operation_key,0.01,'USD']);
  eq((await snapshot()).wallet.reserved_cents,65);eq(await value('select state from icash_operation_spend'),'dispatched');
  eq((await snapshot()).ledger,0);
 });
 await scenario('one concurrency, canonical replay and throttle survive customer bridge',async()=>{
  await prepare();await q('update icash_wallets set balance_cents=300');
  const first=await Promise.all([reserve(10),reserve(10),reserve(11)]);eq(first.filter(x=>x.allowed).length,1);eq(first[1].reason,'duplicate_call');eq(first[2].reason,'concurrency_limit');
  eq((await reserve(10,{call:sid(10).slice(0,2)+sid(10).slice(2).toUpperCase()})).reason,'duplicate_call');
  await finish(10);eq((await reserve(11)).allowed,true);await finish(11);eq((await reserve(12)).reason,'caller_throttled');
  eq((await reserve(12,{caller:'c'.repeat(64)})).allowed,true);
 });
 await scenario('private ledger immutable; only service RPCs and boolean helper permitted',async()=>{
  await prepare();await reserve();
  for(const table of ['config','receipts'])for(const stmt of [`select * from icash_reception_private.${table}`,`delete from icash_reception_private.${table}`,`truncate icash_reception_private.${table}`])await denies(()=>q(stmt));
  for(const role of ['anon','authenticated','outsider']){
   await q(`set local role ${role}`);await denies(()=>reserve());await denies(()=>finish());await denies(()=>value('select public.icash_latest_general_reception_receipt()'));await denies(()=>value('select public.icash_general_reception_pause_exempt($1,$2,65)',[account,'reception:'+sid(1)]));
  }
  await q('set local role service_role');
  await admin(()=>denies(()=>q("update icash_reception_private.receipts set operation_key='reception:CAffffffffffffffffffffffffffffffff'"),/immutable/));
  await admin(()=>denies(()=>q('update icash_reception_private.config set allow_inbound_while_paused=false'),/immutable/));
 });
 await scenario('review expiry uses wall clock after transaction start',async()=>{
  await prepare();await admin(()=>q("update icash_reception_private.config set reviewed_until=clock_timestamp()+interval '120.08 seconds'"));
  await new Promise(r=>setTimeout(r,130));await zeroMutation(async()=>eq((await reserve()).reason,'outside_review'));
 });
 // Commit a real admitted receipt, then prove the narrow exemption cannot be
 // reused by another transaction even when every receipt binding is known.
 await q('begin');await q('set local role service_role');await prepare();const committed=await reserve();eq(committed.allowed,true);eq(await setupClaim('route',1,originalPhone),true);await q('commit');
 await q('begin');await q('set local role service_role');
 eq(await value('select public.icash_general_reception_pause_exempt($1,$2,65)',[account,committed.receipt.operation_key]),false);
 eq((await reserve()).reason,'duplicate_call');eq(await value('select public.icash_latest_general_reception_receipt()'),committed.receipt);
 eq((await setup()).original_phone,originalPhone);eq((await setup()).attempts.route.state,'started');eq(await setupClaim('route',2,originalPhone),false);
 eq((await finish()).operation_key,committed.receipt.operation_key);eq((await snapshot()).wallet.reserved_cents,65);
 await q('rollback');scenarios++;console.log('PASS committed receipt cannot grant pause exemption in another transaction');
 console.log(`PASS customer-funded reception + setup: ${scenarios} scenarios, ${assertions} assertions; real wallet/reserve/claim chain, local serialized PGlite only`);
}catch(e){console.error('FAIL',e.message,e.stack);process.exitCode=1;}finally{await db.close();}
