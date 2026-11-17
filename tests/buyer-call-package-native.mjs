// Disposable loopback PostgreSQL only; no provider or production connection.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {setup,enable,api,migration,id,source,projection,started,ended,incoming} from './helpers/buyer-call-package-fixture.mjs';
assert.equal(process.env.BUYER_CALL_PACKAGE_NATIVE_TEST,'1');
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const connection={host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',connectionTimeoutMillis:5000};
const database='buyer_call_package_'+randomBytes(8).toString('hex'),clients=[];
const connect=async db=>{const c=new Client({...connection,database:db});await c.connect();await c.query("set statement_timeout='8s';set lock_timeout='5s'");return c;};
const wrap=c=>({exec:sql=>c.query(sql),query:(sql,args)=>c.query(sql,args)});
const admin=await connect('postgres');
try{
 await admin.query('create database '+database);
 const main=await connect(database),a=await connect(database),b=await connect(database);clients.push(main,a,b);
 const pg=wrap(main),aa=api(wrap(a)),bb=api(wrap(b)),m=api(pg);await setup(pg);
 const pidB=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
 const blocked=async()=>{for(let n=0;n<200;n++){if((await main.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[pidB])).rows[0]?.blocked)return;await new Promise(r=>setTimeout(r,10));}assert.fail('Expected lock not observed');};
 await main.query('create table fixture_ledger(version text primary key)');
 await a.query('begin');await a.query(migration);await a.query("insert into fixture_ledger values('adapter')");await assert.rejects(a.query("insert into fixture_ledger values('adapter')"),/duplicate key/);await a.query('rollback');
 assert.equal((await main.query("select to_regnamespace('icash_buyer_call_package_private') x")).rows[0].x,null);
 await a.query('begin');await a.query(migration);await a.query("insert into fixture_ledger values('adapter')");
 await b.query('begin');const install=assert.rejects(b.query(migration),/prerequisite changed/);await blocked();
 assert((await main.query("select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) x",[pidB])).rows[0].x);
 await a.query('commit');await install;await b.query('rollback');assert.equal((await main.query('select count(*)::int n from fixture_ledger')).rows[0].n,1);await enable(pg);

 // Two reconciliations of the same completed conversation create one action.
 await a.query('begin');assert.equal(await aa.capture(),'recorded');const capture=bb.capture();await blocked();await a.query('commit');assert.equal(await capture,'recorded');
 assert.equal((await main.query('select count(*)::int n from icash_buyer_call_package_private.actions')).rows[0].n,1);
 await a.query('begin');const first=await aa.claim();assert(first);const next=bb.claim();await blocked();await a.query('commit');assert.equal(await next,null);
 await main.query('update fixture_gates set admit=true');await a.query('begin');assert(await aa.final(first.messageId));
 const concurrent=bb.final(first.messageId);await blocked();await a.query('commit');assert.equal(await concurrent,null);
 assert.equal((await main.query('select admissions from fixture_gates')).rows[0].admissions,1);

 const seed=async (n,full=source,noFollowup=false)=>{
  const session=id(1000+n),thread=id(2000+n),followup=id(3000+n),phone='+1214555'+String(n).padStart(4,'0'),conv='conv_fixture'+n;
  await main.query("insert into icash_text_threads(id,account_id,deal_id,party,recipient) values($1,$2,$3,'buyer',$4)",[thread,id(1),id(2),phone]);
  await main.query('insert into icash_recorded_reception_private.sessions(id,account_id,conversation_id,from_phone,to_phone,call_sid,provider_account_sid,created_at,call_started_at,call_ended_at,register_claimed_at) values($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$8)',[session,id(1),conv,phone,'+12145550102','CAfixture'+n,'ACfixture',started,ended]);
  await main.query('insert into icash_recorded_reception_private.buyer_bindings values($1,$2,$3,$4)',[session,id(1),id(2),thread]);
  await main.query('insert into icash_recorded_reception_private.buyer_history values($1,$2,$3,$4,$5,$6)',[session,id(1),id(3),conv,ended,JSON.stringify(projection(full))]);
  if(!noFollowup)await main.query("insert into icash_buyer_viewing_requests(id,account_id,deal_id,screening_id,thread_id,source,source_id,kind,state,quote,coordination_quote) values($1,$2,$3,$4,$5,'call',$6,'buyer_followup','needs_confirmation',$7,$7)",[followup,id(1),id(2),id(3),thread,session,source.turns[1].message]);
  assert.equal(await m.capture(full,session,conv),'recorded');const claim=await m.claim();assert(claim);
  return {session,thread,followup,phone,conv,message:claim.messageId};
 };
 const due=session=>main.query("update icash_buyer_call_package_private.actions set next_attempt_at=now()-interval '1 minute' where session_id=$1",[session]);
 const followup=key=>main.query('select state,quote,title_quote,reviewed_at from icash_buyer_viewing_requests where id=$1',[key]).then(x=>x.rows[0]);

 // New durable reply/call and cleared-funds state win the same budget lock.
 for(const kind of ['reply','call','reservation']){
  const x=await seed({reply:1,call:2,reservation:3}[kind]);await a.query('begin');await a.query('select 1 from icash_operating_budget where id=1 for update');
  if(kind==='reply')await a.query("insert into icash_text_messages(account_id,thread_id,direction,state,body) values($1,$2,'incoming','received','Never mind')",[id(1),x.thread]);
  if(kind==='call')await a.query('insert into icash_recorded_reception_private.sessions(id,account_id,from_phone,created_at) values($1,$2,$3,now())',[id(9000),id(1),x.phone]);
  if(kind==='reservation')await a.query('update fixture_gates set reserved=true');
  const after=bb.final(x.message);await blocked();await a.query('commit');assert.equal(await after,null,kind);
  await main.query('update fixture_gates set reserved=false');
 }
 const stop=await seed(4);await a.query('begin');await a.query('select pg_advisory_xact_lock(hashtextextended($1,74))',[stop.phone]);
 await a.query('insert into icash_text_suppressions values($1)',[stop.phone]);const afterStop=bb.final(stop.message);await blocked();await a.query('commit');assert.equal(await afterStop,null);

 // Commit a source edit while the inherited claim is waiting on its original
 // text row. Final recheck must roll back both dispatch and financial reservation.
 for(const kind of ['followup','package','new_followup']){
  const x=await seed({followup:10,package:11,new_followup:12}[kind],source,kind==='new_followup');
  const before=(await main.query('select admissions from fixture_gates')).rows[0].admissions;
  await a.query('begin');await a.query('select 1 from icash_text_messages where id=$1 for update',[x.message]);
  const pending=bb.final(x.message);await blocked();
  if(kind==='followup')await main.query("update icash_buyer_viewing_requests set quote='Changed during admission',title_quote='Use new title company' where id=$1",[x.followup]);
  if(kind==='package')await main.query("update icash_buyer_package_links set token=repeat('b',32)");
  if(kind==='new_followup')await main.query("insert into icash_buyer_viewing_requests(id,account_id,deal_id,thread_id,source,source_id,quote) values($1,$2,$3,$4,'call',$5,'New work')",[x.followup,id(1),id(2),x.thread,x.session]);
  await a.query('commit');assert.equal(await pending,null,kind);
  assert.equal((await main.query('select state from icash_text_messages where id=$1',[x.message])).rows[0].state,'ready');
  assert.equal((await main.query('select count(*)::int n from fixture_reservations where message_id=$1',[x.message])).rows[0].n,0);
  assert.equal((await main.query('select admissions from fixture_gates')).rows[0].admissions,before);
  if(kind==='package')await main.query("update icash_buyer_package_links set token=repeat('a',32)");
 }
 // A completed final claim owns the captured row until commit. A later manual
 // edit cannot commit between the final snapshot check and claim commit.
 const locked=await seed(13);await a.query('begin');assert(await aa.final(locked.message));
 const laterEdit=b.query("update icash_buyer_viewing_requests set title_quote='Later manual request' where id=$1",[locked.followup]);
 await blocked();await a.query('commit');await laterEdit;

 // A full-source conflict that shares the first/last display transcript is
 // durable and wins the budget lock before final admission.
 const full=structuredClone(source);full.turns=Array.from({length:120},(_,n)=>({role:n%2?'user':'agent',message:n===61?'Please send me the photos':'Thank you.',seconds:n}));
 const conflicted=await seed(14,full),changed=structuredClone(full);changed.turns[71].message="Don't send anything.";
 assert.deepEqual(projection(changed),projection(full));await a.query('begin');assert.equal(await aa.capture(changed,conflicted.session,conflicted.conv),'source_conflict');
 const afterConflict=bb.final(conflicted.message);await blocked();await a.query('commit');assert.equal(await afterConflict,null);
 assert.equal(await m.capture(full,conflicted.session,conflicted.conv),'source_conflict');
 assert.equal((await main.query('select state from icash_text_messages where id=$1',[conflicted.message])).rows[0].state,'ready');

 // Accepted is unresolved. Delivery alone closes only the exact untouched row.
 const delivered=await seed(5);await main.query("update icash_text_messages set state='accepted',provider_id='receipt' where id=$1",[delivered.message]);
 await due(delivered.session);assert.equal(await m.claim(),null);assert.equal((await followup(delivered.followup)).state,'needs_confirmation');
 await a.query('begin');await a.query("update icash_text_messages set state='delivered' where id=$1",[delivered.message]);
 const receiptClaim=bb.final(delivered.message); // Accepted was already terminal to dispatch; it cannot resend.
 assert.equal(await receiptClaim,null);await a.query('commit');await due(delivered.session);assert.equal(await m.claim(),null);
 const saved=await followup(delivered.followup);assert.equal(saved.state,'reviewed');assert(saved.reviewed_at);
 await due(delivered.session);assert.equal(await m.claim(),null);assert.deepEqual(await followup(delivered.followup),saved,'Duplicate receipt does not reopen or rewrite');

 // Receipt-versus-manual-edit race: the conditional snapshot update rechecks
 // the row after its lock wait and cannot overwrite the newer human request.
 const manual=await seed(6);await main.query("update icash_text_messages set state='delivered',provider_id='receipt' where id=$1",[manual.message]);await due(manual.session);
 await a.query('begin');await a.query("update icash_buyer_viewing_requests set quote='New title request',title_quote='Use new title company' where id=$1",[manual.followup]);
 const complete=bb.claim();await blocked();await a.query('commit');assert.equal(await complete,null);
 assert.deepEqual(await followup(manual.followup),{state:'needs_confirmation',quote:'New title request',title_quote:'Use new title company',reviewed_at:null});
 const late=await seed(7);await main.query("insert into icash_text_messages(account_id,thread_id,direction,state,body) values($1,$2,'incoming','received','I have a different request')",[id(1),late.thread]);
 await main.query("update icash_text_messages set state='delivered',provider_id='late-receipt' where id=$1",[late.message]);await due(late.session);assert.equal(await m.claim(),null);assert.equal((await followup(late.followup)).state,'needs_confirmation');
 assert.equal((await followup(manual.followup)).quote,'New title request','Unrelated followup preserved');

 await main.query("insert into icash_recorded_reception_private.sessions(id,account_id,from_phone,created_at) select gen_random_uuid(),$1,'+1555555'||lpad(n::text,4,'0'),now() from generate_series(1,4000) n",[id(1)]);await main.query('analyze icash_recorded_reception_private.sessions');
 const plan=(await main.query('explain (format json) select 1 from icash_recorded_reception_private.sessions where account_id=$1 and from_phone=$2 and created_at>=$3',[id(1),late.phone,started])).rows;
 assert(JSON.stringify(plan).includes('recorded_reception_buyer_source_clock'));
 console.log('PASS native call-package: atomic install, concurrent source/claim, newer reply/call/STOP/reservation races, accepted vs delivered, manual dispatch rollback/row serialization, durable middle-source conflict, manual/late/duplicate receipts and indexed lookup.');
}finally{await Promise.allSettled(clients.map(c=>c.end()));await admin.query('drop database if exists '+database+' with (force)');await admin.end();}
