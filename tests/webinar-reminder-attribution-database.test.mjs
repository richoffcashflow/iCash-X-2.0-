import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const pg=await PGlite.create(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sql=readFileSync(new URL('../config/webinar-reminder-attribution.sql',import.meta.url),'utf8');
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_webinar_visitors(id uuid primary key,email text,phone text,funding_guest_hash text,account_id uuid,measurement jsonb default '{}');
 create table icash_webinar_sessions(id uuid primary key,visitor_id uuid,is_preview boolean default false,updated_at timestamptz default now());
 create table icash_webinar_events(session_id uuid,kind text);
 create table icash_webinar_outbox(id uuid primary key,visitor_id uuid,session_id uuid,channel text,recipient text,state text,created_at timestamptz default now(),sent_at timestamptz,first_attempt_at timestamptz);
 create table icash_memberships(id uuid primary key,mode text,state text,guest_hash text,account_id uuid,stripe_session_id text);
 create table icash_membership_invoices(stripe_invoice_id text primary key,membership_id uuid,stripe_payment_id text,amount_cents bigint,period_end timestamptz,recorded_at timestamptz default now());
 create table icash_plan_changes(membership_id uuid,account_id uuid,action text,state text,payment_id text,from_price bigint,to_price bigint,applied_at timestamptz,session_id text);
 create table icash_billing_reviews(payment_id text);`);
 const migration=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_webinar_reminder_attribution.sql'));
 assert(migration);assert.equal(readFileSync(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'),sql);await pg.exec(sql);
 const q=(s,a=[])=>pg.query(s,a),value=async(s,a=[])=>(await q(s,a)).rows[0].value;
 const results=()=>value('select icash_webinar_reminder_results($1) as value',[[id(10),id(11)]]);
 assert.equal((await results()).overall.clickedPeople,0,'No historical clicks are inferred from delivered messages');
 for(const n of [1,2]){
  await q('insert into icash_webinar_visitors(id,email,phone,funding_guest_hash) values($1,$2,$3,$4)',[id(n),`person${n}@example.invalid`,`+1212555010${n}`,`guest${n}`]);
  await q('insert into icash_webinar_sessions(id,visitor_id) values($1,$2)',[id(n+100),id(n)]);
 }
 const job=async(n,channel='sms',visitor=1,state='delivered')=>q("insert into icash_webinar_outbox(id,visitor_id,session_id,channel,recipient,state,sent_at,first_attempt_at) values($1,$2,$3,$4,$5,$6,case when $6='delivered' then now()-interval '10 minutes' end,case when $6='delivered' then now()-interval '10 minutes' end)",[id(n),id(visitor),id(visitor+100),channel,channel==='sms'?`+1212555010${visitor}`:`person${visitor}@example.invalid`,state]);
 await job(10);await job(11,'email');await job(12,'email',2,'pending');
 const open=(j,n,v=1)=>value('select icash_webinar_open_reminder($1,$2,$3) as value',[id(j),id(n),id(v)]);
 const confirm=(n,v=1,action='visit',session=null)=>value('select icash_webinar_confirm_reminder($1,$2,$3,$4) as value',[id(n),id(v),action,session===null?null:id(session)]);
 const age=(n,age='2 minutes')=>q('update icash_webinar_reminder_visits set opened_at=now()-$2::interval where id=$1',[id(n),age]);
 const bind=(n,checkout='cs_live_member',v=1)=>value('select icash_webinar_bind_reminder_checkout($1,$2,$3) as value',[id(n),id(v),checkout]);
 assert.equal(await open(10,20),true);assert.equal(await open(10,20),true);
 assert.equal(await open(11,20),false,'A visit ID cannot be rebound to another message');
 assert.equal(await open(10,21,2),false,'Wrong visitor cannot record a click');
 assert.equal(await open(12,22,2),false,'Queued, unattempted messages cannot be clicked');
 await q('update icash_webinar_sessions set is_preview=true where id=$1',[id(101)]);assert.equal(await open(10,23),false);await q('update icash_webinar_sessions set is_preview=false where id=$1',[id(101)]);
 assert.equal(await confirm(20),false,'Immediate scanners cannot confirm a page at redirect time');await age(20);
 assert.equal(await confirm(20,2),false);assert.equal(await confirm(20),true);assert.equal(await confirm(20),true);
 assert.equal(await confirm(20,1,'watch',102),false,'Another visitor session is excluded');
 assert.equal(await confirm(20,1,'watch',101),false,'Opening a page is not playback');
 await q("insert into icash_webinar_events values($1,'started')",[id(101)]);
 assert.equal(await confirm(20,1,'watch',101),true);assert.equal(await confirm(20,1,'watch',101),true);
 let r=await results();assert.equal(r.overall.linkOpens,1);assert.equal(r.overall.clickedPeople,1);assert.equal(r.overall.returnedPeople,1);assert.equal(r.overall.deliveredMessages,2);assert.equal(r.overall.queuedMessages,1);
 await q("insert into icash_memberships values($1,'live','pending','guest1',null,'cs_live_member')",[id(30)]);
 assert.equal(await bind(20),true);assert.equal(await bind(20),true);assert.equal(await bind(20,'cs_live_member',2),false);
 assert.equal(await bind(20,'cs_test_member'),false);assert.equal(await bind(20,'cs_live_workcredits'),false);
 await q("insert into icash_memberships values($1,'live','pending','guest2',null,'cs_live_other')",[id(31)]);assert.equal(await bind(20,'cs_live_other'),false,'Cannot attach someone else’s checkout');
 assert.equal((await results()).overall.checkoutPeople,1);
 const invoice=(member,label,days=30,offset='0 seconds')=>q("insert into icash_membership_invoices values($1,$2,$3,5000,now()+$4*interval '1 day',now()+$5::interval)",['in_'+label,id(member),'pi_'+label,days,offset]);
 await invoice(30,'first');await invoice(30,'renewal',60);
 let purchases=(await q('select * from icash_webinar_reminder_purchases()')).rows;
 assert.equal(purchases.length,1);assert.equal(purchases[0].job_id,id(10));assert.equal(purchases[0].payment_id,'pi_first');
 // A more recent confirmed email click attached before payment takes credit once.
 await open(11,24);await age(24,'1 minute');await confirm(24);await bind(24);
 await q("update icash_membership_invoices set recorded_at=now() where stripe_invoice_id='in_first'");
 purchases=(await q('select * from icash_webinar_reminder_purchases()')).rows;assert.equal(purchases.length,1);assert.equal(purchases[0].job_id,id(11));
 r=await results();assert.equal(r.overall.clickedPeople,1,'Email/text contacts deduplicate overall');assert.equal(r.overall.purchases,1);assert.equal(r.overall.revenueCents,5000);assert.equal(r.channels.find(c=>c.channel==='sms').purchases,0);assert.equal(r.channels.find(c=>c.channel==='email').purchases,1);assert.equal(r.jobs.find(j=>j.jobId===id(11)).purchases,1);
 await q("insert into icash_plan_changes values($1,null,'upgrade','pending',null,5000,10000,null,'cs_live_vip')",[id(30)]);
 assert.equal(await bind(24,'cs_live_vip'),true);
 await q("update icash_plan_changes set state='applied',payment_id='pi_vip',applied_at=now() where session_id='cs_live_vip'");
 r=await results();assert.equal(r.overall.purchases,2);assert.equal(r.overall.vipPurchases,1);assert.equal(r.overall.membershipPurchases,1);
 await q("insert into icash_billing_reviews values('pi_vip')");assert.equal((await results()).overall.purchases,1,'Refund/dispute review excludes the affected sale');
 // A payment already settled before the browser confirmed cannot be backfilled.
 await q("update icash_membership_invoices set recorded_at=now()-interval '1 hour' where stripe_invoice_id='in_first'");assert.equal((await results()).overall.purchases,0);
 await q("update icash_membership_invoices set recorded_at=now() where stripe_invoice_id='in_first'");
 await age(20,'8 days');await age(24,'8 days');assert.equal(await confirm(20),false);assert.equal(await bind(24),false);assert.equal((await results()).overall.purchases,0,'Attribution expires seven days after the click');
 await age(20);await age(24,'1 minute');
 await q("update icash_webinar_visitors set measurement='{"+'"opt_out_at":"2026-10-18T00:00:00Z"'+"}' where id=$1",[id(1)]);
 assert.equal(await open(10,25),false);assert.equal(await confirm(20),false);assert.equal(await bind(20),false);assert.equal((await results()).overall.purchases,0);
 await q("update icash_webinar_visitors set measurement='{}' where id=$1",[id(1)]);
 await q("update icash_memberships set mode='test' where id=$1",[id(30)]);assert.equal((await results()).overall.purchases,0,'Test-mode billing is excluded');
 await q("update icash_memberships set mode='live' where id=$1",[id(30)]);
 await invoice(30,'older',-30,'-60 days');assert.equal((await results()).overall.purchases,0,'A renewal is not acquisition even when the initial invoice is old');
 // Aggregate totals must not be limited by the latest-100 activity list.
 for(let n=200;n<305;n++)await job(n,'email',2);
 assert.equal((await results()).overall.deliveredMessages,107);
 for(const role of ['anon','authenticated']){
  for(const name of ['icash_webinar_reminder_tracking','icash_webinar_reminder_visits','icash_webinar_reminder_checkouts'])assert.equal(await value('select has_table_privilege($1,$2,\'select,insert,update\') as value',[role,name]),false);
  for(const name of ['icash_webinar_open_reminder(uuid,uuid,uuid)','icash_webinar_confirm_reminder(uuid,uuid,text,uuid)','icash_webinar_bind_reminder_checkout(uuid,uuid,text)','icash_webinar_reminder_purchases()','icash_webinar_reminder_results(uuid[])'])assert.equal(await value('select has_function_privilege($1,$2,\'execute\') as value',[role,name]),false);
 }
 assert.equal((await q("select bool_and(relrowsecurity) as ok from pg_class where relname like 'icash_webinar_reminder_%' and relkind='r'")).rows[0].ok,true);
 console.log('PASS reminder attribution database: no fabricated history; private, owned and idempotent clicks/playback/checkouts; exact last-click payments; seven-day window; renewals, credits, tests, reviews and opt-outs excluded; complete channel totals.');
}finally{await pg.close();}
