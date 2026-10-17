import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {browserPurchase,metaPurchasePayload} from '../lib/webinar-meta-policy.ts';
const pg=await PGlite.create(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sql=name=>readFileSync(new URL('../config/'+name+'.sql',import.meta.url),'utf8');
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_memberships(id uuid primary key,mode text,guest_hash text,account_id uuid,stripe_session_id text);
 create table icash_membership_invoices(stripe_invoice_id text primary key,membership_id uuid,stripe_payment_id text,amount_cents bigint,period_end timestamptz,recorded_at timestamptz);
 create table icash_plan_changes(membership_id uuid,account_id uuid,action text,state text,payment_id text,from_price bigint,to_price bigint,applied_at timestamptz,session_id text);
 create table icash_billing_reviews(payment_id text);
 create table icash_webinar_visitors(id uuid primary key,email text,funding_guest_hash text,account_id uuid,marketing_consent_at timestamptz,measurement jsonb not null default '{}');
 create table icash_webinar_sessions(id uuid primary key,visitor_id uuid,is_preview boolean,created_at timestamptz);
 create table icash_webinar_events(session_id uuid,kind text,created_at timestamptz);
 create table icash_webinar_settings(id int,config jsonb);
 create table icash_webinar_meta_events(event_id text primary key,payment_id text unique,visitor_id uuid,session_id uuid not null,value_cents bigint,occurred_at timestamptz,state text default 'pending',payload jsonb,due_at timestamptz default now(),attempts int default 0,claimed_at timestamptz);
 insert into icash_webinar_settings values(1,'{"meta":{"enabled":true}}');`);
 await pg.exec(sql('webinar-meta-checkout-purchases'));await pg.exec(sql('webinar-automatic-measurement'));
 const migration=readdirSync(new URL('../supabase/migrations',import.meta.url)).find(n=>n.endsWith('_direct_checkout_meta_purchases.sql'));
 assert(migration);assert.equal(readFileSync(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'),sql('direct-checkout-meta-purchases'));
 await pg.exec(sql('direct-checkout-meta-purchases'));
 const q=(s,args=[])=>pg.query(s,args);
 for(const n of [1,2,3])await q('insert into icash_webinar_visitors(id) values($1)',[id(n)]);
 const access=async(n,action='automatic')=>(await q('select icash_webinar_measurement_access($1,$2,true,false,\'{}\') as identity',[id(n),action])).rows[0].identity;
 const identity=await access(1);await access(2);
 for(const [checkout,n] of [['cs_live_direct',1],['cs_live_vip',1],['cs_live_unpaid',1],['cs_live_denied',2],['cs_live_late',3]]){
  await q('select icash_bind_checkout_measurement($1,$2)',[checkout,id(n)]);
  await q('select icash_bind_checkout_measurement($1,$2)',[checkout,id(n)]);
 }
 assert.equal((await q('select count(*) from icash_checkout_measurement')).rows[0].count,5,'Retries do not duplicate checkout bindings');
 for(const [n,checkout,mode] of [[10,'direct','live'],[11,'unpaid','live'],[12,'denied','live'],[13,'late','live'],[14,'direct','test']])await q('insert into icash_memberships values($1,$2,null,null,$3)',[id(n),mode,'cs_live_'+checkout]);
 const invoice=async(n,label,amount,days=30)=>q('insert into icash_membership_invoices values($1,$2,$3,$4,now()+$5*interval \'1 day\',now())',['in_'+label,id(n),'pi_'+label,amount,days]);
 await invoice(10,'direct',4500);await invoice(10,'renewal',5000,60);await invoice(12,'denied',5000);await invoice(13,'late',5000);await invoice(14,'test',5000);
 await access(2,'deny');await access(3); // Later permission cannot backdate a purchase.
 await q("insert into icash_plan_changes values($1,$2,'upgrade','applied','pi_vip',5000,10000,now(),'cs_live_vip'),($1,$2,'upgrade','pending',null,5000,10000,null,'cs_live_unpaid')",[id(10),id(20)]);
 await q('select icash_webinar_sync_purchases()');await q('select icash_webinar_sync_purchases()');
 const events=(await q('select * from icash_webinar_meta_events order by payment_id')).rows;
 assert.deepEqual(events.map(e=>[e.payment_id,Number(e.value_cents),e.session_id,e.visitor_id,e.purchase_kind]),[['pi_direct',4500,null,id(1),'membership'],['pi_vip',5000,null,id(1),'vip_upgrade']]);
 assert.equal((await q('select count(*) from icash_webinar_sessions')).rows[0].count,0,'Checkout never fabricates a webinar start');
 const event={...events[0],value_cents:4500,occurred_at:events[0].occurred_at.toISOString()};
 const browser=browserPurchase(event),server=metaPurchasePayload(event,identity,'https://www.geticashx.com');
 assert.equal(browser.eventId,server.event_id);assert.equal(browser.data.value,45);assert.equal(server.custom_data.currency,'USD');assert.equal(server.event_source_url,'https://www.geticashx.com/join');
 assert.equal((await q('select * from icash_webinar_claim_meta()')).rows.length,2,'Direct purchases enter the same server delivery queue');
 await q("insert into icash_billing_reviews values('pi_vip')");await q('select icash_webinar_sync_purchases()');
 assert.equal((await q("select state from icash_webinar_meta_events where payment_id='pi_vip'")).rows[0].state,'canceled');
 await access(1,'deny');assert.equal((await q('select * from icash_webinar_claim_meta()')).rows.length,0);
 for(const role of ['anon','authenticated']){
  assert.equal((await q("select has_function_privilege($1,'icash_bind_checkout_measurement(text,uuid)','execute') as allowed",[role])).rows[0].allowed,false);
  assert.equal((await q("select has_table_privilege($1,'icash_checkout_measurement','select,insert') as allowed",[role])).rows[0].allowed,false);
 }
 console.log('PASS direct Purchase: verified Standard/VIP receipts, exact values, no webinar required, shared browser/server IDs, retries, unpaid/test/renewal exclusion, privacy timing, opt-out and service-only bindings.');
}finally{await pg.close();}
