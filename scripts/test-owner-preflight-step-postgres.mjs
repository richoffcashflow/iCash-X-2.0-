// Fixed localhost fixture only. Never accepts a production URL or credentials.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {stepSetup,migration} from '../tests/helpers/owner-preflight-step-fixture.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const database='icash_preflight_step_check',clients=[];
const connect=async(name,db=database)=>{
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:db,application_name:'step-capacity-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await c.query("set statement_timeout='8s';set lock_timeout='3s'");return c;
};
const v=async(c,s,a=[])=>Object.values((await c.query(s,a)).rows[0]??{})[0];
const claim=(c,x)=>v(c,'select icash_claim_owner_preflight($1,(select items from icash_research_private.owner_export_preflights where id=$2),(select request from icash_research_private.owner_export_preflights where id=$2))',[x.account,x.preflight]);
const take=(c,x,step)=>v(c,"select icash_take_dealmachine_request('owner_preview',$1,$2,gen_random_uuid())",[x.account,'owner-preflight:'+x.preflight+':'+step]);
try{
 const bootstrap=await connect('bootstrap','postgres');
 if(!await v(bootstrap,'select exists(select 1 from pg_database where datname=$1)',[database]))await bootstrap.query('create database icash_preflight_step_check');
 const admin=await connect('observer'),a=await connect('a'),b=await connect('b');
 assert.equal(await v(admin,'select current_database()'),database);
 await admin.query('drop schema if exists public cascade;create schema public;drop schema if exists icash_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema if exists icash_work_private cascade;');
 await admin.query(stepSetup());
 // Migration and its ledger are one transaction; a failed ledger cannot leave
 // altered selection or an active policy behind.
 const original=await v(admin,"select md5(pg_get_functiondef('icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure))");
 await assert.rejects(admin.query('begin;'+migration+"select 1/0;commit;"));await admin.query('rollback');
 assert.equal(await v(admin,"select to_regclass('icash_work_private.preflight_step_policy')"),null);
 assert.equal(await v(admin,"select md5(pg_get_functiondef('icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure))"),original);
 await admin.query('begin;'+migration+'commit;');
 const x=await v(admin,'select fixture_preflight_seed(7001,true)');
 await admin.query('update fixture_cleanup_policy set ordinary=2,starter=0');
 assert.equal((await claim(a,x)).status,'pending');
 const activations=await Promise.all([a,b].map(c=>v(c,"select icash_work_private.activate_preflight_step_capacity(repeat('b',40))")));
 assert.deepEqual(activations.sort(),[false,true]);
 // Same original list, concurrent handlers: one lease wins. No claim itself
 // consumes request capacity or creates a paid operation.
 const contenders=await Promise.all(Array.from({length:6},(_,n)=>connect('contender-'+n)));
 const outcomes=await Promise.all(contenders.map(c=>claim(c,x)));
 assert.equal(outcomes.filter(r=>r.status==='check').length,1);
 assert(outcomes.every(r=>['check','pending'].includes(r.status)));
 assert.equal(await v(admin,'select count(*)::int from icash_research_private.requests'),0);
 assert.equal(await v(admin,'select count(*)::int from icash_operation_spend'),0);
 // A competing request may consume the other token after the first count.
 // Final admission denies the remainder; selection cannot exceed the budget.
 assert.equal(await take(a,x,'baseline'),true);
 assert.equal(await take(b,x,'competing-fixture'),true);
 assert.equal(await take(a,x,'eligible'),false);
 assert.equal(await v(admin,'select ordinary from fixture_cleanup_policy'),0);
 assert.equal(await v(admin,'select count(*)::int from icash_research_private.requests where admitted'),2);
 assert.equal(await v(admin,'select count(*)::int from icash_research_private.requests where not admitted'),1);
 assert.equal(await v(admin,'select count(*)::int from icash_research_private.owner_export_preflights'),1,'No replacement ID or expired-list resurrection');
 // Real captured capacity functions delegate NULL accounts to zero starter
 // allowance. The protected pool cannot make the new ordinary path eligible.
 await admin.query('update fixture_cleanup_policy set ordinary=1,starter=3');
 assert.equal(await v(admin,'select icash_dealmachine_capacity_available(2)'),false);
 assert.equal(await v(admin,'select icash_dealmachine_capacity_available(2,$1)',[x.account]),true);
 const y=await v(admin,'select fixture_preflight_seed(7002,true)');
 assert.equal(await v(admin,'select icash_owner_preflight_step_capacity($1,$2)',[y.account,y.screening]),false);
 await admin.query('update fixture_cleanup_policy set ordinary=2,starter=0');
 await b.query('begin');await b.query('update icash_accounts set bot_paused=true where id=$1',[y.account]);await b.query('commit');
 assert.equal((await claim(a,y)).status,'held','A committed Pause wins the late original claim');
 await admin.query('update icash_accounts set bot_paused=false where id=$1',[y.account]);
 await admin.query('update icash_work_private.preflight_step_policy set enabled=false');
 assert.equal((await claim(a,y)).status,'pending','Rollback restores the original three-token requirement');
 assert.equal(await v(admin,'select count(*)::int from icash_operation_spend'),0);
 console.log('PASS native preflight phase: ledger rollback, concurrent activation and same-ID claims, ordinary-only two-token capacity, final admission contention, late Pause and rollback. Provider boundaries are synthetic.');
}catch(e){console.error(e);process.exitCode=1;}finally{await Promise.all(clients.map(c=>c.end().catch(()=>{})));}
