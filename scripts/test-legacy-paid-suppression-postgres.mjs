// Synthetic native transactions; never uses environment database URLs.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {install,seed,migration,id,receipt,value} from '../tests/helpers/legacy-paid-suppression-fixture.mjs';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg'),clients=[];
async function connect(){const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability'});clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);await c.query("set statement_timeout='8s';set lock_timeout='8s'");return c;}
try{
 const a=await connect(),b=await connect(),c=await connect();
 await a.query('drop schema public cascade;create schema public');
 await a.query("do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;create role authenticated;create role service_role;end if;end$$");
 await install(a);await seed(a);
 // Old trigger fans out to an unrelated locked contact in the same launch.
 await a.query("insert into icash_memberships(id,mode,payer_email) values($1,'live','unrelated1@example.invalid')",[id(200)]);
 await a.query('alter table icash_membership_invoices disable trigger icash_legacy_invoice_stop');await receipt(a,id(200),'unrelated');await a.query('alter table icash_membership_invoices enable trigger icash_legacy_invoice_stop');
 await b.query('begin');await b.query("select 1 from icash_legacy_contacts where email='unrelated1@example.invalid' for update");
 await a.query("set statement_timeout='300ms'");
 await assert.rejects(receipt(a,id(101),'before'),e=>e.code==='57014');
 assert.equal(await value(a,"select count(*)::int v from icash_membership_invoices where stripe_invoice_id='before'"),0);
 await a.query("set statement_timeout='8s'");await a.query('begin;'+migration+'commit');
 await receipt(a,id(101),'after');await b.query('rollback');
 assert.equal(await value(a,'select membership_id v from icash_legacy_contacts where id=$1',[id(12)]),id(101));
 assert.equal(await value(a,"select converted_at v from icash_legacy_contacts where email='unrelated1@example.invalid'"),null,'Unrelated receipt is left to separate maintenance');
 // Matching row cannot be skipped: fail atomically, then one normal fixture retry.
 await b.query('begin');await b.query('select 1 from icash_legacy_contacts where id=$1 for update',[id(10)]);
 await assert.rejects(receipt(a,id(100),'locked'),e=>e.code==='55P03');
 assert.equal(await value(a,"select count(*)::int v from icash_membership_invoices where stripe_invoice_id='locked'"),0);await b.query('rollback');
 // Dispatch owns the queued row. No inverse-lock wait and no partial conversion.
 await b.query('begin');await b.query("select 1 from icash_legacy_outbox where contact_id=$1 and state='queued' for update",[id(10)]);
 await assert.rejects(receipt(a,id(100),'dispatch'),e=>e.code==='55P03');
 assert.equal(await value(a,'select converted_at v from icash_legacy_contacts where id=$1',[id(10)]),null);
 await b.query("update icash_legacy_outbox set state='sending' where contact_id=$1 and state='queued'",[id(10)]);await b.query('commit');
 await a.query('begin');await receipt(a,id(100),'winner');
 await assert.rejects(receipt(c,id(100),'concurrent'),e=>e.code==='55P03');await a.query('commit');await receipt(c,id(100),'concurrent');
 assert.equal(await value(a,"select count(*)::int v from icash_legacy_outbox where contact_id=$1 and state='sending'",[id(10)]),2);
 assert.equal(await value(a,"select icash_legacy_authorize(id) v from icash_legacy_outbox where contact_id=$1 and step_id='queued'",[id(10)]),null,'Final authorization still refuses paid contact');
 // Opt-out races remain fail-visible, preserve original reason, cancel queued only.
 await b.query('begin');await b.query("update icash_legacy_contacts set suppressed_reason='SMS opt-out',stopped_at=now() where id=$1",[id(11)]);
 await assert.rejects(receipt(a,id(100),'optout'),e=>e.code==='55P03');await b.query('commit');await receipt(a,id(100),'optout');
 assert.equal(await value(a,'select suppressed_reason v from icash_legacy_contacts where id=$1',[id(11)]),'SMS opt-out');
 assert.equal(await value(a,"select count(*)::int v from icash_legacy_outbox where state='uncertain'"),3);
 await a.query("insert into icash_memberships(id,mode,payer_email,payer_phone) select gen_random_uuid(),'live','other'||n||'@example.invalid','+1212'||lpad(n::text,7,'0') from generate_series(1,10000)n");
 await a.query('analyze icash_memberships;analyze icash_legacy_contacts');
 const plan=async sql=>JSON.stringify((await a.query('explain (analyze,format json) '+sql)).rows);
 assert.match(await plan("select id from icash_legacy_contacts where email='buyer@example.invalid'"),/icash_legacy_contacts_payment_email/);
 assert.match(await plan("select id from icash_memberships where mode='live' and lower(trim(payer_email))='buyer@example.invalid'"),/icash_memberships_legacy_live_email_norm_idx/);
 assert.match(await plan("select id from icash_memberships where mode='live' and payer_phone='+12125550101'"),/icash_memberships_legacy_live_phone_idx/);
 console.log('PASS native paid suppression: reproduced old unrelated-lock timeout; new exact scope, fail-visible matching/dispatch locks, concurrent receipts, opt-out preservation and atomic rollback');
}finally{for(const c of clients)await c.end();}
