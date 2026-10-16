import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const pg=await PGlite.create(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_memberships(id uuid primary key,mode text,guest_hash text,account_id uuid);
 create table icash_membership_invoices(stripe_invoice_id text primary key,membership_id uuid,stripe_payment_id text,amount_cents bigint,period_end timestamptz,recorded_at timestamptz);
 create table icash_plan_changes(membership_id uuid,account_id uuid,action text,state text,payment_id text,from_price bigint,to_price bigint,applied_at timestamptz);
 create table icash_funding_orders(stripe_payment_id text,mode text,state text,price_cents bigint,paid_at timestamptz);
 create table icash_billing_reviews(payment_id text);
 create table icash_webinar_visitors(id uuid primary key,funding_guest_hash text,account_id uuid,marketing_consent_at timestamptz);
 create table icash_webinar_sessions(id uuid primary key,visitor_id uuid,is_preview boolean,created_at timestamptz);
 create table icash_webinar_events(session_id uuid,kind text,created_at timestamptz);
 create table icash_webinar_settings(id int,config jsonb);
 create table icash_webinar_meta_events(event_id text primary key,payment_id text unique,visitor_id uuid,session_id uuid,value_cents bigint,occurred_at timestamptz,state text default 'pending',payload jsonb);
 insert into icash_webinar_settings values(1,'{"meta":{"enabled":true}}');`);
 const q=(sql,args=[])=>pg.query(sql,args);
 await q("insert into icash_webinar_visitors values($1,'guest',$2,now()-interval '4 days'),($3,'other',null,now()-interval '4 days')",[id(1),id(2),id(3)]);
 for(const [n,visitor,preview,age,started] of [[4,1,false,3,true],[5,1,false,2,true],[6,1,true,1,true],[7,1,false,1,false],[8,3,false,1,true]]){
  await q("insert into icash_webinar_sessions values($1,$2,$3,now()-$4*interval '1 day')",[id(n),id(visitor),preview,age]);
  if(started)await q("insert into icash_webinar_events values($1,'started',now()-$2*interval '1 day')",[id(n),age]);
 }
 await q("insert into icash_memberships values($1,'live','guest',$2),($3,'test','guest',$2),($4,'live','guest',$2)",[id(10),id(2),id(11),id(12)]);
 await q(`insert into icash_membership_invoices values
 ('in_initial',$1,'pi_initial',4500,now()+interval '30 days',now()-interval '1 hour'),
 ('in_renewal',$1,'pi_renewal',5000,now()+interval '60 days',now()),
 ('in_test',$2,'pi_test',5000,now()+interval '30 days',now()),
 ('in_old',$3,'pi_old',5000,now()-interval '30 days',now()-interval '60 days'),
 ('in_rebill',$3,'pi_rebill',5000,now()+interval '30 days',now())`,[id(10),id(11),id(12)]);
 await q(`insert into icash_plan_changes values
 ($1,$2,'upgrade','applied','pi_vip',5000,10000,now()),
 ($1,$2,'upgrade','pending','pi_unpaid',5000,10000,null),
 ($1,$2,'retain_vip','applied',null,10000,5000,now()),
 ($3,$2,'upgrade','applied','pi_test_vip',5000,10000,now())`,[id(10),id(2),id(11)]);
 await pg.exec("insert into icash_funding_orders values('pi_credits','live','paid',10000,now())");
 for(const [payment,state] of [['pi_initial','pending'],['pi_renewal','pending'],['pi_credits','sending'],['pi_historical','sent']])await q("insert into icash_webinar_meta_events values($1,$2,$3,$4,5000,now(),$5,'{}')",['webinar:purchase:'+payment,payment,id(1),id(5),state]);
 const sql=readFileSync(new URL('../config/webinar-meta-checkout-purchases.sql',import.meta.url),'utf8');
 const migration=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_webinar_meta_checkout_purchases.sql'));
 assert(migration);assert.equal(sql,readFileSync(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));await pg.exec(sql);
 const payments=(await q('select * from icash_webinar_meta_purchases() order by payment_id')).rows;
 assert.deepEqual(payments.map(p=>[p.payment_id,Number(p.value_cents),p.purchase_kind,p.session_id,p.visitor_id]),[
  ['pi_initial',4500,'membership',id(5),id(1)],['pi_vip',5000,'vip_upgrade',id(5),id(1)]
 ],'Only first verified live invoice and paid VIP upgrade; last started real session, no email-only matches, test, renewals or credits');
 const states=Object.fromEntries((await q('select payment_id,state from icash_webinar_meta_events')).rows.map(r=>[r.payment_id,r.state]));
 assert.equal(states.pi_credits,'canceled');assert.equal(states.pi_renewal,'canceled');assert.equal(states.pi_historical,'sent','Sent history is retained');
 await q('select icash_webinar_sync_purchases($1)',[id(3)]);assert.equal((await q("select * from icash_webinar_meta_events where payment_id='pi_vip'")).rows.length,0,'Visitor lookup cannot sync someone else');
 await q('select icash_webinar_sync_purchases($1)',[id(1)]);await q('select icash_webinar_sync_purchases($1)',[id(1)]);
 assert.equal((await q("select * from icash_webinar_meta_events where state='pending'")).rows.length,2,'Reload/retry keeps exactly two purchases');
 await pg.exec("insert into icash_billing_reviews values('pi_vip')");await q('select icash_webinar_sync_purchases()');
 assert.equal((await q("select state from icash_webinar_meta_events where payment_id='pi_vip'")).rows[0].state,'canceled');
 await q('update icash_webinar_visitors set marketing_consent_at=null where id=$1',[id(1)]);await q('select icash_webinar_sync_purchases()');
 assert.equal((await q("select state from icash_webinar_meta_events where payment_id='pi_initial'")).rows[0].state,'canceled');
 await pg.exec('delete from icash_webinar_meta_events');await q('update icash_webinar_visitors set marketing_consent_at=now() where id=$1',[id(1)]);await q('select icash_webinar_sync_purchases()');
 assert.equal((await q('select * from icash_webinar_meta_events')).rows.length,0,'New consent cannot backdate a past purchase');
 for(const role of ['anon','authenticated'])for(const fn of ['icash_webinar_meta_purchases()','icash_webinar_sync_purchases(uuid)'])assert.equal((await q('select has_function_privilege($1,$2,\'execute\') as allowed',[role,fn])).rows[0].allowed,false);
 console.log('PASS webinar Meta receipts: verified initial + VIP values, attribution, duplicate/retry, credits/renewal/test/preview exclusions, reviews, consent timing and service-only grants.');
}finally{await pg.close();}
