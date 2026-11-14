// Real lock/concurrency proof against a fixed, disposable localhost database.
// Provider admission and receipts are synthetic; this runner makes no HTTP calls.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setupSql,seedSql,migration,id} from '../tests/helpers/owner-preflight-cleanup-fixture.mjs';

const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const database='icash_cleanup_check',clients=[];
const connect=async(name,db=database)=>{
 const client=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:db,application_name:'preflight-cleanup-'+name,connectionTimeoutMillis:5000});
 clients.push(client);await client.connect();
 await client.query("set statement_timeout='8s';set lock_timeout='1s'");
 return client;
};
const value=async(client,sql,args=[])=>Object.values((await client.query(sql,args)).rows[0]??{})[0];
const seed=(client,n)=>value(client,'select public.fixture_cleanup_seed($1)',[n]);
const claim=(client,c)=>value(client,'select public.icash_claim_owner_preflight($1,$2::jsonb,$3::jsonb)',[c.account,JSON.stringify(c.items),JSON.stringify(c.request)]);
const admit=(client,c,n)=>value(client,'select public.icash_admit_owner_preflight_cleanup($1,$2,$3)',[c.account,c.preflight,id(n)]);
const attempts=(client,c)=>value(client,'select cleanup_attempts from icash_research_private.owner_export_preflights where id=$1',[c.preflight]);
const immutable=(client,c)=>value(client,`select jsonb_build_object('id',id,'account',account_id,'fingerprint',fingerprint,'items',items,'request',request,'created',created_at,'started',started_at,'receipts',receipts,'generation',generation,'supersedes',supersedes)
 from icash_research_private.owner_export_preflights where id=$1`,[c.preflight]);
const record=(client,c,admission,receipt)=>value(client,'select public.icash_record_owner_preflight_cleanup($1,$2,$3::jsonb)',[c.preflight,admission.token,JSON.stringify(receipt)]);
const successfulReceipt={httpStatus:200,raw:{data:{deleted:true}},rawText:'{"data":{"deleted":true}}'};
const promptly=async(action,message)=>{const start=performance.now();const result=await action();assert(performance.now()-start<750,message);return result;};
const waitForLock=async(observer,pid)=>{
 const deadline=Date.now()+3000;
 while(!await value(observer,"select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock')",[pid])){
  assert(Date.now()<deadline,'Competing ordinary claim must really reach its budget lock');
  await new Promise(resolve=>setTimeout(resolve,10));
 }
};

try{
 const bootstrap=await connect('bootstrap','postgres');
 if(!await value(bootstrap,'select exists(select 1 from pg_database where datname=$1)',[database])){
  try{await bootstrap.query('create database icash_cleanup_check');}catch(error){if(error.code!=='42P04')throw error;}
 }
 const admin=await connect('observer'),runner=await connect('runner'),blocker=await connect('lock-holder'),other=await connect('competitor');
 assert.equal(await value(admin,'select current_database()'),database);
 await admin.query('drop schema if exists icash_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema public cascade;create schema public');
 await admin.query(setupSql+seedSql);
 const originalCleanup=await value(admin,"select pg_get_functiondef('public.icash_claim_owner_preflight_cleanup(uuid)'::regprocedure)");
 await admin.query('begin;'+migration+'commit;');
 assert.equal(await value(admin,"select pg_get_functiondef('public.icash_claim_owner_preflight_cleanup(uuid)'::regprocedure)"),originalCleanup,'Global FIFO primitive remains unchanged');

 // FIFO still skips a row held by an unrelated worker. Its claim does not own
 // the shared request-budget lock, and a targeted worker never waits on its row.
 const fifoA=await seed(admin,101),fifoB=await seed(admin,102);
 const ordered=(await admin.query('select id from icash_research_private.owner_export_preflights order by created_at,id')).rows.map(row=>row.id);
 const first=[fifoA,fifoB].find(c=>c.preflight===ordered[0]),second=[fifoA,fifoB].find(c=>c.preflight===ordered[1]);
 assert.equal((await claim(runner,first)).status,'held','Rollout is disabled by default');
 assert.equal((await admit(runner,first,1001)).status,'held');
 assert.equal(await attempts(admin,first),0);
 // Activation is serialized by the same budget row and is strictly one-time.
 await blocker.query('begin');await blocker.query('select 1 from public.icash_operating_budget where id=1 for update');
 const activationPid=await value(runner,'select pg_backend_pid()'),competingActivationPid=await value(other,'select pg_backend_pid()');
 const activation=value(runner,"select icash_research_private.activate_owner_preflight_cleanup(repeat('a',40))");
 const competingActivation=value(other,"select icash_research_private.activate_owner_preflight_cleanup(repeat('a',40))");
 let activationResults;
 try{
  await waitForLock(admin,activationPid);await waitForLock(admin,competingActivationPid);
  assert.equal(await value(admin,'select enabled from icash_research_private.owner_preflight_cleanup_policy where id=1'),false);
 }finally{await blocker.query('rollback');activationResults=await Promise.all([activation,competingActivation]);}
 assert.deepEqual(activationResults.sort(),[false,true],'Exactly one simultaneous administrative activation may succeed');
 await blocker.query('begin');await blocker.query('select 1 from icash_research_private.owner_export_preflights where id=$1 for update',[first.preflight]);
 await runner.query('begin');
 try{
  const global=await promptly(()=>value(runner,'select public.icash_claim_owner_preflight_cleanup(null)'),'FIFO must skip a locked oldest row');
  assert.equal(global.id,second.preflight);
  assert.equal((await promptly(()=>admit(other,second,1002),'Targeted cleanup must not wait on the FIFO row')).status,'pending');
  await other.query('begin');
  try{await other.query('select 1 from public.icash_operating_budget where id=1 for update nowait');}finally{await other.query('rollback');}
 }finally{await runner.query('rollback');await blocker.query('rollback');}
 assert.equal(await attempts(admin,first),0);
 assert.equal(await attempts(admin,second),0);
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.requests where id=$1',[id(1002)]),0,'Row contention does not acquire provider authority');
 const global=await value(runner,'select public.icash_claim_owner_preflight_cleanup(null)');
 assert.equal(global.id,first.preflight,'Unlocked global cleanup retains oldest-first ordering');
 assert.equal(await record(runner,first,global,successfulReceipt),true);
 const globalSecond=await value(runner,'select public.icash_claim_owner_preflight_cleanup(null)');
 assert.equal(globalSecond.id,second.preflight);
 assert.equal(await record(runner,second,globalSecond,successfulReceipt),true);

 // All concurrent requests use distinct IDs; only one may obtain provider
 // authority, and original source identity and lifetime are unchanged.
 const concurrent=await seed(admin,103),original=await immutable(admin,concurrent);
 assert.equal((await claim(runner,concurrent)).status,'cleanup_required');
 const contenders=await Promise.all(Array.from({length:6},(_,n)=>connect('admission-'+n)));
 const raced=await Promise.all(contenders.map((client,n)=>admit(client,concurrent,1100+n)));
 assert.equal(raced.filter(result=>result.status==='admitted').length,1);
 assert(raced.every(result=>['admitted','pending'].includes(result.status)));
 const winner=raced.find(result=>result.status==='admitted');
 assert.equal(await attempts(admin,concurrent),1);
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.owner_preflight_cleanup_admissions where preflight_id=$1',[concurrent.preflight]),1);
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.requests where account_id=$1 and admitted',[concurrent.account]),1);
 assert.deepEqual(await immutable(admin,concurrent),original);
 assert.equal((await admit(runner,concurrent,Number(winner.requestId.slice(-12)))).status,'pending','An active original lease cannot be replayed');

 // An unknown provider result is evidence, never confirmed deletion or renewal.
 assert.equal(await record(runner,concurrent,winner,{httpStatus:null,raw:{},rawText:''}),false);
 assert.equal(await value(admin,'select icash_research_private.owner_preflight_renewable($1)',[concurrent.preflight]),false);
 assert.equal(await value(admin,'select deleted_at is null from icash_research_private.owner_export_preflights where id=$1',[concurrent.preflight]),true);
 assert.equal((await claim(runner,concurrent)).status,'cleanup_required');
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.owner_export_preflights where account_id=$1',[concurrent.account]),1);
 assert.deepEqual(await immutable(admin,concurrent),original);

 // Local quota denial records the request denial without spending a cleanup
 // attempt. Budget and advisory contention must also return promptly untouched.
 const waiting=await seed(admin,104);
 await admin.query('update public.fixture_cleanup_policy set quota=false');
 assert.equal(await value(runner,'select public.icash_claim_owner_preflight_cleanup(null)'),null,'Global cleanup still respects shared capacity admission');
 assert.equal((await admit(runner,waiting,1200)).status,'quota_wait');
 assert.equal(await attempts(admin,waiting),0);
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.requests where id=$1 and not admitted',[id(1200)]),1);
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.owner_preflight_cleanup_admissions where preflight_id=$1',[waiting.preflight]),0);
 await admin.query('update public.fixture_cleanup_policy set quota=true');
 await blocker.query('begin');await blocker.query('select 1 from public.icash_operating_budget where id=1 for update');
 try{assert.equal((await promptly(()=>admit(runner,waiting,1201),'Budget contention must be a bounded pending response')).status,'pending');}
 finally{await blocker.query('rollback');}
 await blocker.query('begin');await blocker.query("select pg_advisory_xact_lock(hashtextextended('owner-preflight:'||$1::uuid,0))",[waiting.account]);
 try{assert.equal((await promptly(()=>admit(runner,waiting,1202),'Account contention must be a bounded pending response')).status,'pending');}
 finally{await blocker.query('rollback');}
 assert.equal(await attempts(admin,waiting),0);
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.requests where id=any($1::uuid[])',[[id(1201),id(1202)]]),0);

 // The ordinary renewal holds the account advisory and original row before it
 // waits for budget. Targeted admission must yield before taking either lock.
 const renewing=await seed(admin,105),beforeRenewal=await immutable(admin,renewing);
 const deletion=await admit(runner,renewing,1300);
 assert.equal(deletion.status,'admitted');
 assert.equal(await record(runner,renewing,deletion,successfulReceipt),true);
 await blocker.query('begin');await blocker.query('select 1 from public.icash_operating_budget where id=1 for update');
 const pid=await value(runner,'select pg_backend_pid()');
 const renewal=claim(runner,renewing);let renewalResult;
 try{
  await waitForLock(admin,pid);
  assert.equal((await promptly(()=>admit(other,renewing,1301),'Targeted cleanup must yield to the original renewal advisory')).status,'pending');
 }finally{await blocker.query('rollback');renewalResult=await renewal;}
 assert.equal(renewalResult.status,'create');
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.owner_export_preflights where supersedes=$1',[renewing.preflight]),1);
 assert.deepEqual(await immutable(admin,renewing),beforeRenewal);
 assert.equal((await claim(other,renewing)).status,'pending','A fresh immutable generation is not recreated');
 assert.equal(await value(admin,'select count(*)::int from icash_research_private.requests where id=$1',[id(1301)]),0);
 assert.equal(await value(admin,'select count(*)::int from public.fixture_ready_admissions'),0,'No paid export boundary is invoked');
 console.log('PASS native owner-preflight cleanup: serialized one-time activation, single admission, bounded advisory/budget/FIFO contention, unchanged FIFO, unknown-result hold, denied-attempt preservation, immutable ordinary renewal and no paid requests.');
}finally{
 await Promise.allSettled(clients.map(async client=>{try{await client.query('rollback');}finally{await client.end();}}));
}
