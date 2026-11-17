// Exact captured selector and synthetic rows on the disposable loopback database.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
import {install,definition,metadata,state,migration,candidateQuery,beforePredicate,afterPredicate,afterHash,planNodes,value,id} from '../tests/helpers/seller-opener-property-lookup-fixture.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg'),clients=[];
const connect=async name=>{
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'opener-property-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);
 await c.query("set statement_timeout='8s';set lock_timeout='5s';set timezone='UTC'");return c;
};
const reset=async c=>{await c.query('drop schema if exists icash_work_private cascade;drop schema public cascade;create schema public');await install(c);};
try{
 const admin=await connect('admin'),holder=await connect('holder'),observer=await connect('observer');await reset(admin);
 const before=await definition(admin),oldMetadata=await metadata(admin);
 await admin.query('select fixture_seed(n,1+n%32,true) from generate_series(1,8192)n');
 await admin.query(`insert into icash_property_controls select a.id,'other-'||n,n%512=0 from icash_accounts a cross join generate_series(1,512)n;
  insert into icash_property_controls select account_id,id::text,true from icash_text_threads where right(id::text,1)='9';
  update icash_screening_jobs set snapshot=snapshot||jsonb_build_object('opaque',repeat(md5(id::text),250));
  insert into icash_text_messages select id,account_id,id,now(),'delivered','outgoing','saved history' from icash_text_threads where right(id::text,1)::integer<7;
  analyze;`);
 const beforeState=await state(admin);
 // Both prepared plan modes must return the same exact ordered page. The new
 // plan must keep both key columns in the property-control index condition.
 const after=before.replaceAll(beforePredicate,afterPredicate),plans=[];
 for(const mode of ['force_generic_plan','force_custom_plan']){
  await admin.query(`set plan_cache_mode=${mode};prepare old_candidates(uuid) as ${candidateQuery(before)};prepare new_candidates(uuid) as ${candidateQuery(after)}`);
  for(const cursor of ['null',`'${id(1)}'`,`'${id(4000)}'`,`'${id(9000)}'`]){
   const old=(await admin.query(`execute old_candidates(${cursor})`)).rows;
   assert.deepEqual((await admin.query(`execute new_candidates(${cursor})`)).rows,old);
  }
  for(const variant of ['old','new']){
   const p=await value(admin,`explain(analyze,buffers,format json) execute ${variant}_candidates(null)`);
   const control=planNodes(p[0].Plan).filter(n=>n['Relation Name']==='icash_property_controls');
   assert(control.length);if(variant==='new')assert(control.every(n=>n['Index Cond']?.includes('account_id')&&n['Index Cond']?.includes('property_id')));
   plans.push({mode,variant,time:p[0]['Execution Time'],buffers:p[0].Plan['Shared Hit Blocks'],controlBuffers:control.reduce((n,p)=>n+(p['Shared Hit Blocks']??0),0)});
  }
  await admin.query('deallocate old_candidates;deallocate new_candidates');
 }
 assert.deepEqual(await state(admin),beforeState,'Plan tests cannot mutate queue, controls, cursor or funds');
 // Migration must refuse a persistently busy scheduler without partial changes.
 await holder.query('begin;select pg_advisory_xact_lock(726341927)');
 const started=performance.now();
 await assert.rejects(admin.query('begin;'+migration+'commit'),e=>e.code==='55P03');await admin.query('rollback');
 assert(performance.now()-started<4000);assert.equal(await definition(admin),before);assert.deepEqual(await metadata(admin),oldMetadata);
 await holder.query('rollback');
 await admin.query('begin;'+migration);await assert.rejects(admin.query('select 1/0'),e=>e.code==='22012');await admin.query('rollback');
 assert.equal(await definition(admin),before);assert.deepEqual(await state(admin),beforeState);
 await admin.query('begin;'+migration+'commit');assert.equal(await value(admin,'select md5($1)',[await definition(admin)]),afterHash);
 assert.deepEqual(await metadata(admin),oldMetadata);assert.deepEqual(await state(admin),beforeState);
 // Later statements in an existing reader transaction still observe committed
 // current controls. There is no account or transaction cache in the fence.
 await observer.query('begin');const target=(await observer.query(candidateQuery(after),[null])).rows[0];assert(target);
 await holder.query('insert into icash_property_controls values($1,$2,true) on conflict(account_id,property_id) do update set manual=true',[target.account_id,target.id]);
 assert(!(await observer.query(candidateQuery(after),[null])).rows.some(r=>r.id===target.id));
 await holder.query('update icash_property_controls set manual=false where account_id=$1 and property_id=$2',[target.account_id,target.id]);
 assert((await observer.query(candidateQuery(after),[null])).rows.some(r=>r.id===target.id));await observer.query('rollback');
 // Real competing calls retain the same shared cursor and one issued message.
 await reset(admin);await admin.query('begin;'+migration+'commit');await admin.query('select fixture_seed(1,1,true)');
 const racers=await Promise.all(Array.from({length:12},(_,i)=>connect('race'+i)));
 const results=await Promise.all(racers.map(c=>value(c,'select public.icash_next_before_sms_inbound_campaign()')));
 assert.equal(results.filter(r=>r?.token).length,1);
 assert.equal(await value(admin,'select count(*)::int from icash_text_messages'),1);
 assert.equal(await value(admin,'select count(*)::int from icash_automation_tickets'),1);
 assert.equal(await value(admin,'select last_thread_id from icash_work_private.seller_opener_scan'),id(1));
 assert.deepEqual((await admin.query('select balance_cents,reserved_cents from icash_wallets')).rows,[{balance_cents:'10000',reserved_cents:'100'}]);
 console.log(JSON.stringify({result:'PASS native seller property lookup',plans,concurrentIssuers:12,issued:1,afterHash}));
}finally{await Promise.all(clients.map(c=>c.end()));}
