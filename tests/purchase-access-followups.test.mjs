import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {databaseAdapter,loadService} from './helpers/simulated-journey-services.mjs';
import {processPurchaseAccessEmails} from '../lib/purchase-access-email.ts';
import {purchaseAccessFollowupMessage,processPurchaseAccessFollowups} from '../lib/purchase-access-followups.ts';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const pg=await PGlite.create(),{db,rpc,q}=databaseAdapter(pg);
const env={VERCEL_ENV:'production',ICASH_AUTH_EMAIL_READY:'true',RESEND_API_KEY:'fixture',RESEND_RECEIVING_WEBHOOK_SECRET:'fixture',CONTIGUITY_API_KEY:'fixture',CONTIGUITY_WEBHOOK_SECRET:'fixture'};
let nextPhone=1000;const sender='+12125550100';
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table icash_memberships(id uuid primary key,mode text,state text default 'active',paid_through timestamptz,payer_email text,post_purchase_webinar_id uuid,stripe_subscription_id text,stripe_customer_id text,payer_phone text,updated_at timestamptz,price_cents bigint default 5000,retention_requested_at timestamptz,retention_discount_id text,retention_started_at timestamptz,retention_ends_at timestamptz,account_id uuid,guest_hash text);
 create table icash_membership_invoices(stripe_invoice_id text primary key,membership_id uuid references icash_memberships,amount_cents bigint,stripe_payment_id text,period_end timestamptz,recorded_at timestamptz default now());
 create table icash_billing_reviews(payment_id text,resolved_at timestamptz);create table icash_accounts(id uuid,bot_paused boolean);
 create table icash_email_suppressions(email text,reason text);create table icash_webinar_suppressions(email text primary key,reason text);
 create table icash_webinars(id uuid primary key,parent_webinar_id uuid,config jsonb);
 create table icash_webinar_visitors(id uuid primary key,email text,phone text,funding_guest_hash text,account_id uuid,sms_consent_at timestamptz,sms_opted_out_at timestamptz,sms_consent_version text);
 create table icash_text_suppressions(phone text primary key,reason text);create table icash_webinar_phone_suppressions(phone text primary key);
 create table icash_messaging_settings(id int,config jsonb);insert into icash_messaging_settings values(1,'{"smsEnabled":true}');
 create table icash_webinar_text_senders(phone text primary key,enabled boolean default true,preferred boolean default true);
 create table icash_webinar_text_assignments(recipient text primary key,sender text);
 create table icash_text_threads(sender text,recipient text,retired_at timestamptz);
 create table icash_webinar_delivery_receipts(channel text,provider_id text,kind text,primary key(channel,provider_id));
 create table icash_webinar_outbox(id uuid,visitor_id uuid,channel text,provider_id text,state text,recipient text);`);
 await q('insert into icash_webinar_text_senders(phone) values($1)',[sender]);
 await pg.exec(read('supabase/migrations/20261006194302_immediate_membership_cancellation_and_retention.sql').match(/create function public\.icash_settle_membership_invoice_v2[\s\S]*?end \$\$;/)[0]);
 await pg.exec(read('supabase/migrations/20261008174620_customer_lifecycle_and_text_roles.sql').match(/create or replace function public\.icash_webinar_campaign_sender[\s\S]*?end \$\$;/)[0]);
 await pg.exec(read('supabase/migrations/20261007185116_webinar_smart_followups.sql').match(/create function public\.icash_webinar_followup_delivery[\s\S]*?end \$\$;/)[0]);
 await pg.exec(read('supabase/migrations/20261017145924_purchase_access_email.sql'));
 async function purchase({mode='live',consent=true,guest=true,phoneMatch=true,emailMatch=true,account=null,oldConsent=false,payerFormat='normal'}={}){
  const id=randomUUID(),visitor=randomUUID(),phone='+1212555'+String(nextPhone++),email=id+'@example.invalid',hash=randomUUID();
  await q('insert into icash_memberships(id,mode,payer_email,guest_hash,account_id) values($1,$2,$3,$4,$5)',[id,mode,email,hash,account]);
  await q("insert into icash_webinar_visitors values($1,$2,$3,$4,null,case when $5 then now() else null end,null,$6)",[visitor,emailMatch?email:'someoneelse@example.invalid',phone,guest?hash:randomUUID(),consent,oldConsent?'webinar-sms-2026-10-07':'webinar-sms-ongoing-2026-10-09']);
  await rpc('icash_settle_membership_invoice_v2',{p_membership:id,p_subscription:'sub_'+id.replaceAll('-',''),p_customer:'cus_'+id.replaceAll('-',''),p_invoice:'in_'+id.replaceAll('-',''),p_payment:'pi_'+id.replaceAll('-',''),p_amount:5000,p_email:email,p_phone:!phoneMatch?'+12125559999':payerFormat==='formatted'?'+1 (212) 555-'+phone.slice(-4):payerFormat==='national'?phone.slice(2):phone,p_period_end:'2099-02-01T00:00:00Z',p_period_start:'2099-01-01T00:00:00Z',p_discount:null});
  return {id,visitor,phone,email};
 }
 const historical=await purchase();
 await pg.exec(read('supabase/migrations/20261017152224_purchase_access_reminder_and_text.sql'));
 await pg.exec(read('supabase/migrations/20261017152700_purchase_access_phone_normalization.sql'));
 await pg.exec(read('supabase/migrations/20261017185549_access_delivery_reconciliation.sql'));
 const rows=async id=>(await q('select * from icash_purchase_access_followups where membership_id=$1 order by channel',[id])).rows;
 const row=async(id,channel)=>(await rows(id)).find(r=>r.channel===channel);
 assert.equal((await rows(historical.id)).length,0,'No historical backfill');
 const sent=[];const receipts=new Map();
 const transport=async(url,options)=>{assert(['https://api.resend.com/emails','https://api.contiguity.com/send/text'].includes(url));const body=JSON.parse(options.body);sent.push({url,body,options});const key=options.headers['Idempotency-Key']||randomUUID();if(!receipts.has(key))receipts.set(key,randomUUID());return Response.json(url.includes('resend')?{id:receipts.get(key)}:{data:{message_id:receipts.get(key)}});};
 const first=async id=>processPurchaseAccessEmails({db,env,transport,membershipId:id,limit:1});
 const send=async(id,options={})=>processPurchaseAccessFollowups({db,env,transport,membershipId:id,...options});
 const due=async(id,channel='email')=>q("update icash_purchase_access_followups set due_at=now()-interval '1 second',next_attempt_at=now()-interval '1 second' where membership_id=$1 and channel=$2",[id,channel]);
 const buyer=await purchase();assert.equal((await rows(buyer.id)).length,2);
 await send(buyer.id);assert.equal(sent.length,1);assert(sent[0].url.includes('contiguity'));assert.equal(sent[0].body.to,buyer.phone);assert(sent[0].body.message.includes('https://www.geticashx.com/access'));assert(sent[0].body.message.includes('checkout email'));assert(sent[0].body.message.length<=160);
 assert.equal((await row(buyer.id,'email')).status,'pending','Second email waits');
 await first(buyer.id);assert.equal(sent.length,2);const scheduled=await row(buyer.id,'email');assert(new Date(scheduled.due_at).getTime()>Date.now()+14*60000,'Fifteen minutes follows actual first acceptance');
 await send(buyer.id);assert.equal(sent.length,2);await due(buyer.id);await send(buyer.id);assert.equal(sent.length,3);assert(sent[2].body.subject.includes('save this email'));assert(sent[2].body.html.includes('>https://www.geticashx.com/access</a>'));
 await send(buyer.id);await first(buyer.id);assert.equal(sent.length,3,'Exactly two emails and one text across repeat wakes');
 await q("insert into icash_membership_invoices values($1,$2,5000,$3,'2099-03-01',now())",['renewal_'+buyer.id,buyer.id,'pi_renewal']);await q("update icash_memberships set paid_through='2099-03-01' where id=$1",[buyer.id]);assert.equal((await rows(buyer.id)).length,2,'Renewal creates no extra access messages');
 for(const options of [{consent:false},{guest:false},{phoneMatch:false},{emailMatch:false},{oldConsent:true}]){const p=await purchase(options);assert.equal((await rows(p.id)).filter(r=>r.channel==='sms').length,0,'Only permission on the payment-bound phone qualifies');}
 for(const payerFormat of ['formatted','national']){const p=await purchase({payerFormat});assert.equal((await rows(p.id)).filter(r=>r.channel==='sms').length,1,'Equivalent checkout phone formatting retains the same permission');}
 const test=await purchase({mode:'test'});assert.equal((await rows(test.id)).length,0);
 const claimed=await purchase();await first(claimed.id);await due(claimed.id);await q('update icash_memberships set account_id=$2 where id=$1',[claimed.id,randomUUID()]);await send(claimed.id);assert.equal((await row(claimed.id,'email')).status,'canceled','Account claiming stops the reminder');
 const stopped=await purchase();const claim=await rpc('icash_claim_purchase_access_followup',{p_channel:'sms',p_membership:stopped.id});assert(claim);assert.equal(await rpc('icash_claim_purchase_access_followup',{p_channel:'sms',p_membership:stopped.id}),null,'Atomic exclusive lease');
 await q("insert into icash_text_suppressions values($1,'STOP')",[stopped.phone]);assert.equal(await rpc('icash_authorize_purchase_access_followup',{p_id:claim.id,p_claim:claim.claimToken,p_message:purchaseAccessFollowupMessage(claim)}),null,'STOP between claim and send blocks dispatch');
 const moved=await purchase();const movedClaim=await rpc('icash_claim_purchase_access_followup',{p_channel:'sms',p_membership:moved.id});await q('update icash_webinar_visitors set phone=$2 where id=$1',[moved.visitor,'+12125558888']);assert.equal(await rpc('icash_authorize_purchase_access_followup',{p_id:movedClaim.id,p_claim:movedClaim.claimToken,p_message:purchaseAccessFollowupMessage(movedClaim)}),null,'Changed phone cannot reuse permission');
 const conflict=await purchase();const conflictClaim=await rpc('icash_claim_purchase_access_followup',{p_channel:'sms',p_membership:conflict.id});await q('insert into icash_text_threads values($1,$2,null)',[sender,conflict.phone]);assert.equal(await rpc('icash_authorize_purchase_access_followup',{p_id:conflictClaim.id,p_claim:conflictClaim.claimToken,p_message:purchaseAccessFollowupMessage(conflictClaim)}),null,'Property conversation collisions block text');
 const refunded=await purchase();await q("update icash_memberships set state='needs_review' where id=$1",[refunded.id]);await send(refunded.id);assert.equal((await row(refunded.id,'sms')).status,'canceled');
 const ambiguous=await purchase();let unknownSends=0;await send(ambiguous.id,{transport:async()=>{unknownSends++;throw Error('Accepted but response lost');}});assert.equal(unknownSends,1);assert.equal((await row(ambiguous.id,'sms')).status,'needs_review');await send(ambiguous.id,{transport:async()=>{throw Error('Must never retry');}});
 const lost=await purchase();let lostSends=0;const failFinish=async(path,...args)=>{if(path==='rpc/icash_finish_purchase_access_followup')throw Error('Receipt store unavailable');return db(path,...args);};await send(lost.id,{db:failFinish,transport:async()=>{lostSends++;return Response.json({data:{message_id:'saved-provider-id'}});}});await q("update icash_purchase_access_followups set claimed_at=now()-interval '3 minutes' where membership_id=$1 and channel='sms'",[lost.id]);await send(lost.id);assert.equal(lostSends,1);assert.equal((await row(lost.id,'sms')).status,'needs_review','Lost SMS receipt cannot cause another send');
 const retry=await purchase({consent:false});await first(retry.id);await due(retry.id);let fail=true;const retryPayloads=[];const retryTransport=async(url,options)=>{retryPayloads.push(options);if(fail){fail=false;throw Error('Response lost');}return transport(url,options);};await send(retry.id,{transport:retryTransport});assert.equal((await row(retry.id,'email')).status,'pending');await due(retry.id);await send(retry.id,{transport:retryTransport});assert.equal(retryPayloads.length,2);assert.equal(retryPayloads[0].body,retryPayloads[1].body);assert.equal(retryPayloads[0].headers['Idempotency-Key'],retryPayloads[1].headers['Idempotency-Key']);
 const bounced=await row(retry.id,'email');await rpc('icash_webinar_followup_delivery',{p_channel:'email',p_provider:bounced.provider_id,p_kind:'bounced'});await rpc('icash_webinar_followup_delivery',{p_channel:'email',p_provider:bounced.provider_id,p_kind:'delivered'});assert.equal((await row(retry.id,'email')).delivery,'bounced');assert((await q('select * from icash_webinar_suppressions where email=$1',[retry.email])).rows.length,'Bounce suppression is shared');
 const early=await purchase();await send(early.id,{transport:async()=>{await rpc('icash_webinar_followup_delivery',{p_channel:'sms',p_provider:'early-receipt',p_kind:'delivered'});return Response.json({data:{message_id:'early-receipt'}});}});assert.equal((await row(early.id,'sms')).delivery,'delivered','Delivery arriving before finish is reconciled');
 const disabled=await purchase();await q("update icash_messaging_settings set config=$1",[{smsEnabled:false}]);await send(disabled.id);assert.equal((await row(disabled.id,'sms')).status,'canceled');await q("update icash_messaging_settings set config=$1",[{smsEnabled:true}]);
 // Late delay receipts cannot erase delivery; a genuine bounce still wins.
 const deliveredFirst=(await q('select * from icash_purchase_access_emails where membership_id=$1',[buyer.id])).rows[0];
 for(const kind of ['delivered','delivery_delayed'])await rpc('icash_purchase_access_email_delivery',{p_id:deliveredFirst.id,p_provider:deliveredFirst.provider_id,p_recipient:buyer.email,p_kind:kind});
 assert.equal((await q('select delivery from icash_purchase_access_emails where id=$1',[deliveredFirst.id])).rows[0].delivery,'delivered');
 for(const kind of ['bounced','delivered'])await rpc('icash_purchase_access_email_delivery',{p_id:deliveredFirst.id,p_provider:deliveredFirst.provider_id,p_recipient:buyer.email,p_kind:kind});
 assert.equal((await q('select delivery from icash_purchase_access_emails where id=$1',[deliveredFirst.id])).rows[0].delivery,'bounced');
 // Paid purchases predating the outbox get exactly the same finite access sequence.
 async function missed({mode='live',state='active',account=null,amount=5000,days=10,expired=false,review=false,suppressed=false}={}){
  const id=randomUUID(),email=id+'@example.invalid',payment='pi_'+id;
  await q("insert into icash_memberships(id,mode,state,account_id,paid_through,payer_email) values($1,$2,$3,$4,now()+case when $5 then interval '-1 day' else interval '20 days' end,$6)",[id,mode,state,account,expired,email]);
  await q("insert into icash_membership_invoices values($1,$2,$3,$4,'2099-02-01',now()-make_interval(days=>$5))",['in_'+id,id,amount,payment,days]);
  if(review)await q('insert into icash_billing_reviews values($1,null)',[payment]);
  if(suppressed)await q("insert into icash_email_suppressions values($1,'bounce')",[email]);
  return {id,email};
 }
 const missing=await missed();for(const options of [{mode:'test'},{state:'canceled'},{account:randomUUID()},{amount:0},{days:31},{expired:true},{review:true},{suppressed:true}])await missed(options);
 assert.equal(await rpc('icash_queue_missing_purchase_access_emails',{}),1);assert.equal(await rpc('icash_queue_missing_purchase_access_emails',{}),0);
 assert.equal((await rows(missing.id)).length,1,'Recovery never invents SMS consent');assert.equal((await row(missing.id,'email')).status,'pending');
 const beforeRecovery=sent.length;
 await processPurchaseAccessEmails({db,env,transport,membershipId:missing.id,limit:1,reconcile:true});
 assert.equal(sent.length,beforeRecovery+1);assert(new Date((await row(missing.id,'email')).due_at).getTime()>Date.now()+14*60000);
 await due(missing.id);await send(missing.id);await first(missing.id);assert.equal(sent.length,beforeRecovery+2,'Recovered buyer receives only two access emails');
 const before=sent.length;const preview=await processPurchaseAccessFollowups({db:async()=>assert.fail('Preview cannot claim'),env:{...env,VERCEL_ENV:'preview'},transport});assert.equal(preview.ready,false);assert.equal(sent.length,before);
 await processPurchaseAccessEmails({db:async()=>assert.fail('Preview cannot reconcile'),env:{...env,VERCEL_ENV:'preview'},transport,reconcile:true});
 for(const role of ['anon','authenticated']){await pg.exec('set role '+role);await assert.rejects(()=>pg.query('select * from icash_purchase_access_followups'));await assert.rejects(()=>pg.query("select icash_claim_purchase_access_followup('sms')"));await assert.rejects(()=>pg.query('select icash_queue_missing_purchase_access_emails()'));await pg.exec('reset role');}
 let callbacks=[],wakes=[];const dispatch=await loadService('lib/purchase-access-dispatch.ts',{after:fn=>callbacks.push(fn),db,process:{env},processPurchaseAccessEmails:async()=>{wakes.push('email');throw Error('First lane down');},processPurchaseAccessFollowups:async()=>{wakes.push('followups');},console:{warn:()=>{}}});dispatch.schedulePurchaseAccessEmail(buyer.id);await callbacks[0]();assert.deepEqual(wakes,['email','followups'],'Immediate SMS wake survives first email failure');
 console.log('PASS purchase access follow-ups: real settlement, exactly two emails/one text, actual 15-minute spacing, account-claim cancellation, payment/phone/consent/STOP gates, role-safe sender, independent channels, immutable email retries, no ambiguous SMS replay, delivery races, bounce suppression, preview and private permissions. No live provider traffic.');
}finally{await pg.close();}
