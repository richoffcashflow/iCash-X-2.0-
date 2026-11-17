// Disposable local PostgreSQL only. No provider, production URL or environment credentials.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {setup,read,seed,value,receipt,original} from '../tests/helpers/signing-receipt-discovery-fixture.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const connection={host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',ssl:false,connectionTimeoutMillis:5000};
const admin=new Client(connection);await admin.connect();assert.equal(await value(admin,'select current_database()'),'icash_reliability');
const name='signing_receipt_fixture_'+randomBytes(8).toString('hex');await admin.query('create database '+name);
const connect=async()=>{const c=new Client({...connection,database:name});await c.connect();await c.query("set statement_timeout='20s';set lock_timeout='10s'");return c;};
const a=await connect(),b=await connect(),observer=await connect();
const blocked=async client=>{const pid=await value(client,'select pg_backend_pid()');return async()=>{for(let n=0;n<200;n++){if(await value(observer,'select cardinality(pg_blocking_pids($1))>0',[pid]))return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected a real PostgreSQL lock wait');};};
const waitB=await blocked(b),sql=read('config/signing-receipt-discovery.sql');
const note=async r=>value(a,'select icash_note_signing_checkpoint_failure($1,$2,$3,$4,$5,$6)',[r.account,r.envelope,r.provider,r.hash,await value(a,'select to_jsonb(t) from icash_signing_templates t where id=$1',[r.template]),await original(a,r)]);
const record=(client,r,s='awaiting_counterparty')=>value(client,'select icash_record_signing_receipt($1,$2,$3,$4,$5,$6,false)',[r.account,r.envelope,r.provider,r.hash,s,receipt(r,s)]);
try{
 await a.query(setup);
 await a.query('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key)');
 // A failed ledger receipt must roll back the entire schema/body switch.
 await a.query("insert into supabase_migrations.schema_migrations values('fixture')");
 await a.query('begin');await a.query(sql);await assert.rejects(()=>a.query("insert into supabase_migrations.schema_migrations values('fixture')"),/duplicate key/);await a.query('rollback');
 assert.equal(await value(a,"select to_regnamespace('icash_signing_receipt_private')"),null);
 await a.query('begin');await a.query('select pg_advisory_xact_lock(726341927)');
 const competing=b.query('begin').then(()=>b.query(sql));await waitB();await a.query('commit');await competing;await b.query("insert into supabase_migrations.schema_migrations values('receipt')");await b.query('commit');
 assert.equal(await value(a,"select count(*)::int from supabase_migrations.schema_migrations where version='receipt'"),1);
 const ordinary=await seed(a,1),old=await seed(a,2,{age:46}),review=await seed(a,3,{state:'needs_review'});
 await a.query('begin');assert(await value(a,'select icash_issue_due_signing_result()'));
 assert.equal(await value(b,'select icash_issue_due_signing_result()'),null,'competing selector skips held fairness turn without duplicate tickets');await a.query('commit');
 assert(await value(b,'select icash_issue_due_signing_result()'));assert(await value(b,'select icash_issue_due_signing_result()'));
 assert.deepEqual((await a.query('select kind from icash_automation_tickets order by created_at,id')).rows.map(r=>r.kind),['signing_receipt','signing_result','signing_receipt'],'bounded selectors alternate recovery and ordinary work');
 await a.query("update icash_signing_envelopes set next_poll_at=now()-interval '1 minute' where id=$1",[old.envelope]);
 await a.query('begin');await a.query('select 1 from icash_signing_envelopes where id=$1 for update',[old.envelope]);
 assert.equal(await value(b,'select icash_issue_due_signing_result()'),null,'locked original is skipped, never duplicated');await a.query('rollback');
 for(const [n,change]of [[11,'terms'],[12,'pause'],[13,'manual'],[14,'template'],[15,'owner'],[16,'envelope']]){
  const r=await seed(a,n);assert(await note(r));
  if(change==='manual')await a.query('insert into icash_property_controls(account_id,property_id,manual) values($1,$2,false)',[r.account,r.deal]);
  await a.query('begin');
  if(change==='terms')await a.query("update icash_deal_files set terms=terms||'{\"priceCents\":500000}' where id=$1",[r.deal]);
  if(change==='pause')await a.query('update icash_accounts set bot_paused=true where id=$1',[r.account]);
  if(change==='manual')await a.query('update icash_property_controls set manual=true where account_id=$1',[r.account]);
  if(change==='template')await a.query("update icash_signing_templates set reviewed_until=reviewed_until+interval '1 day' where id=$1",[r.template]);
  if(change==='owner')await a.query('update icash_accounts set owner_user_id=null where id=$1',[r.account]);
  if(change==='envelope')await a.query("update icash_signing_envelopes set state='needs_review' where id=$1",[r.envelope]);
  const pending=record(b,r);await waitB();await a.query('commit');assert.equal(await pending,'needs_review','concurrent '+change+' survives recheck');
 }
 const cancelled=await seed(a,20);assert(await note(cancelled));
 await a.query('begin');await a.query('select 1 from icash_operating_budget where id=1 for update');
 await a.query("update icash_deal_files set stage='cancellation_pending' where id=$1",[cancelled.deal]);
 await a.query("update icash_signing_envelopes set state='cancellation_pending' where id=$1",[cancelled.envelope]);
 await a.query("insert into icash_agreement_cancellations(id,account_id,deal_id,state,snapshot) values($1,$2,$3,'pending',$4)",[cancelled.deal,cancelled.account,cancelled.deal,JSON.stringify([{id:cancelled.envelope}])]);
 const late=record(b,cancelled,'completed');await waitB();await a.query('commit');assert.equal(await late,'cancellation_pending');
 assert.equal(await value(a,'select requires_release from icash_agreement_cancellations where id=$1',[cancelled.deal]),true,'late original completion is retained through the existing cancellation saver');
 assert.equal(await value(a,'select count(*)::int from icash_signature_authorizations'),0);assert.equal(await value(a,'select count(*)::int from icash_operation_spend where charged_cents is not null'),0);
 const success=await seed(a,21);assert(await note(success));await a.query('begin');
 assert.equal(await record(a,success),'awaiting_counterparty');const current=await value(a,'select to_jsonb(e) from icash_signing_envelopes e where id=$1',[success.envelope]);
 assert.equal(current.provider_id,success.provider);await a.query('rollback');assert.equal(await value(a,'select state from icash_signing_envelopes where id=$1',[success.envelope]),'needs_review','unknown transaction outcome does not mint a durable resume');
 console.log('Native PostgreSQL signing discovery: transactional ledger rollback, competing migration/selection, fair bounded lanes, current owner/terms/Pause/manual/template edits, cancellation late evidence and rollback pass.');
}finally{await Promise.allSettled([a.query('rollback'),b.query('rollback')]);await Promise.all([a.end(),b.end(),observer.end()]);await admin.query('drop database '+name);await admin.end();}
