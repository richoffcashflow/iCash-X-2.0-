import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
import {runClosingSourceFixture,sourceCase,recordConfirmation,confirmation,requestCancellation,closingMetadata} from '../tests/fixtures/closing-original-source-fixture.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const clients=[];let pending;
async function connect(name){
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'closing-source-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);await c.query("set statement_timeout='12s';set lock_timeout='8s';set timezone='UTC'");c.exec=sql=>c.query(sql);return c;
}
async function blocked(db,waiter,holder){
 const waiting=(await waiter.query('select pg_backend_pid() pid')).rows[0].pid;
 return async work=>{
  const holding=(await holder.query('select pg_backend_pid() pid')).rows[0].pid;
  pending=work();pending.catch(()=>{});let found=false;
  for(const end=Date.now()+4000;Date.now()<end;){
   const row=(await db.query('select wait_event_type,$2::int=any(pg_blocking_pids(pid)) held from pg_stat_activity where pid=$1',[waiting,holding])).rows[0];
   if(row?.wait_event_type==='Lock'&&row.held){found=true;break;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert(found,'Expected visible native lock contention');
 };
}
async function resolved(){const result=await pending;pending=null;return result;}
try{
 const db=await connect('admin'),first=await connect('first'),second=await connect('second');
 await db.exec('drop schema if exists icash_closing_source_private cascade;drop schema if exists icash_title_inbound_private cascade;drop schema if exists auth cascade;drop schema public cascade;create schema public');
 await db.exec('create schema if not exists supabase_migrations;create table if not exists supabase_migrations.schema_migrations(version text primary key);insert into supabase_migrations.schema_migrations values(\'closing-receipt-fixture\')');
 await runClosingSourceFixture(db,{beforeMigration:async(migration,before)=>{
  await first.query('begin;select pg_advisory_xact_lock(726341927)');
  await assert.rejects(db.exec('begin;'+migration+'commit;'),e=>e.code==='55P03');await db.query('rollback');await first.query('rollback');
  assert.deepEqual(await closingMetadata(db),before);
  await assert.rejects(db.exec('begin;'+migration+"insert into supabase_migrations.schema_migrations values('closing-receipt-fixture');commit;"),e=>e.code==='23505');await db.query('rollback');
  assert.deepEqual(await closingMetadata(db),before,'A migration receipt failure rolls back function changes');
  assert.equal((await db.query("select to_regnamespace('icash_closing_source_private') found")).rows[0].found,null);
  assert.equal((await db.query("select count(*)::int n from pg_attribute where attrelid='icash_closing_updates'::regclass and attname='agreement_envelope_id' and not attisdropped")).rows[0].n,0);
 }});
 // Begin the email while a cancellation transaction owns only the budget. The
 // insert must wait BEFORE its deal FK obtains key-share; cancellation can then
 // lock the deal and complete without a budget/deal deadlock.
 const cancelled=await sourceCase(db),cancelBody=confirmation({date:await cancelled.date(),agreement:cancelled.assignment});
 await first.query('begin;select 1 from icash_operating_budget where id=1 for update');await second.query('begin;set local role service_role');
 await (await blocked(db,second,first))(()=>recordConfirmation(second,cancelled,cancelBody));
 const cancellation=await requestCancellation(first,cancelled);await first.query('commit');
 const heldReply=await resolved();await second.query('commit');
 let state=await cancelled.state();assert.equal(state.deal.stage,'cancellation_pending');assert(!state.updates.some(u=>u.kind==='closed'));assert(state.tasks.some(t=>t.reply_id===heldReply.id));
 assert.equal((await db.query('select state from icash_agreement_cancellations where id=$1',[cancellation])).rows[0].state,'pending');
 // Reverse ordering: committed current closing wins, and the real cancellation
 // request must reread that terminal state after its budget wait.
 const closed=await sourceCase(db),closeBody=confirmation({date:await closed.date(),agreement:closed.assignment});
 await first.query('begin;set local role service_role');await recordConfirmation(first,closed,closeBody);await second.query('begin;set local role service_role');
 await (await blocked(db,second,first))(()=>requestCancellation(second,closed));await first.query('commit');
 await assert.rejects(resolved(),/Deal cannot be cancelled/);pending=null;await second.query('rollback');
 state=await closed.state();assert.equal(state.deal.stage,'closed');assert.equal(state.updates.filter(u=>u.kind==='closed').length,1);
 assert.equal((await db.query('select count(*)::int n from icash_agreement_cancellations where deal_id=$1',[closed.deal])).rows[0].n,0);
 // A queued original email must not bind itself to a replacement installed by
 // the winning cancellation transaction. Use actual request/check/finish RPCs.
 const replaced=await sourceCase(db),oldBody=confirmation({date:await replaced.date(),agreement:replaced.assignment}),originalAt=await replaced.sourceTime();
 await first.query('begin;select 1 from icash_operating_budget where id=1 for update');await second.query('begin;set local role service_role');
 await (await blocked(db,second,first))(()=>recordConfirmation(second,replaced,oldBody,{source:{providerReceivedAt:originalAt}}));
 const cancelId=await requestCancellation(first,replaced);
 await first.query("select icash_record_cancellation_check($1,$2,$3,$4,$5,'completed',true)",[replaced.account,replaced.owner,cancelId,replaced.assignment,'fixture-'+replaced.assignment]);
 assert.equal((await first.query("select icash_finish_cancellation($1,$2,$3,true,'Fixture signed release','Fixture deposit/title resolution') ok",[replaced.account,replaced.owner,cancelId])).rows[0].ok,true);
 const replacementId=randomUUID();
 await first.query(`insert into icash_signing_envelopes select $2::uuid,account_id,deal_id,kind,'completed',test_mode,jsonb_set(terms,'{assignee}','"Replacement race buyer"'),terms_hash,'fixture-'||$2::text,provider_status,
  jsonb_set(jsonb_set(provider_evidence,'{id}',to_jsonb('fixture-'||$2::text)),'{metadata,icash_envelope}',to_jsonb($2::text)),recipients,clock_timestamp(),clock_timestamp() from icash_signing_envelopes where id=$1`,[replaced.assignment,replacementId]);
 await first.query("update icash_deal_files set stage='title_open',terms=(select terms from icash_signing_envelopes where id=$2),assignment_signed_at=clock_timestamp() where id=$1",[replaced.deal,replacementId]);
 await first.query("insert into icash_buyer_deposit_receipts(account_id,deal_id,envelope_id,terms_hash,amount_cents,method,reference,confirmed_by,request_key) values($1,$2,$3,$4,200000,'check','Fixture current replacement deposit',$5,$6)",[replaced.account,replaced.deal,replacementId,'a'.repeat(64),replaced.owner,randomUUID()]);
 await first.query('commit');const stale=await resolved();await second.query('commit');
 state=await replaced.state();assert.equal(state.deal.stage,'title_open');assert(!state.updates.some(u=>u.kind==='closed'));assert(state.tasks.some(t=>t.reply_id===stale.id));assert.equal(new Date(stale.original_source.providerReceivedAt).getTime(),new Date(originalAt).getTime());
 assert.equal((await db.query('select state from icash_signing_envelopes where id=$1',[replaced.assignment])).rows[0].state,'cancelled');
 assert.equal((await db.query('select count(*)::int n from icash_buyer_deposit_receipts where deal_id=$1',[replaced.deal])).rows[0].n,2,'Original and replacement deposit evidence remain distinct');
 console.log('PASS native closing source: bounded shared migration lock, receipt rollback, cancellation-first, closing-first, and cancellation/replacement during queued original title ingress. No provider calls or production writes.');
}catch(e){console.error(e.message,e.code,e.where,e.stack);process.exitCode=1;}finally{
 if(clients[1])await clients[1].query('rollback').catch(()=>{});if(pending)await pending.catch(()=>{});
 await Promise.allSettled(clients.map(async c=>{try{await c.query('rollback');}finally{await c.end();}}));
}
