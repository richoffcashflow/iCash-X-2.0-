import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {databaseAdapter,loadService} from './helpers/simulated-journey-services.mjs';
const pg=await PGlite.create(),{db,q}=databaseAdapter(pg),id='10000000-0000-4000-8000-000000000001';
const now=Date.now(),end=Math.floor(now/1000)+3*86400,version='legacy-trial-2026-10-25.1';
const sub={id:'sub_fixture',livemode:true,metadata:{icash_legacy_trial:version,icash_membership:id},status:'trialing',cancel_at_period_end:false,cancel_at:null,trial_end:end,customer:'cus_fixture',discounts:[],schedule:null,pending_update:null,items:{has_more:false,data:[{quantity:1,price:{unit_amount:5000,currency:'usd',recurring:{interval:'month',interval_count:1}}}]}};
let customer={id:'cus_fixture',livemode:true,email:'fixture@example.invalid'},reads=0,sends=[],fail=false;
const stripe={subscriptions:{retrieve:async()=>{reads++;return structuredClone(sub);}},customers:{retrieve:async()=>structuredClone(customer)}};
const env={VERCEL_ENV:'production',ICASH_AUTH_EMAIL_READY:'true',RESEND_API_KEY:'fixture'};
const transport=async(url,request)=>{assert.equal(url,'https://api.resend.com/emails');sends.push(request);if(fail)throw Error('Simulated unknown provider outcome');return Response.json({id:'20000000-0000-4000-8000-000000000001'});};
const service=await loadService('lib/legacy-trial-reminder.ts',{database:db,fundingStripe:()=>stripe,legacyTrialVersion:version});
const send=options=>service.sendLegacyTrialReminder('sub_fixture',{db,stripe,env,transport,now,...options});
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table icash_memberships(id uuid primary key,mode text,state text,price_cents bigint,legacy_trial_offer text,legacy_trial_end timestamptz,legacy_trial_started_at timestamptz,stripe_subscription_id text,stripe_customer_id text,checkout_email text,payer_email text,paid_through timestamptz,cancel_at_period_end boolean);
 create table icash_email_suppressions(email text);create table icash_webinar_suppressions(email text,reason text);create table icash_purchase_access_emails(recipient text,delivery text);`);
 await q(`insert into icash_memberships values($1,'live','active',5000,$2,to_timestamp($3),now(),'sub_fixture','cus_fixture','fixture@example.invalid','fixture@example.invalid',to_timestamp($3),false)`,[id,version,end]);
 const file=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(f=>f.endsWith('_legacy_trial_ending_reminders.sql'));assert(file,'Generated migration present');
 await pg.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await pg.exec(`alter table icash_memberships add column vip_until timestamptz;
 create table icash_plan_changes(membership_id uuid,action text,state text,payment_id text,from_price bigint,to_price bigint,period_end timestamptz);`);
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261030195000_vip_trial_renewal_reminders.sql',import.meta.url),'utf8'));
 assert.equal((await send({env:{...env,VERCEL_ENV:'preview'}})).reason,'not_production');assert.equal(reads,0);assert.equal(sends.length,0);
 const terms=service.legacyTrialReminderMessage(customer.email,end);assert(terms.text.includes('$50 USD per month'));assert(terms.text.includes('UTC'));assert(terms.text.includes('Settings → Billing'));assert(terms.text.includes('credits are separate'));assert(!terms.text.includes('payment received'));
 customer.email='wrong@example.invalid';await assert.rejects(send(),/recipient mismatch/);assert.equal(sends.length,0);customer.email='fixture@example.invalid';
 sub.livemode=false;await assert.rejects(send(),/mode mismatch/);sub.livemode=true;
 sub.metadata.icash_legacy_trial='other';assert.equal((await send()).reason,'not_offer');sub.metadata.icash_legacy_trial=version;
 await q("update icash_memberships set state='inactive'");assert.equal((await send()).reason,'access_stopped');await q("update icash_memberships set state='active'");
 await q("update icash_memberships set stripe_subscription_id='sub_wrong'");await assert.rejects(send(),/binding mismatch/);await q("update icash_memberships set stripe_subscription_id='sub_fixture'");
 sub.cancel_at_period_end=true;assert.equal((await send()).reason,'not_due');sub.cancel_at_period_end=false;
 sub.items.data[0].price.unit_amount=10000;await assert.rejects(send(),/terms changed/);sub.items.data[0].price.unit_amount=5000;
 await q("insert into icash_email_suppressions values('fixture@example.invalid')");assert.equal((await send()).sent,false);assert.equal(sends.length,0);await pg.exec('truncate icash_email_suppressions');
 fail=true;await assert.rejects(send(),/Simulated unknown/);assert.equal(sends.length,1);const first=sends[0];
 await pg.exec("update icash_legacy_trial_reminders set state='sending',lease_until=now()+interval '2 minutes',claim_token=gen_random_uuid()");await assert.rejects(send(),/lease active/);assert.equal(sends.length,1,'Concurrent claims cannot send');await pg.exec("update icash_legacy_trial_reminders set state='pending',lease_until=null,claim_token=null");
 fail=false;assert.equal((await send()).sent,true);assert.equal(sends.length,2);assert.equal(sends[1].body,first.body);assert.equal(sends[1].headers['Idempotency-Key'],first.headers['Idempotency-Key']);
 assert.equal((await send()).sent,false);assert.equal(sends.length,2,'Duplicate event cannot resend');
 let row=(await q('select * from icash_legacy_trial_reminders')).rows[0];assert.equal(row.state,'sent');assert(row.provider_id);
 await pg.exec("update icash_legacy_trial_reminders set state='pending',provider_id=null,first_attempt_at=now()-interval '23 hours 1 second'");assert.equal((await send()).sent,false);assert.equal(sends.length,2,'Unknown receipt beyond idempotency window held');assert.equal((await q('select state from icash_legacy_trial_reminders')).rows[0].state,'held');
 await pg.exec("update icash_legacy_trial_reminders set state='pending',first_attempt_at=now(),message=message||'{\"text\":\"different\"}'::jsonb");await assert.rejects(send(),/immutable/);assert.equal(sends.length,2);
 // Verified paid VIP trials receive the current $100 renewal quote, never $50.
 await pg.exec('truncate icash_legacy_trial_reminders');
 await q('update icash_memberships set price_cents=10000,vip_until=legacy_trial_end');sub.items.data[0].price.unit_amount=10000;
 let before=sends.length;await assert.rejects(send(),/Paid trial VIP upgrade required/);assert.equal(sends.length,before);
 await q("insert into icash_plan_changes values($1,'upgrade','applied','pi_paid',5000,10000,to_timestamp($2))",[id,end]);
 fail=true;await assert.rejects(send(),/Simulated unknown/);const vipFirst=sends.at(-1);assert.match(JSON.parse(vipFirst.body).text,/renew at \$100 USD per month/);assert.match(JSON.parse(vipFirst.body).text,/first \$100 charge/);assert.doesNotMatch(JSON.parse(vipFirst.body).text,/\$50/);
 fail=false;assert.equal((await send()).sent,true);assert.equal(sends.at(-1).body,vipFirst.body);assert.equal(sends.at(-1).headers['Idempotency-Key'],vipFirst.headers['Idempotency-Key']);
 before=sends.length;assert.equal((await send()).sent,false);assert.equal(sends.length,before);
 // A downgrade after a reminder never rewrites or resends its original receipt.
 const saved=(await q('select message,state,provider_id from icash_legacy_trial_reminders')).rows[0];
 await q('update icash_memberships set price_cents=5000');sub.items.data[0].price.unit_amount=5000;
 assert.equal((await send()).sent,false);assert.equal(sends.length,before);assert.deepEqual((await q('select message,state,provider_id from icash_legacy_trial_reminders')).rows[0],saved);
 // Likewise, do not replay an uncertain $50 message after a paid VIP upgrade.
 await pg.exec('truncate icash_legacy_trial_reminders');fail=true;await assert.rejects(send(),/Simulated unknown/);fail=false;
 const unknown=(await q('select * from icash_legacy_trial_reminders')).rows[0];
 await q('update icash_memberships set price_cents=10000');sub.items.data[0].price.unit_amount=10000;before=sends.length;
 assert.equal((await send()).sent,false);assert.equal(sends.length,before);assert.deepEqual((await q('select * from icash_legacy_trial_reminders')).rows[0],unknown);
 // A price race between the canonical read and locked SQL claim fails closed.
 await pg.exec('truncate icash_legacy_trial_reminders');
 const racingDb=async(path,method,body)=>{if(path==='rpc/icash_claim_legacy_trial_reminder')await q('update icash_memberships set price_cents=5000');return db(path,method,body);};
 await assert.rejects(send({db:racingDb}),/renewal amount changed/);assert.equal(sends.length,before);assert.equal((await q('select count(*)::int n from icash_legacy_trial_reminders')).rows[0].n,0);
 await q('update icash_memberships set price_cents=10000,vip_until=null');await assert.rejects(send(),/terms changed/);assert.equal(sends.length,before);
 assert.throws(()=>service.legacyTrialReminderMessage(customer.email,end,7500),/Invalid trial reminder/);
 const grants=(await q("select has_function_privilege('anon','icash_claim_legacy_trial_reminder(uuid,text,timestamptz,jsonb)','execute') anon,has_function_privilege('authenticated','icash_finish_legacy_trial_reminder(uuid,uuid,uuid,boolean)','execute') authenticated,has_function_privilege('service_role','icash_claim_legacy_trial_reminder(uuid,text,timestamptz,jsonb)','execute') service")).rows[0];assert.deepEqual(grants,{anon:false,authenticated:false,service:true});
 assert.equal((await q("select has_table_privilege('anon','icash_legacy_trial_reminders','select') or has_table_privilege('authenticated','icash_legacy_trial_reminders','select') exposed")).rows[0].exposed,false);
 assert.equal((await q("select relrowsecurity from pg_class where oid='public.icash_legacy_trial_reminders'::regclass")).rows[0].relrowsecurity,true);
 console.log('PASS legacy trial reminder: real private SQL outbox, canonical live-only binding, exact UTC date/$50 or paid VIP $100/cancel text, suppression, immutable provider retry, durable duplicate prevention, expired-uncertain hold, price-race fence, preserved old-price receipts, preview no-send. No provider traffic.');
}finally{await pg.close();}
