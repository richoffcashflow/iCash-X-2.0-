import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {install,seed,migration,read,id,receipt,value} from './helpers/legacy-paid-suppression-fixture.mjs';
const db=await PGlite.create();
try{
 await db.exec('create role anon;create role authenticated;create role service_role');
 await install(db);
 assert.equal(await value(db,"select md5(pg_get_functiondef('icash_legacy_payment_stop()'::regprocedure)) v"),'ca896a455cc82ced8ef9eb1e1d49615d');
 const sync=await value(db,"select pg_get_functiondef('icash_legacy_sync(uuid)'::regprocedure) v");
 await db.exec('begin;'+migration+'commit;');
 assert.equal(migration,read('supabase/migrations/20261116185311_legacy_paid_suppression_scope.sql'));
 assert.equal(await value(db,"select pg_get_functiondef('icash_legacy_sync(uuid)'::regprocedure) v"),sync);
 await seed(db);
 await db.query("insert into icash_legacy_contacts(id,launch_id,phone) values($1,$2,'+12125550101')",[id(15),id(2)]);
 await receipt(db,id(102),'test');
 assert.equal(await value(db,'select count(*)::int v from icash_legacy_contacts where converted_at is not null'),0);
 await receipt(db,id(101),'bound');
 assert.equal(await value(db,'select membership_id v from icash_legacy_contacts where id=$1',[id(12)]),id(101));
 // Historical receipt exists before payer identity: later payer update must use it.
 await db.query("insert into icash_memberships(id,mode) values($1,'live')",[id(103)]);
 await receipt(db,id(103),'historical','2025-01-01T00:00:00Z');
 await db.query("insert into icash_billing_reviews values('payment_historical')");
 await db.query("update icash_legacy_contacts set suppressed_reason='Original opt-out',stopped_at='2024-01-01',replied_at='2024-01-01' where id=$1",[id(10)]);
 await db.query("update icash_memberships set payer_email='buyer@example.invalid' where id=$1",[id(103)]);
 await receipt(db,id(100),'new');await receipt(db,id(100),'new');
 const rows=(await db.query('select id,membership_id,suppressed_reason,stopped_at from icash_legacy_contacts where id=any($1::uuid[]) order by id',[[id(10),id(11)]])).rows;
 assert(rows.every(r=>r.membership_id===id(103)));
 assert.equal(rows[0].suppressed_reason,'Original opt-out');assert.equal(rows[0].stopped_at.toISOString(),'2024-01-01T00:00:00.000Z');
 assert.equal(rows[1].suppressed_reason,'Refund or dispute in billing history');
 assert.equal(await value(db,'select count(*)::int v from icash_legacy_contacts where converted_at is not null'),4);
 assert.equal(await value(db,"select count(*)::int v from icash_legacy_outbox where state='queued'"),0);
 for(const s of ['sending','uncertain','accepted','delivered','failed'])assert.equal(await value(db,'select count(*)::int v from icash_legacy_outbox where state=$1',[s]),3);
 // A later-arriving older receipt must not rewrite an existing conversion.
 await receipt(db,id(100),'older','2020-01-01T00:00:00Z');assert.equal(await value(db,'select membership_id v from icash_legacy_contacts where id=$1',[id(10)]),id(103));
 // A newer triggering membership must discover an older bound-only receipt.
 await db.query("insert into icash_memberships(id,mode,payer_email) values($1,'live','historic-other@example.invalid'),($2,'live','late-contact@example.invalid')",[id(105),id(106)]);
 await receipt(db,id(105),'bound_history','2019-01-01T00:00:00Z');
 await db.query("insert into icash_billing_reviews values('payment_bound_history')");
 await db.query("insert into icash_legacy_contacts(id,launch_id,email) values($1,$2,'late-contact@example.invalid')",[id(16),id(1)]);
 await db.query('insert into icash_legacy_checkouts(contact_id,membership_id) values($1,$2)',[id(16),id(105)]);
 await receipt(db,id(106),'new_trigger');
 assert.equal(await value(db,'select membership_id v from icash_legacy_contacts where id=$1',[id(16)]),id(105));
 assert.equal(await value(db,'select suppressed_reason v from icash_legacy_contacts where id=$1',[id(16)]),'Refund or dispute in billing history');
 // Rollback retains neither receipt nor conversion, and restores queued history.
 await db.query("insert into icash_memberships(id,mode,payer_email) values($1,'live','rollback@example.invalid')",[id(104)]);
 await db.query("insert into icash_legacy_contacts(id,launch_id,email) values($1,$2,'rollback@example.invalid')",[id(14),id(1)]);
 await db.exec('begin');await receipt(db,id(104),'rollback');await db.exec('rollback');
 assert.equal(await value(db,'select converted_at v from icash_legacy_contacts where id=$1',[id(14)]),null);
 assert.equal(await value(db,"select count(*)::int v from icash_membership_invoices where stripe_invoice_id='rollback'"),0);
 for(const role of ['anon','authenticated'])assert.equal(await value(db,"select has_function_privilege($1,'icash_legacy_payment_stop()','execute') v",[role]),false);
 console.log('PASS scoped paid suppression: 5000 unrelated contacts, binding/email, live/test, reordered historical receipts/reviews, immutable conversions/holds, outbox history and rollback');
}finally{await db.close();}
