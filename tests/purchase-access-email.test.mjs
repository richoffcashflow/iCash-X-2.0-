import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {databaseAdapter} from './helpers/simulated-journey-services.mjs';
import {purchaseAccessMessage,processPurchaseAccessEmails,recordPurchaseEmailDelivery} from '../lib/purchase-access-email.ts';

const pg=await PGlite.create();
const {db,rpc,q}=databaseAdapter(pg);
const env={VERCEL_ENV:'production',ICASH_AUTH_EMAIL_READY:'true',RESEND_API_KEY:'fixture',RESEND_RECEIVING_WEBHOOK_SECRET:'fixture'};
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table icash_memberships(id uuid primary key,mode text,state text default 'active',paid_through timestamptz,payer_email text,post_purchase_webinar_id uuid,stripe_subscription_id text,stripe_customer_id text,payer_phone text,updated_at timestamptz,price_cents bigint default 5000,retention_requested_at timestamptz,retention_discount_id text,retention_started_at timestamptz,retention_ends_at timestamptz,account_id uuid);
 create table icash_membership_invoices(stripe_invoice_id text primary key,membership_id uuid references icash_memberships,amount_cents bigint,stripe_payment_id text,period_end timestamptz,recorded_at timestamptz default now());
 create table icash_billing_reviews(payment_id text,resolved_at timestamptz);
 create table icash_accounts(id uuid,bot_paused boolean);
 create table icash_email_suppressions(email text,reason text);
 create table icash_webinar_suppressions(email text,reason text);
 create table icash_webinars(id uuid primary key,parent_webinar_id uuid,config jsonb);`);
 const settlement=readFileSync(new URL('../supabase/migrations/20261006194302_immediate_membership_cancellation_and_retention.sql',import.meta.url),'utf8').match(/create function public\.icash_settle_membership_invoice_v2[\s\S]*?end \$\$;/)[0];
 await pg.exec(settlement);
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261017145924_purchase_access_email.sql',import.meta.url),'utf8'));
 const vip=randomUUID();await q("insert into icash_webinars values($1,$2,'{\"status\":\"published\",\"videoUrl\":\"https://video.invalid/vip\"}')",[vip,randomUUID()]);
 async function membership(mode='live',state='active',address='buyer@example.invalid'){
  const id=randomUUID();await q('insert into icash_memberships(id,mode,state,payer_email,post_purchase_webinar_id) values($1,$2,$3,$4,$5)',[id,mode,state,address,vip]);return id;
 }
 async function settle(id,invoice='in_'+id.replaceAll('-',''),amount=5000){
  return rpc('icash_settle_membership_invoice_v2',{p_membership:id,p_subscription:'sub_'+id.replaceAll('-',''),p_customer:'cus_'+id.replaceAll('-',''),p_invoice:invoice,p_payment:'pi_'+invoice.slice(3),p_amount:amount,p_email:(await q('select payer_email from icash_memberships where id=$1',[id])).rows[0].payer_email,p_phone:null,p_period_end:'2099-02-01T00:00:00Z',p_period_start:'2099-01-01T00:00:00Z',p_discount:null});
 }
 const row=async id=>(await q('select * from icash_purchase_access_emails where membership_id=$1',[id])).rows[0];
 const first=await membership();await assert.rejects(()=>settle(first,undefined,100));assert.equal(await row(first),undefined,'An unverified amount cannot enqueue');
 await settle(first);await settle(first);await settle(first,'in_renewal');assert.equal((await q('select count(*)::int as n from icash_purchase_access_emails')).rows[0].n,1,'Duplicates and renewals do not resend');
 const test=await membership('test');await settle(test);assert.equal(await row(test),undefined);
 const free=await membership();await q("update icash_memberships set paid_through=now()+interval '1 month' where id=$1",[free]);assert.equal(await row(free),undefined,'No invoice means no purchase confirmation');
 const previewCalls=[];await processPurchaseAccessEmails({db:async()=>previewCalls.push(1),env:{...env,VERCEL_ENV:'preview'}});assert.equal(previewCalls.length,0);
 let sends=[];const receipts=new Map();let loseResponse=true;
 const transport=async(url,options)=>{
  assert.equal(url,'https://api.resend.com/emails');sends.push(options);const key=options.headers['Idempotency-Key'];if(!receipts.has(key))receipts.set(key,randomUUID());
  if(loseResponse){loseResponse=false;throw Error('Receipt lost after provider accepted');}
  return Response.json({id:receipts.get(key)});
 };
 await processPurchaseAccessEmails({db,env,transport,membershipId:first});assert.equal((await row(first)).status,'pending');
 await q("update icash_purchase_access_emails set next_attempt_at=now()-interval '1 second' where membership_id=$1",[first]);
 await processPurchaseAccessEmails({db,env,transport,membershipId:first});assert.equal((await row(first)).status,'sent');assert.equal(sends.length,2);assert.equal(receipts.size,1,'Only one provider delivery across a timeout');assert.equal(sends[0].body,sends[1].body,'Retries freeze the exact payload');
 await processPurchaseAccessEmails({db,env,transport,membershipId:first});assert.equal(sends.length,2,'Refresh/webhook repeats do not resend');
 const message=JSON.parse(sends[0].body);assert(message.text.includes('same email'));assert(message.text.includes('destination=vip'));assert(message.text.includes('do not need to pay again'));assert(!message.text.includes('code='));assert.equal(message.to[0],'buyer@example.invalid');assert(message.html.includes('lang="en"'));
 const firstRow=await row(first);
 await recordPurchaseEmailDelivery({type:'email.delivered',data:{email_id:firstRow.provider_id,to:['other@example.invalid'],tags:{icash_purchase_email_id:firstRow.id}}},db);assert.equal((await row(first)).delivery,null,'A mismatched recipient cannot attach a receipt');
 await recordPurchaseEmailDelivery({type:'email.bounced',data:{email_id:firstRow.provider_id,to:['buyer@example.invalid'],tags:{icash_purchase_email_id:firstRow.id}}},db);
 await recordPurchaseEmailDelivery({type:'email.delivered',data:{email_id:firstRow.provider_id,to:['buyer@example.invalid'],tags:{icash_purchase_email_id:firstRow.id}}},db);assert.equal((await row(first)).delivery,'bounced','Out-of-order delivery never erases a bounce');
 const blocked=await membership();await settle(blocked);await processPurchaseAccessEmails({db,env,transport,membershipId:blocked});assert.equal((await row(blocked)).status,'canceled');assert.equal(sends.length,2);
 const pending=await membership('live','pending','pending@example.invalid');await settle(pending);assert.equal(await rpc('icash_claim_purchase_access_email',{p_membership:pending}),null);assert.equal((await row(pending)).status,'pending','An invoice/subscription race does not lose the email');
 await q("update icash_memberships set state='active' where id=$1",[pending]);await q("update icash_purchase_access_emails set next_attempt_at=now()-interval '1 second' where membership_id=$1",[pending]);
 const claim=await rpc('icash_claim_purchase_access_email',{p_membership:pending});assert(claim);assert.equal(await rpc('icash_claim_purchase_access_email',{p_membership:pending}),null,'One worker owns the lease');
 await q("update icash_memberships set state='needs_review' where id=$1",[pending]);assert.equal(await rpc('icash_authorize_purchase_access_email',{p_id:claim.id,p_claim:claim.claimToken,p_message:purchaseAccessMessage(claim)}),null,'Refund/dispute before dispatch cancels');
 const race=await membership('live','active','race@example.invalid');await settle(race);
 let failFinish=true;
 const flakyDb=async(path,method,body,...rest)=>{if(path==='rpc/icash_finish_purchase_access_email'&&failFinish)throw Error('Database timeout');return db(path,method,body,...rest);};
 await processPurchaseAccessEmails({db:flakyDb,env,transport,membershipId:race});assert.equal((await row(race)).status,'sending');
 failFinish=false;await q("update icash_purchase_access_emails set claimed_at=now()-interval '3 minutes' where membership_id=$1",[race]);
 await processPurchaseAccessEmails({db,env,transport,membershipId:race});assert.equal((await row(race)).status,'sent');assert.equal(sends.at(-1).body,sends.at(-2).body,'Lost database receipt uses the same message');
 const expired=await membership('live','active','expired@example.invalid');await settle(expired);await q("update icash_purchase_access_emails set first_attempt_at=now()-interval '24 hours' where membership_id=$1",[expired]);await processPurchaseAccessEmails({db,env,transport,membershipId:expired});assert.equal((await row(expired)).status,'needs_review','Never resend outside provider deduplication window');
 const permanent=await membership('live','active','failure@example.invalid');await settle(permanent);await processPurchaseAccessEmails({db,env,transport:async()=>new Response(null,{status:422}),membershipId:permanent});assert.equal((await row(permanent)).status,'failed');
 await pg.exec('set role anon');await assert.rejects(()=>pg.query('select * from icash_purchase_access_emails'));await assert.rejects(()=>pg.query('select icash_claim_purchase_access_email()'));await pg.exec('reset role');
 console.log('PASS purchase email: real settlement and private queue; first payment only; timeout/idempotent retry; frozen payload; leases; preview/free/renewal exclusion; recipient-bound delivery; bounce, billing and retry-window gates. No live messages.');
}finally{await pg.close();}
