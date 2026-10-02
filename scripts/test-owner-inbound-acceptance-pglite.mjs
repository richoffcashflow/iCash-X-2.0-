import {renderOwnerInboundSchema} from './owner-inbound-schema.mjs';
import {randomBytes} from 'node:crypto';
// LOCAL SIMULATION ONLY: isolated PGlite, real wallet/ledger settlement SQL.
// No provider, network, credentials, production database or migration command.
// PGlite serializes connection calls; Promise.all tests are replay interleavings,
// not a substitute for multi-session PostgreSQL lock/deadlock verification.
/*
MULTI-SESSION POSTGRESQL VERIFICATION REQUIRED BEFORE ANY ACTIVATION (NOT RUN)
This workspace has no psql/postgres/initdb or pg driver. Never point this test at
Supabase, a provider, a network database, or an existing customer database. Use a
new disposable LOCAL PostgreSQL instance, install the exact prerequisite table /
credit function SQL loaded below and this candidate SQL, and create only the
synthetic config/receipt fixtures below. Use two independent psql sessions A/B;
Promise.all on one PGlite connection does not establish lock behavior.

For each scenario, start from a fresh fixture database (consumed IDs, records and
ledger rows are intentionally immutable). Use BEGIN / COMMIT or ROLLBACK in each
session, statement_timeout='5s', and lock_timeout='4s'. Coordinate commits from a
third terminal if needed; observe pg_stat_activity.wait_event_type='Lock' while B
waits. Do not count a timeout as a passing result.

Arm query, substituting the local fixture config UUID in WHERE:
  SELECT icash_arm_owner_inbound_acceptance(c.account_id,c.owner_user_id,c.id,
    c.reviewed_config_hash,c.reviewed_version_id,to_jsonb(c),repeat('a',64),
    repeat('b',64)) FROM icash_owner_inbound_acceptance_config c WHERE id=...;
All other RPC arguments use the exact synthetic run/call/conversation IDs produced
by that fixture and the strict evidence object constructed by evidence() below.

1. Same config arm: A BEGIN, arm, leave uncommitted. B BEGIN, same arm must wait.
   A COMMIT: B returns null. Assert one run, one reservation, wallet reserved=cap,
   unchanged balance, one armed audit and disabled config. Repeat with A ROLLBACK:
   B must win with exactly one run/reservation and no leaked A audit or balance.
2. Distinct reviewed configs for same account: A arms config1, holds transaction;
   B arms config2 and must wait on account admission. A COMMIT: B returns null,
   config2 stays enabled, and only one unresolved run/reserve exists. Repeat with
   A ROLLBACK: config2 may win. A needs_review run must continue to block config2.
3. Attempt versus cancel: A attempts and holds run lock; B cancels and waits.
   A COMMIT: B yields needs_review with full reserve held. Reverse the order:
   committed unattempted cancel means B attempt returns null and reserve is zero.
   Repeat with A ROLLBACK. At no point may a committed attempt receive a refund.
4. Two claims: A claims and holds run lock; B same claim waits. After A COMMIT, B
   returns null. Changed receipt/call/conversation must not admit or overwrite it.
5. Concurrent finalization: A finishes with authoritative evidence and holds run /
   wallet locks; B identical finish waits. After commit B returns same settled row;
   assert one usage ledger entry and one debit only. Changed evidence must fail.
6. Wallet competition: an ordinary icash_reserve_credit transaction and owner arm
   contend for the same account/wallet with combined caps above the balance. Only
   the fitting reservation may commit; the rejected transaction changes nothing.
   Repeat for the rolling daily budget, including existing outstanding reserves.
7. Attempt versus expired cancellation and finalization versus cancellation:
   advance the real local clock by waiting past the <=5-minute arm window (do not
   edit immutable timestamps). Assert expired unattempted release, attempted hold,
   and that a committed authoritative settlement is never refunded or duplicated.

Record both session outputs and post-transaction wallet/reservation/run/audit/
ledger assertions. Deadlocks, timeouts, unsupported isolation behavior, or skipped
cases are blockers, not proof. This manual protocol is documentation, not a
claim that real multi-session tests have passed.
*/
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
if(!process.argv[2])throw new Error('Pass the local @electric-sql/pglite/dist/index.js path');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const pg=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const extract=(path,start,end)=>{const sql=read(path),a=sql.indexOf(start);assert(a>=0,start);return sql.slice(a,sql.indexOf(end,a)+end.length);};
const foundation='supabase/migrations/20260928015041_icash_accounts_deals_credit_foundation.sql';
const atomic='supabase/migrations/20260928015153_icash_atomic_credits_and_engine_evidence.sql';
const hash=s=>createHash('sha256').update(s).digest('hex');
const q=(sql,args=[])=>pg.query(sql,args);
const one=async(sql,args=[])=> (await q(sql,args)).rows[0];
const rpc=async(name,body)=>{const keys=Object.keys(body);return (await one(`select public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) result`,Object.values(body))).result;};
const testAccountSid='AC'+randomBytes(16).toString('hex');
const user='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',account='48dfb798-8c1a-404f-88c0-c396cc067062',otherUser=randomUUID(),otherAccount=randomUUID();
const sha=hash('reviewed config fixture'),version='agtvrsn_fixture';
let sequence=0;
const identities=()=>{const n=++sequence;return {sid:'CA'+(n+10).toString(16).padStart(32,'0'),conversation:'conv_fixture'+n,receipt:hash('admission'+n)};};
let assertions=0;
async function transaction(name,work){await q('begin');try{await work();assertions++;console.log('PASS:',name);}finally{await q('rollback');}}
const wallet=()=>one('select * from icash_wallets where account_id=$1',[account]);
async function config(patch={}){
 const c={id:randomUUID(),account_id:account,owner_user_id:user,owner_phone:'+12142185280',source_phone:'+14243948384',ingress_phone:'+17816093521',twilio_account_sid:testAccountSid,agent_id:'agent_7801m3qsygdwfv5tggatf7w68y3d',elevenlabs_region:'global',twilio_region:'us1',phone_number_id:'phnum_9501m3qxddgne8gtr99wcce2h0gn',branch_id:'agtbrch_8901m3sw5tn6fvkae4d334netswh',branch_name:'isolated-owner-audio-test',reviewed_config_hash:sha,reviewed_version_id:version,approval_ref:'LOCAL fixture explicitly reviewed once',all_in_cost_reviewed:true,forwarding_no_incremental_cost:true,provider_extras_disabled:true,max_duration_seconds:60,quote_cap_cents:50,twilio_micros_per_minute:10000,elevenlabs_micros_per_minute:100000,customer_cost_multiplier:2,rate_evidence_hash:hash('reviewed all-in cost fixture'),rate_reviewed_at:new Date(Date.now()-60000).toISOString(),rate_expires_at:new Date(Date.now()+3600000).toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),...patch};
 const keys=Object.keys(c);return (await one(`insert into icash_owner_inbound_acceptance_config(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning to_jsonb(icash_owner_inbound_acceptance_config) c`,Object.values(c))).c;
}
const arm=(c,patch={})=>rpc('icash_arm_owner_inbound_acceptance',{p_account:account,p_user:user,p_config:c.id,p_hash:sha,p_version:version,p_expected:c,p_challenge_salt:hash('random fixture salt'),p_challenge_hash:hash('fixture challenge hash only'),...patch});
const attempt=(r,ids,patch={})=>rpc('icash_attempt_owner_inbound_acceptance',{p_account:account,p_user:user,p_run:r.id,p_call_sid:ids.sid,p_conversation:ids.conversation,...patch});
const claim=(r,ids,patch={})=>rpc('icash_claim_owner_inbound_acceptance',{p_account:account,p_user:user,p_run:r.id,p_call_sid:ids.sid,p_conversation:ids.conversation,p_hash:sha,p_version:version,p_receipt_hash:ids.receipt,...patch});
const cancel=(r,patch={})=>rpc('icash_cancel_owner_inbound_acceptance',{p_account:account,p_user:user,p_run:r.id,...patch});
const evidence=(patch={})=>({outcome:'passed',challenge_passed:true,audio_passed:true,duration_seconds:12,result_receipt_hash:hash('result'),twilio_cost_micros:10000,elevenlabs_cost_micros:20000,twilio_receipt_hash:hash('twilio receipt'),elevenlabs_receipt_hash:hash('elevenlabs receipt'),...patch});
const finish=(r,ids,ev=evidence(),patch={})=>rpc('icash_finish_owner_inbound_acceptance',{p_account:account,p_user:user,p_run:r.id,p_call_sid:ids.sid,p_conversation:ids.conversation,p_evidence:ev,...patch});
async function armed(patch={}){return arm(await config({enabled:true,...patch}));}
async function admitted(){const r=await armed(),ids=identities();assert.equal((await attempt(r,ids)).state,'inspecting');assert.equal((await claim(r,ids)).state,'claimed');return {r,ids};}
try{
 await pg.exec('create role anon;create role authenticated;create role service_role;create schema auth;create schema icash_private;create table auth.users(id uuid primary key);');
 for(const name of ['icash_accounts','icash_wallets','icash_credit_ledger','icash_credit_reservations'])await pg.exec(extract(foundation,'create table public.'+name+' (',';'));
 await pg.exec(extract(atomic,'create function public.icash_finish_credit(','$$;'));
 await pg.exec(extract(foundation,'create function icash_private.reject_ledger_change()','$$;'));
 await pg.exec(extract(foundation,'create trigger icash_ledger_immutable',';'));
 // Match the prerequisite tables' existing service grants. The newly installed
 // config/runs/audit grants and RLS are tested independently below.
 await pg.exec('grant select,insert,update on icash_accounts,icash_wallets,icash_credit_ledger,icash_credit_reservations to service_role;grant execute on function icash_finish_credit(uuid,text,bigint,text) to service_role;');
 await pg.exec(renderOwnerInboundSchema(read('config/owner-inbound-acceptance.sql'),testAccountSid));
 await q('insert into auth.users values($1),($2)',[user,otherUser]);
 await q("insert into icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values($1,$2,'Fixture',true,1000),($3,$4,'Other fixture',true,1000)",[account,user,otherAccount,otherUser]);
 await q("insert into icash_wallets(account_id,balance_cents,reserved_cents,currency) values($1,1000,0,'USD'),($2,1000,0,'USD')",[account,otherAccount]);
 assert.equal((await one('select count(*)::int n from icash_owner_inbound_acceptance_config')).n,0,'No activation seed');
 await transaction('default OFF and unreviewed all-in costs block without reserve',async()=>{
  assert.equal(await arm(await config()),null);
  for(const key of ['all_in_cost_reviewed','forwarding_no_incremental_cost','provider_extras_disabled'])assert.equal(await arm(await config({enabled:true,[key]:false})),null);
  assert.equal(Number((await wallet()).reserved_cents),0);
 });
 await transaction('all fixed owner/ingress/source/provider identities enforced',async()=>{
  for(const [key,val] of Object.entries({owner_phone:'+12145550001',source_phone:'+12145550002',ingress_phone:'+12145550003',twilio_account_sid:'AC'+'0'.repeat(32),agent_id:'agent_other',account_id:otherAccount,owner_user_id:otherUser,phone_number_id:'phnum_other',branch_id:'agtbrch_other',max_duration_seconds:61})){
   await q('savepoint invalid_config');await assert.rejects(config({[key]:val}),/check constraint/i);await q('rollback to savepoint invalid_config');
  }
 });
 await transaction('owner/account, hash/version, stale CAS, malformed challenge and rates block',async()=>{
  const c=await config({enabled:true});
  for(const patch of [{p_account:otherAccount},{p_user:otherUser},{p_hash:hash('wrong')},{p_version:'wrong'},{p_expected:{...c,quote_cap_cents:51}},{p_challenge_salt:'plaintext'},{p_challenge_hash:null}])assert.equal(await arm(c,patch),null);
  assert.equal(await arm(await config({enabled:true,rate_reviewed_at:new Date(Date.now()+1000).toISOString()})),null);
  assert.equal(await arm(await config({enabled:true,rate_expires_at:new Date(Date.now()+1000).toISOString()})),null);
  assert.equal(await arm(await config({enabled:true,rate_expires_at:new Date(Date.now()+330000).toISOString()})),null,'Rates must cover the complete five-minute arm plus sixty-second audio window');
  const boundary=await config({enabled:true});await q("update icash_owner_inbound_acceptance_config set rate_expires_at=now()+interval '6 minutes' where id=$1",[boundary.id]);
  const exact=(await one('select to_jsonb(c) c from icash_owner_inbound_acceptance_config c where id=$1',[boundary.id])).c;
  assert.equal(await arm(exact),null,'Rate validity must extend strictly beyond the full arm plus audio window');
  const changedOwner=randomUUID();await q('insert into auth.users values($1)',[changedOwner]);await q('update icash_accounts set owner_user_id=$1 where id=$2',[changedOwner,account]);assert.equal(await arm(c),null);
 });
 await transaction('one atomic wallet reserve; bot stays paused; arm cannot replay',async()=>{
  const c=await config({enabled:true});const results=await Promise.all([arm(c),arm(c)]);assert.equal(results.filter(Boolean).length,1);const r=results.find(Boolean);
  assert.equal(Number((await wallet()).balance_cents),1000);assert.equal(Number((await wallet()).reserved_cents),50);
  assert.equal((await one('select bot_paused from icash_accounts where id=$1',[account])).bot_paused,true);
  assert.equal(new Date(r.expires_at)-new Date(r.armed_at),300000);
  assert.equal((await one('select enabled from icash_owner_inbound_acceptance_config where id=$1',[c.id])).enabled,false);
  await q('savepoint no_rearm');await assert.rejects(q('update icash_owner_inbound_acceptance_config set enabled=true where id=$1',[c.id]),/consumed/i);await q('rollback to savepoint no_rearm');
  assert.equal(await arm(c),null);
 });
 await transaction('wallet/day insufficient funds roll back every write',async()=>{
  const c=await config({enabled:true});
  for(const stmt of ['update icash_wallets set balance_cents=49','update icash_accounts set daily_limit_cents=49']){
   await q('savepoint insufficient');await q(stmt);await assert.rejects(arm(c),/credits|budget/);await q('rollback to savepoint insufficient');
   assert.equal((await one('select count(*)::int n from icash_credit_reservations')).n,0);
   assert.equal((await one('select count(*)::int n from icash_owner_inbound_acceptance_runs')).n,0);
   assert.equal((await one('select enabled from icash_owner_inbound_acceptance_config where id=$1',[c.id])).enabled,true);
  }
 });
 await transaction('two reviewed configs cannot arm concurrently or bypass an unresolved attempt',async()=>{
  const c=await config({enabled:true}),c2=await config({enabled:true});const armedRuns=await Promise.all([arm(c),arm(c2)]);assert.equal(armedRuns.filter(Boolean).length,1);
  const r=armedRuns.find(Boolean),other=armedRuns[0]?c2:c;assert.equal(Number((await wallet()).reserved_cents),50);
  const ids=identities();await attempt(r,ids);await cancel(r);assert.equal(await arm(other),null,'Unknown prior spend holds new authorization');
  assert.equal((await one('select count(*)::int n from icash_owner_inbound_acceptance_runs')).n,1);
 });
 await transaction('other outstanding wallet reservations prevent combined overspend',async()=>{
  await q('update icash_wallets set balance_cents=75,reserved_cents=30 where account_id=$1',[account]);const c=await config({enabled:true});
  await q('savepoint combined_budget');await assert.rejects(arm(c),/Insufficient/);await q('rollback to savepoint combined_budget');assert.equal(Number((await wallet()).reserved_cents),30);
 });
 await transaction('explicit transaction rollback removes authorization consumption and reserve',async()=>{
  const c=await config({enabled:true});await q('savepoint before_arm');assert(await arm(c));await q('rollback to savepoint before_arm');
  assert.equal(Number((await wallet()).reserved_cents),0);assert(await arm(c));
 });
 await transaction('attempt and provider IDs are once-only; changed claim receipt rejects',async()=>{
  const r=await armed(),ids=identities();
  for(const patch of [{p_account:otherAccount},{p_user:otherUser},{p_call_sid:'invalid'},{p_conversation:'invalid'}])assert.equal(await attempt(r,ids,patch),null);
  const attempts=await Promise.all([attempt(r,ids),attempt(r,ids)]);assert.equal(attempts.filter(Boolean).length,1);
  for(const patch of [{p_hash:hash('wrong')},{p_version:'wrong'},{p_call_sid:identities().sid},{p_conversation:'conv_wrong'},{p_receipt_hash:null},{p_user:otherUser}])assert.equal(await claim(r,ids,patch),null);
  assert.equal((await claim(r,ids)).state,'claimed');assert.equal(await claim(r,ids),null);await finish(r,ids);
  const r2=await armed();assert.equal(await attempt(r2,{...identities(),sid:ids.sid}),null);assert.equal(await attempt(r2,{...identities(),sid:ids.sid.toUpperCase()}),null);assert.equal(await attempt(r2,{...identities(),conversation:ids.conversation}),null);
  const ids2=identities();await attempt(r2,ids2);assert.equal(await claim(r2,{...ids2,receipt:ids.receipt}),null);
 });
 await transaction('cancel unattempted refunds reserve exactly once and never rearms',async()=>{
  const r=await armed();assert.equal(await cancel(r,{p_user:otherUser}),null);assert.equal((await cancel(r)).state,'cancelled');assert.equal((await cancel(r)).charged_cents,0);
  assert.equal(Number((await wallet()).reserved_cents),0);assert.equal(Number((await wallet()).balance_cents),1000);
  assert.equal((await one('select status from icash_credit_reservations where id=$1',[r.credit_reservation_id])).status,'released');
  assert.equal(await attempt(r,identities()),null);assert.equal((await one('select count(*)::int n from icash_owner_inbound_acceptance_audit where run_id=$1',[r.id])).n,2);
 });
 await transaction('inspect/claimed cancellation burns attempt and retains unknown cost',async()=>{
  for(const admit of [false,true]){await q('savepoint inspecting_or_admitted');const r=await armed(),ids=identities();await attempt(r,ids);if(admit)await claim(r,ids);assert.equal((await cancel(r)).state,'needs_review');assert.equal((await cancel(r)).settled_at,null);assert.equal(await claim(r,ids),null);assert.equal(await attempt(r,ids),null);assert.equal(Number((await wallet()).reserved_cents),50);assert.equal(Number((await wallet()).balance_cents),1000);await q('rollback to savepoint inspecting_or_admitted');}
 });
 await transaction('actual bound receipt settles once through real immutable wallet ledger',async()=>{
  const {r,ids}=await admitted();assert.equal(await finish(r,ids,evidence(),{p_user:otherUser}),null);
  const result=await finish(r,ids);assert.equal(result.state,'passed');assert.equal(Number(result.charged_cents),6);
  await finish(r,ids);assert.equal((await one('select count(*)::int n from icash_credit_ledger')).n,1);
  assert.equal(Number((await wallet()).balance_cents),994);assert.equal(Number((await wallet()).reserved_cents),0);
  await q('savepoint conflicting');await assert.rejects(finish(r,ids,evidence({twilio_cost_micros:10001})),/conflict/i);await q('rollback to savepoint conflicting');
 });
 await transaction('authoritative zero costs release reserve; zero is different from missing',async()=>{
  const {r,ids}=await admitted();const result=await finish(r,ids,evidence({twilio_cost_micros:0,elevenlabs_cost_micros:0}));assert.equal(result.state,'passed');assert.equal(Number(result.charged_cents),0);
  assert.equal(Number((await wallet()).balance_cents),1000);assert.equal(Number((await wallet()).reserved_cents),0);assert.equal((await one('select count(*)::int n from icash_credit_ledger')).n,0);
 });
 await transaction('unknown cost is never free; later authoritative receipt can reconcile only same attempt',async()=>{
  const {r,ids}=await admitted();const unknown=evidence({twilio_cost_micros:null,twilio_receipt_hash:null});
  assert.equal((await finish(r,ids,unknown)).state,'needs_review');assert.equal((await finish(r,ids,unknown)).settled_at,null);
  assert.equal(Number((await wallet()).reserved_cents),50);assert.equal((await one('select count(*)::int n from icash_credit_ledger')).n,0);
  assert.equal((await cancel(r)).settled_at,null);assert.equal((await finish(r,ids)).state,'passed');assert.equal(Number((await wallet()).reserved_cents),0);
 });
 await transaction('overspend cannot exceed quote cap or release reservation',async()=>{
  const {r,ids}=await admitted();const out=await finish(r,ids,evidence({twilio_cost_micros:1000000}));assert.equal(out.state,'needs_review');assert.equal(out.charged_cents,null);
  assert.equal(Number((await wallet()).balance_cents),1000);assert.equal(Number((await wallet()).reserved_cents),50);assert.equal((await cancel(r)).settled_at,null);
  await q('savepoint cost_revision');await assert.rejects(finish(r,ids),/authoritative cost receipt conflict/);await q('rollback to savepoint cost_revision');
 });
 await transaction('inspection failure has no successful claim and can only settle authoritative costs',async()=>{
  const r=await armed(),ids=identities();await attempt(r,ids);assert.equal((await finish(r,ids,{outcome:'needs_review'})).state,'needs_review');
  assert.equal((await finish(r,ids,evidence({outcome:'failed',challenge_passed:false,audio_passed:false}))).state,'failed');
  assert.equal(await claim(r,ids),null);
 });
 await transaction('success needs admission/challenge/audio/duration; evidence is allowlisted',async()=>{
  const r=await armed(),ids=identities();await attempt(r,ids);
  await q('savepoint not_admitted');await assert.rejects(finish(r,ids),/unproven/);await q('rollback to savepoint not_admitted');await claim(r,ids);
  for(const patch of [{challenge_passed:false},{audio_passed:false},{duration_seconds:61},{duration_seconds:null},{result_receipt_hash:null},{transcript:'DO NOT PERSIST'},{challenge_plaintext:'DO NOT PERSIST'},{audio_passed:'true'},{twilio_cost_micros:-1},{elevenlabs_cost_micros:1.2},{twilio_receipt_hash:'unhashed'},{outcome:null}]){
   await q('savepoint bad_evidence');await assert.rejects(finish(r,ids,evidence(patch)),/Invalid|unproven|Unknown/);await q('rollback to savepoint bad_evidence');
  }
  assert.equal((await one('select evidence from icash_owner_inbound_acceptance_runs where id=$1',[r.id])).evidence,null);
 });
 await transaction('audit, consumed config, run snapshot and binding cannot be rewritten',async()=>{
  const {r}=await admitted();
  for(const [sql,args] of [
   ['update icash_owner_inbound_acceptance_audit set state=$1',['changed']],
   ['delete from icash_owner_inbound_acceptance_audit',[]],
   ['update icash_owner_inbound_acceptance_runs set challenge_hash=$1 where id=$2',[hash('changed'),r.id]],
   ['update icash_owner_inbound_acceptance_runs set state=$1 where id=$2',['armed',r.id]],
   ['update icash_owner_inbound_acceptance_runs set state=$1 where id=$2',['inspecting',r.id]],
   ['update icash_owner_inbound_acceptance_runs set conversation_id=$1 where id=$2',['conv_changed',r.id]],
   ['update icash_owner_inbound_acceptance_config set quote_cap_cents=51 where id=$1',[r.config_id]]
  ]){await q('savepoint immutable');await assert.rejects(q(sql,args),/immutable|consumed|forbidden/i);await q('rollback to savepoint immutable');}
  await cancel(r);await q('savepoint no_review_retry');await assert.rejects(q("update icash_owner_inbound_acceptance_runs set state='inspecting' where id=$1",[r.id]),/forbidden/);await q('rollback to savepoint no_review_retry');
 });
 await transaction('service-role invoker can arm/settle without browser table or RPC access',async()=>{
  const c=await config({enabled:true});await q('set local role service_role');const r=await arm(c);assert(r);assert.equal((await cancel(r)).state,'cancelled');await q('reset role');
  for(const role of ['anon','authenticated']){
   await q('savepoint unauthorized');await q('set local role '+role);await assert.rejects(q('select * from icash_owner_inbound_acceptance_runs'),/permission denied/i);await q('rollback to savepoint unauthorized');
   await q('savepoint unauthorized_rpc');await q('set local role '+role);await assert.rejects(arm(c),/permission denied/i);await q('rollback to savepoint unauthorized_rpc');
  }
 });
 await transaction('all new tables and RPCs deny public/anon/authenticated access',async()=>{
  for(const role of ['anon','authenticated'])for(const t of ['config','runs','audit']){
   const table='icash_owner_inbound_acceptance_'+t;
   for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await one('select has_table_privilege($1,$2,$3) ok',[role,table,privilege])).ok,false);
   assert.equal((await one('select relrowsecurity ok from pg_class where oid=$1::regclass',[table])).ok,true);
  }
  const functions=(await q("select oid::regprocedure::text signature from pg_proc where proname like 'icash_%_owner_inbound_acceptance'")).rows;
  assert.equal(functions.length,5);
  for(const {signature} of functions)for(const role of ['anon','authenticated'])assert.equal((await one('select has_function_privilege($1,$2,$3) ok',[role,signature,'EXECUTE'])).ok,false);
  assert.equal((await one("select has_table_privilege('service_role','icash_owner_inbound_acceptance_audit','UPDATE') ok")).ok,false);
 });
 // Real wall-clock expiry in separate committed transactions. No fixture rewrites
 // of immutable timestamps and no fake clock or SQL implementation substitutions.
 for(const attempted of [false,true]){
  const c=await config({enabled:true,expires_at:new Date(Date.now()+500).toISOString()});const r=await arm(c),ids=identities();assert(r);
  if(attempted)await attempt(r,ids);
  await new Promise(resolve=>setTimeout(resolve,550));
  assert.equal(await attempt(r,ids),null);assert.equal(await claim(r,ids),null);
  const before=Number((await wallet()).reserved_cents),done=await cancel(r);
  assert.equal(done.state,attempted?'needs_review':'expired');assert.equal(Number((await wallet()).reserved_cents),attempted?before:before-50);
  assertions++;
 }
 console.log(`PASS: ${assertions} owner inbound SQL scenarios. Local-only isolated SQL; no provider or production calls. Multi-session PostgreSQL races remain a separate pre-activation check.`);
}catch(error){console.error('FAIL:',error.message,error.detail??'',error.where??'');process.exitCode=1;}finally{await pg.close();}
