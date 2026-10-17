import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {databaseAdapter,loadService} from './helpers/simulated-journey-services.mjs';
import {processSupportCustomerNotifications,recordSupportCustomerDelivery} from '../lib/support-customer-notifications.ts';
import {replyToAccessHelp} from '../lib/access-help-replies.ts';
import {accessHelpCookie} from '../lib/access-help.ts';
const pg=await PGlite.create(),{db,rpc,q}=databaseAdapter(pg);
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
const owner=randomUUID(),user=randomUUID(),account=randomUUID();
const env={VERCEL_ENV:'production',ICASH_AUTH_EMAIL_READY:'true',ICASH_RELIABILITY_FROM_EMAIL:'support@example.invalid',RESEND_API_KEY:'fixture',RESEND_RECEIVING_WEBHOOK_SECRET:'fixture',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'fixture'};
let sent=[],fail=false,earlyDelivery=false,verified=true,recipient='member@example.invalid',authCalls=0;
const transport=async(url,init)=>{
 if(init.method!=='POST'){authCalls++;assert.equal(new URL(url).pathname,'/auth/v1/admin/users/'+user);return Response.json({id:user,email:recipient,email_confirmed_at:verified?'2026-01-01T00:00:00Z':null});}
 assert.equal(url,'https://api.resend.com/emails');assert(init.signal);assert.equal(init.redirect,'error');
 const message=JSON.parse(init.body),id=randomUUID();sent.push({message,key:init.headers['Idempotency-Key']});
 if(earlyDelivery)await recordSupportCustomerDelivery({type:'email.delivered',data:{email_id:id,to:message.to,tags:{icash_support_customer_id:message.tags[0].value}}},db);
 if(fail)throw Error('Lost response after possible acceptance');return Response.json({id});
};
const processEmails=()=>processSupportCustomerNotifications({db,env,transport,limit:10});
const row=async(id)=>(await q('select * from icash_support_customer_emails where id=$1',[id])).rows[0];
const due=async(id)=>q('update icash_support_customer_emails set next_attempt_at=now() where id=$1',[id]);
async function guest(email=randomUUID()+'@example.invalid'){
 const secret=randomBytes(32).toString('hex'),args={p_hash:hash(secret),p_key:randomUUID(),p_email:email,p_phone:null,p_message:'My code did not work.'};
 const id=await rpc('icash_access_help_submit',args);return {id,secret,args};
}
async function answer(g){await replyToAccessHelp(db,g.id,g.args.p_key);return (await q('select id from icash_support_customer_emails where access_request_id=$1 order by created_at desc',[g.id])).rows[0].id;}
async function operatorReply(g,reply='Please try the code once more.'){
 const update={p_operator:owner,p_id:g.id,p_key:randomUUID(),p_status:'waiting_on_customer',p_reply:reply};
 await rpc('icash_access_help_operator_update',update);await rpc('icash_access_help_operator_update',update);
 return (await q('select id from icash_support_customer_emails where source_id=(select id from icash_access_help_messages where request_key=$1)',[update.p_key])).rows[0]?.id;
}
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create table icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean default false);
 create table icash_daily_plans(id uuid primary key,account_id uuid,state text,mode text);
 create table icash_trusted_operators(user_id uuid primary key,revoked_at timestamptz,expires_at timestamptz,scopes text[]);
 create table icash_email_suppressions(email text primary key);
 create table icash_memberships(id uuid primary key,payer_email text,created_at timestamptz default now(),mode text,state text,paid_through timestamptz,account_id uuid);
 create table icash_membership_invoices(stripe_invoice_id text primary key,membership_id uuid,amount_cents bigint,recorded_at timestamptz default now());
 create table icash_purchase_access_emails(membership_id uuid unique,status text,delivery text);
 create table icash_purchase_access_followups(membership_id uuid,channel text,status text,delivery text,unique(membership_id,channel));
 grant usage on schema public,auth to service_role;grant all on all tables in schema public,auth to service_role;`);
 for(const file of ['config/support-center.sql','config/support-owner-notifications.sql','supabase/migrations/20261017185057_paid_access_support.sql','supabase/migrations/20261017213055_support_conversation_replies.sql','supabase/migrations/20261017214402_support_operator_resolution_guard.sql','supabase/migrations/20261017222557_support_customer_reply_email.sql'])await pg.exec(read(file));
 await q('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'owner@example.invalid',user,recipient]);
 await q("insert into icash_trusted_operators values($1,null,now()+interval '1 day',array['support'])",[owner]);
 await q('insert into icash_accounts values($1,$2,false)',[account,user]);
 await pg.exec('set role service_role');
 const g=await guest('guest@example.invalid');assert.equal((await q('select count(*)::int as n from icash_support_customer_emails')).rows[0].n,0,'Customer message alone does not send a reply notification');
 const job=await answer(g);await answer(g);assert.equal((await q('select count(*)::int as n from icash_support_customer_emails')).rows[0].n,1,'One job per saved reply despite retries');
 const claim=await rpc('icash_claim_support_customer_email',{});assert.equal(claim.id,job);assert.equal(await rpc('icash_claim_support_customer_email',{}),null,'Concurrent worker cannot claim the same notification');
 await q("update icash_support_customer_emails set claimed_at=now()-interval '3 minutes' where id=$1",[job]);
 fail=true;assert.equal((await processEmails()).failed,1);const first=sent.at(-1),token=new URL(first.message.text.match(/https:\/\/www\.geticashx\.com\/access\/help\/return#[a-f0-9]+/)[0]).hash.slice(1);
 assert.equal(authCalls,0,'Guest recovery never needs an Auth account');assert.deepEqual(first.message.to,['guest@example.invalid']);assert(!first.message.text.includes(g.args.p_message),'Email contains no unverified customer text');
 assert.equal((await row(job)).link_hash,hash(token));assert.notEqual((await row(job)).link_hash,token);
 await due(job);fail=false;env.ICASH_RELIABILITY_FROM_EMAIL='changed@example.invalid';assert.equal((await processEmails()).accepted,1);assert.deepEqual(sent.at(-1),first,'Ambiguous send retries the exact payload, token and key');assert.equal((await row(job)).message,null,'Raw link is removed after confirmed acceptance');
 const nextDevice=hash(randomBytes(32).toString('hex'));
 await q("update icash_access_help_requests set expires_at=now()-interval '1 day' where id=$1",[g.id]);
 assert.equal(await rpc('icash_access_help_return',{p_link_hash:hash('bad'),p_session_hash:nextDevice}),false);
 assert.equal(await rpc('icash_access_help_return',{p_link_hash:hash(token),p_session_hash:nextDevice}),true,'Email restores even after original browser support session expired');
 assert.equal((await rpc('icash_access_help_read',{p_hash:nextDevice})).id,g.id);assert.equal((await rpc('icash_access_help_read',{p_hash:hash(g.secret)})).id,g.id,'Original browser remains usable');
 assert.equal((await rpc('icash_access_help_read',{p_hash:nextDevice})).notification.status,'sent');
 assert(!JSON.stringify(await rpc('icash_access_help_read',{p_hash:nextDevice})).includes('link_hash'));
 const anotherDevice=hash(randomUUID());assert.equal(await rpc('icash_access_help_return',{p_link_hash:hash(token),p_session_hash:anotherDevice}),true,'Mail scanners and previous opens do not consume the email link');
 const foreign=await guest();assert.equal(await rpc('icash_access_help_return',{p_link_hash:hash(token),p_session_hash:hash(foreign.secret)}),false,'Cannot overwrite another conversation proof');
 await assert.rejects(()=>rpc('icash_access_help_submit',{...g.args,p_hash:nextDevice,p_key:randomUUID(),p_email:foreign.args.p_email}));
 const followup={...g.args,p_hash:nextDevice,p_key:randomUUID(),p_message:'I used email.'};assert.equal(await rpc('icash_access_help_submit',followup),g.id);
 await q("update icash_access_help_sessions set expires_at=now()-interval '1 second' where session_hash=$1",[anotherDevice]);
 assert.equal((await rpc('icash_access_help_read',{p_hash:anotherDevice})).expired,true);await assert.rejects(()=>rpc('icash_access_help_submit',{...followup,p_hash:anotherDevice,p_key:randomUUID()}));

 // The real return API sets only a support cookie, never a login or purchase cookie.
 const jar=new Map(),cookieOptions=new Map();let allowed=true,limited=false;
 const cookies=async()=>({set:(name,value,options)=>{jar.set(name,value);cookieOptions.set(name,options);}});
 const route=await loadService('app/api/support/access/return/route.ts',{cookies,randomBytes,createHash,db,allowedOrigin:()=>allowed,limitRequest:async()=>{if(limited)throw {status:429};},accessHelpCookie,process:{env:{VERCEL_ENV:'production'}}});
 const post=value=>route.POST(new Request('https://www.geticashx.com/api/support/access/return',{method:'POST',body:JSON.stringify(value)}));
 allowed=false;assert.equal((await post({token})).status,403);allowed=true;
 for(const value of [{token:'bad'},{token,accountId:account},null])assert.equal((await post(value)).status,400);
 assert.equal((await post({token:randomBytes(32).toString('hex')})).status,410);assert.equal(jar.size,0);
 const response=await post({token});assert.equal(response.status,200);assert.deepEqual(await response.json(),{restored:true});assert.equal(jar.size,1);assert.equal([...jar.keys()][0],accessHelpCookie);
 assert.deepEqual(cookieOptions.get(accessHelpCookie),{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:604800});
 assert.equal((await rpc('icash_access_help_read',{p_hash:hash(jar.get(accessHelpCookie))})).id,g.id);
 limited=true;assert.equal((await post({token})).status,429);limited=false;
 await q("update icash_support_customer_emails set link_expires_at=now()-interval '1 second' where id=$1",[job]);assert.equal((await post({token})).status,410);
 assert.equal((await rpc('icash_access_help_read',{p_hash:hash(jar.get(accessHelpCookie))})).id,g.id,'Expired email does not silently destroy a valid browser conversation');
 const page=await loadService('app/access/help/return/route.ts',{randomBytes});const landing=await page.GET();assert.match(landing.headers.get('Content-Security-Policy'),/default-src 'none'/);assert.equal(landing.headers.get('Referrer-Policy'),'no-referrer');assert(!/facebook|googletag|pixel/.test(await landing.text()));

 // Manual replies, early signed delivery events, and status-only updates.
 const manual=await operatorReply(g);earlyDelivery=true;assert.equal((await processEmails()).accepted,1);earlyDelivery=false;assert.equal((await row(manual)).delivery,'delivered');assert.equal((await row(manual)).message,null);
 const delivered=await row(manual);await recordSupportCustomerDelivery({type:'email.bounced',data:{email_id:delivered.provider_id,to:['wrong@example.invalid'],tags:{icash_support_customer_id:manual}}},db);assert.equal((await row(manual)).delivery,'delivered','Wrong recipient cannot attach a receipt');
 await recordSupportCustomerDelivery({type:'email.delivery_delayed',data:{email_id:delivered.provider_id,to:['guest@example.invalid']}},db);assert.equal((await row(manual)).delivery,'delivered','Late delay cannot undo delivered receipt');
 assert.equal(await operatorReply(g,null),undefined,'Status-only updates do not queue another email');
 await recordSupportCustomerDelivery({type:'email.bounced',data:{email_id:delivered.provider_id,to:['guest@example.invalid']}},db);
 const suppressed=await operatorReply(g),beforeSuppressed=sent.length;await processEmails();assert.equal(sent.length,beforeSuppressed);assert.equal((await row(suppressed)).status,'needs_review');
 assert.equal((await rpc('icash_access_help_read',{p_hash:nextDevice})).notification.status,'needs_review','Delivery trouble remains visible in support');

 // An expired ambiguous attempt must never send a fresh email after idempotency expires.
 const old=await guest(),oldJob=await answer(old);fail=true;await processEmails();fail=false;const oldCount=sent.length;
 await q("update icash_support_customer_emails set next_attempt_at=now(),first_attempt_at=now()-interval '24 hours' where id=$1",[oldJob]);await processEmails();assert.equal(sent.length,oldCount);assert.equal((await row(oldJob)).status,'needs_review');
 const blocked=await guest('blocked@example.invalid'),blockedJob=await answer(blocked);await q('insert into icash_email_suppressions values($1)',[blocked.args.p_email]);await processEmails();assert.equal((await row(blockedJob)).status,'needs_review');

 // Signed-in customers receive only their verified account email and a tenant-checked thread URL.
 const request=randomUUID(),thread=await rpc('icash_support_begin_message',{p_account:account,p_user:user,p_thread:null,p_request:request,p_message:'My bot paused.'});
 const finish={p_account:account,p_user:user,p_thread:thread.threadId,p_request:request,p_message:'Which screen are you on?',p_evidence:[],p_status:'waiting_on_customer',p_notify:false};
 await rpc('icash_support_finish_conversation',finish);await rpc('icash_support_finish_conversation',finish);await processEmails();assert.deepEqual(sent.at(-1).message.to,[recipient]);assert(sent.at(-1).message.text.includes('/support?threadId='+thread.threadId));assert(!sent.at(-1).message.text.includes('/access/help/return'));
 const operatorUpdate={p_operator:owner,p_thread:thread.threadId,p_request:randomUUID(),p_status:'waiting_on_customer',p_reply:'Try refreshing the workspace.'};
 await rpc('icash_support_operator_update',operatorUpdate);await rpc('icash_support_operator_update',operatorUpdate);
 const memberJob=(await q('select id from icash_support_customer_emails where source_id=(select id from icash_support_messages where request_id=$1 and role=\'operator\')',[operatorUpdate.p_request])).rows[0].id;
 verified=false;const unverifiedCount=sent.length;await processEmails();assert.equal(sent.length,unverifiedCount,'Unverified accounts never receive private account links');verified=true;await due(memberJob);fail=true;await processEmails();fail=false;
 recipient='changed-member@example.invalid';await due(memberJob);const changedCount=sent.length;await processEmails();assert.equal(sent.length,changedCount);assert.equal((await row(memberJob)).status,'needs_review','Verified address change cannot redirect an authorized retry');
 const beforeDisabled=sent.length;for(const extra of [{VERCEL_ENV:'preview'},{ICASH_SUPPORT_CUSTOMER_EMAIL_ENABLED:'false'}])await processSupportCustomerNotifications({db:()=>assert.fail('Disabled flow touched database'),env:{...env,...extra},transport:()=>assert.fail('Disabled flow sent email')});assert.equal(sent.length,beforeDisabled);
 for(const role of ['anon','authenticated']){
  for(const table of ['icash_support_customer_emails','icash_access_help_sessions'])assert.equal((await q('select has_table_privilege($1,$2,\'SELECT\') as ok',[role,table])).rows[0].ok,false);
  for(const fn of ['icash_claim_support_customer_email()','icash_access_help_return(text,text)','icash_access_help_read(text)','icash_access_help_read_browser(text)','icash_access_help_submit_browser(text,uuid,text,text,text)','icash_authorize_support_customer_email(uuid,uuid,text,jsonb,text)','icash_support_customer_email_delivery(uuid,uuid,text,text)'])assert.equal((await q('select has_function_privilege($1,$2,\'EXECUTE\') as ok',[role,fn])).rows[0].ok,false);
 }
 console.log('PASS customer support email: atomic guest/AI/operator jobs, private cross-device return, original browser continuity, expiry/CSRF/tenant isolation, verified member address, exact retries, lease recovery, delivery races, suppression, status-only/replay deduplication. All providers mocked.');
}finally{await pg.close();}
