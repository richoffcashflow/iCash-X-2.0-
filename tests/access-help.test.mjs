import {supportVerifiedLegacyOfferReply} from '../lib/support-legacy-migration.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {databaseAdapter,loadService} from './helpers/simulated-journey-services.mjs';
import {accessHelpCookie,accessHelpInput,accessHelpUpdate,accessHelpRedact} from '../lib/access-help.ts';
import {normalizeAccessPhone} from '../lib/purchase-phone-access.ts';
import {processSupportOwnerNotifications} from '../lib/support-owner-notifications.ts';
import {replyToAccessHelp,recoverAccessHelpReplies} from '../lib/access-help-replies.ts';
import {supportConversationFallback} from '../lib/support-conversation.ts';
import {ownerInboundTarget} from '../lib/owner-inbound-acceptance.ts';
const pg=await PGlite.create(),{db:baseDb,rpc,q}=databaseAdapter(pg);
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
const owner=ownerInboundTarget.ownerUserId,other=randomUUID();
const db=async(path,method,body)=>{const result=await baseDb(path,method,body);if(path.startsWith('rpc/'))return result;const select=new URLSearchParams(path.split('?')[1]).get('select');return select?result.map(row=>Object.fromEntries(select.split(',').map(key=>[key,row[key]]))):result;};
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
 await pg.exec(read('config/support-center.sql'));await pg.exec(read('config/support-owner-notifications.sql'));
 await pg.exec(read('supabase/migrations/20261017185057_paid_access_support.sql'));
 await pg.exec(read('supabase/migrations/20261017213055_support_conversation_replies.sql'));
 await pg.exec(read('supabase/migrations/20261017214402_support_operator_resolution_guard.sql'));
 await pg.exec(read('supabase/migrations/20261018065930_automated_support_resolution.sql'));
 await pg.exec(read('supabase/migrations/20261017222557_support_customer_reply_email.sql'));
 await q('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'owner@example.invalid',other,'other@example.invalid']);
 await q("insert into icash_trusted_operators values($1,null,now()+interval '1 day',array['support'])",[owner]);
 await pg.exec('set role service_role');
 const a=hash(randomUUID()),b=hash(randomUUID()),key=randomUUID();
 const args={p_hash:a,p_key:key,p_email:'Customer@Example.invalid',p_phone:'+12125551234',p_message:accessHelpRedact('I paid. Code 123456. My password sk_live_123456789. No code works.')};
 const id=await rpc('icash_access_help_submit',args);assert.equal(await rpc('icash_access_help_submit',args),id);
 assert.equal((await q('select count(*)::int as count from icash_support_owner_copies')).rows[0].count,1,'Retry never duplicates the owner notification');
 const conversation=await rpc('icash_access_help_read',{p_hash:a});assert.equal(conversation.email,'customer@example.invalid');assert.equal(conversation.messages[0].requestId,key);assert(!JSON.stringify(conversation).includes('123456'));assert(!JSON.stringify(conversation).includes('sk_live_'));assert(!JSON.stringify(conversation).includes('session_hash'));
 assert.equal(await rpc('icash_access_help_read',{p_hash:b}),null,'Another browser cannot discover a case by email or ID');
 await assert.rejects(()=>rpc('icash_access_help_submit',{...args,p_message:'Changed replay'}));
 await assert.rejects(()=>rpc('icash_access_help_submit',{...args,p_email:'other@example.invalid',p_key:randomUUID()}));
 const update={p_operator:owner,p_id:id,p_key:randomUUID(),p_status:'waiting_on_customer',p_reply:'Open the account link and choose Use my checkout phone.'};
 await assert.rejects(()=>rpc('icash_access_help_operator_update',{...update,p_operator:other}));
 await rpc('icash_access_help_operator_update',update);await rpc('icash_access_help_operator_update',update);
 let readback=await rpc('icash_access_help_read',{p_hash:a});assert.equal(readback.messages.length,2);assert.equal(readback.status,'waiting_on_customer');
 await rpc('icash_access_help_submit',{...args,p_key:randomUUID(),p_message:'The text arrived. Thank you.'});
 await rpc('icash_access_help_operator_update',update);assert.equal((await rpc('icash_access_help_read',{p_hash:a})).status,'open','Replayed operator status cannot overwrite a new visitor reply');
 for(let n=2;n<10;n++)await rpc('icash_access_help_submit',{...args,p_key:randomUUID(),p_message:'Follow-up '+n});
 await assert.rejects(()=>rpc('icash_access_help_submit',{...args,p_key:randomUUID(),p_message:'Beyond daily bound'}));

 // Only positive, settled, currently active, unclaimed production purchases enter the queue.
 async function purchase({age=25,mode='live',state='active',paid=true,claimed=false,emailState='sent',delivery='delivered'}={}){
  const id=randomUUID();await q("insert into icash_memberships(id,payer_email,mode,state,paid_through,account_id) values($1,$2,$3,$4,now()+interval '30 days',$5)",[id,id+'@example.invalid',mode,state,claimed?randomUUID():null]);
  await q("insert into icash_membership_invoices values($1,$2,$3,now()-make_interval(mins=>$4))",['in_'+id,id,paid?5000:0,age]);
  if(emailState)await q('insert into icash_purchase_access_emails values($1,$2,$3)',[id,emailState,delivery]);return id;
 }
 const unclaimed=await purchase(),failed=await purchase({age:1,delivery:'bounced'}),missing=await purchase({age:6,emailState:null});
 for(const options of [{age:2},{mode:'test'},{state:'cancelled'},{paid:false},{claimed:true}])await purchase(options);
 let attention=(await q('select id,reason from icash_purchase_access_attention')).rows;
 assert.equal(attention.length,3);assert.equal(attention.find(row=>row.id===failed).reason,'delivery_problem');assert.equal(attention.find(row=>row.id===missing).reason,'delivery_pending');
 assert.equal(await rpc('icash_queue_purchase_access_attention',{}),3);assert.equal(await rpc('icash_queue_purchase_access_attention',{}),0);
 assert.equal((await q("select count(*)::int as count from icash_support_owner_copies where source='purchase_access'")).rows[0].count,1,'One owner digest for the batch');
 const later=await purchase();assert.equal(await rpc('icash_queue_purchase_access_attention',{}),0,'Fifteen-minute digest cooldown');
 await q("update icash_purchase_access_notices set created_at=now()-interval '16 minutes'");assert.equal(await rpc('icash_queue_purchase_access_attention',{}),1);
 await q('update icash_memberships set account_id=$2 where id=$1',[unclaimed,randomUUID()]);assert(!(await q('select id from icash_purchase_access_attention')).rows.some(row=>row.id===unclaimed),'Claimed accounts leave the live queue');
 let sent=[];const env={VERCEL_ENV:'production',ICASH_SUPPORT_OWNER_EMAIL_ENABLED:'true',ICASH_RELIABILITY_FROM_EMAIL:'noreply@example.invalid',RESEND_API_KEY:'fixture',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'fixture'};
 const transport=async(url,init)=>{if(init.method!=='POST')return Response.json({id:owner,email:'owner@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'});assert.equal(url,'https://api.resend.com/emails');const message=JSON.parse(init.body);assert.deepEqual(message.to,['owner@example.invalid']);assert(message.text.includes('https://www.geticashx.com/support/admin'));assert(!message.text.includes('https://resend.com/emails/receiving'));sent.push(message);return Response.json({id:randomUUID()});};
 await q("update icash_support_owner_copies set next_attempt_at=now()-interval '1 second'");
 await processSupportOwnerNotifications({db,env,transport,limit:10,monitorAccess:true});await processSupportOwnerNotifications({db,env,transport,limit:10,monitorAccess:true});assert.equal(sent.length,12);assert(sent.some(message=>message.text.includes('email address not verified')));

 // Real route functions: no login dependency, secure browser proof, CSRF, replay and private replies.
 const jar=new Map(),cookieOptions=new Map();let allowed=true,scheduled=0;
 const cookies=async()=>({get:name=>jar.has(name)?{value:jar.get(name)}:undefined,set:(name,value,options)=>{jar.set(name,value);cookieOptions.set(name,options);}});
 const route=await loadService('app/api/support/access/route.ts',{scheduleSupportCustomerNotifications:()=>{},cookies,randomBytes,createHash,db,allowedOrigin:()=>allowed,limitRequest:async()=>{},normalizeAccessPhone,accessHelpCookie,accessHelpInput,accessHelpRedact,replyToAccessHelp,scheduleSupportOwnerNotifications:()=>{scheduled++;},process:{env:{VERCEL_ENV:'production'}}});
 assert.equal((await route.GET()).status,200);const secret=jar.get(accessHelpCookie);assert(cookieOptions.get(accessHelpCookie).httpOnly&&cookieOptions.get(accessHelpCookie).secure);await route.GET();assert.equal(jar.get(accessHelpCookie),secret,'Refresh before a first message preserves browser proof');
 const post=body=>route.POST(new Request('https://example.invalid/api/support/access',{method:'POST',body:JSON.stringify(body)}));
 const body={requestId:randomUUID(),email:'new@example.invalid',phone:'2125559999',message:'I cannot get either code.'};
 allowed=false;assert.equal((await post(body)).status,403);allowed=true;
 let response=await post(body);assert.equal(response.status,200);let created=(await response.json()).conversation;assert.equal(created.messages.length,2);assert.equal(created.phone,'+12125559999');assert.equal(scheduled,1);
 await post(body);assert.equal((await (await route.GET()).json()).conversation.messages.length,2);
 assert.equal((await post({...body,email:'invalid'})).status,400);
 assert.equal((await post({...body,phone:'letters'})).status,400);
 const admin=await loadService('app/api/support/admin/access/route.ts',{supportVerifiedLegacyOfferReply,scheduleSupportCustomerNotifications:()=>{},db,requireTrustedOperator:async()=>{if(!allowed)throw Error('OPERATOR_REQUIRED');return {userId:owner};},allowedOrigin:()=>allowed,accessHelpUpdate,accessHelpRedact});
 allowed=false;assert.equal((await admin.GET(new Request('https://example.invalid/api/support/admin/access'))).status,403);allowed=true;
 response=await admin.GET(new Request('https://example.invalid/api/support/admin/access?id='+created.id));assert.equal(response.status,200);assert(!JSON.stringify(await response.json()).includes('session_hash'));
 response=await admin.POST(new Request('https://example.invalid/api/support/admin/access',{method:'POST',body:JSON.stringify({id:created.id,requestId:randomUUID(),status:'waiting_on_customer',reply:'Please choose Use my checkout phone on the access page.'})}));assert.equal(response.status,200);
 assert.equal((await (await route.GET()).json()).conversation.messages.at(-1).role,'operator');
 await q("update icash_access_help_requests set expires_at=now()-interval '1 second' where id=$1",[created.id]);
 assert.equal((await (await route.GET()).json()).conversation,null);assert.notEqual(jar.get(accessHelpCookie),secret,'Expired browser conversations rotate their proof');
 // Actual automatic conversation: ask only the missing detail, recover, and hand off.
 const autoHash=hash(randomUUID()),autoKey=randomUUID();
 const autoArgs={p_hash:autoHash,p_key:autoKey,p_email:'auto@example.invalid',p_phone:null,p_message:'Filled out the code & nothing happened.'};
 const autoId=await rpc('icash_access_help_submit',autoArgs);
 const claim=await rpc('icash_access_help_claim_reply',{p_id:autoId,p_key:autoKey});
 assert(claim.token);assert.equal(await rpc('icash_access_help_claim_reply',{p_id:autoId,p_key:autoKey}),null,'Concurrent reply has one claim');
 assert.equal(await rpc('icash_access_help_finish_reply',{p_id:autoId,p_key:autoKey,p_token:randomUUID(),p_reply:'Wrong claim',p_status:'waiting_on_customer',p_handoff:false}),false);
 await q("update icash_access_help_messages set reply_claimed_at=now()-interval '2 minutes' where request_id=$1",[autoId]);
 await recoverAccessHelpReplies(db);
 let auto=await rpc('icash_access_help_read',{p_hash:autoHash});assert.match(auto.messages.at(-1).content,/email or text/);assert.equal(auto.status,'waiting_on_customer');
 await replyToAccessHelp(db,autoId,autoKey);assert.equal((await rpc('icash_access_help_read',{p_hash:autoHash})).messages.length,2,'Retry never duplicates an automatic reply');
 for(const [question,expected] of [['email',/device and browser/],['iPhone Safari',/error message/],['No error, still nothing',/saved browser session/]]){
  const nextKey=randomUUID();await rpc('icash_access_help_submit',{...autoArgs,p_key:nextKey,p_message:question});await replyToAccessHelp(db,autoId,nextKey);auto=await rpc('icash_access_help_read',{p_hash:autoHash});assert.match(auto.messages.at(-1).content,expected);
 }
 assert.equal(auto.status,'waiting_on_customer','Unresolved problems stay in automatic troubleshooting');
 const copy=(await q("select reply from icash_support_owner_copies where source='access_help' and source_id=$1",[auto.messages.at(-2).id])).rows[0];assert.equal(copy.reply,auto.messages.at(-1).content,'Owner copy contains the actual saved answer');
 // A person replying during generation wins; the automatic answer cannot overwrite it.
 const raceKey=randomUUID();await rpc('icash_access_help_submit',{...autoArgs,p_key:raceKey,p_message:'More details'});
 const race=await rpc('icash_access_help_claim_reply',{p_id:autoId,p_key:raceKey});
 await rpc('icash_access_help_operator_update',{p_operator:owner,p_id:autoId,p_key:randomUUID(),p_status:'resolved',p_reply:'We are reviewing this with you.'});
 assert.equal(await rpc('icash_access_help_finish_reply',{p_id:autoId,p_key:raceKey,p_token:race.token,p_reply:'Late answer',p_status:'waiting_on_customer',p_handoff:false}),false);
 assert.equal((await rpc('icash_access_help_read',{p_hash:autoHash})).messages.at(-1).role,'operator');
 // The signed-in reply transaction preserves tenant binding, statuses, and one reply.
 const account=randomUUID();await q('insert into icash_accounts(id,owner_user_id) values($1,$2)',[account,owner]);const req=randomUUID();
 const thread=await rpc('icash_support_begin_message',{p_account:account,p_user:owner,p_thread:null,p_request:req,p_message:'My bot stopped'});
 const finish={p_account:account,p_user:owner,p_thread:thread.threadId,p_request:req,p_message:'Which screen are you on?',p_evidence:[],p_status:'waiting_on_customer',p_notify:true};
 await assert.rejects(()=>rpc('icash_support_finish_conversation',{...finish,p_user:other}));
 assert.equal(await rpc('icash_support_finish_conversation',finish),true);assert.equal(await rpc('icash_support_finish_conversation',finish),true);
 assert.equal((await q('select status from icash_support_threads where id=$1',[thread.threadId])).rows[0].status,'waiting_on_customer');
 assert.equal((await q("select count(*)::int as n from icash_support_messages where thread_id=$1 and role='assistant'",[thread.threadId])).rows[0].n,1);
 // A status-only resolution must also win over an in-flight assistant.
 const resolvedKey=randomUUID();await rpc('icash_support_begin_message',{p_account:account,p_user:owner,p_thread:thread.threadId,p_request:resolvedKey,p_message:'One more thing'});
 await rpc('icash_support_operator_update',{p_operator:owner,p_thread:thread.threadId,p_request:randomUUID(),p_status:'resolved',p_reply:null});
 assert.equal(await rpc('icash_support_finish_conversation',{...finish,p_request:resolvedKey}),false);
 assert.equal((await q('select status from icash_support_threads where id=$1',[thread.threadId])).rows[0].status,'resolved');
 assert.equal((await q("select count(*)::int as n from icash_support_messages where request_id=$1 and role='assistant'",[resolvedKey])).rows[0].n,0);
 // Fully answered course questions close immediately; fresh questions reopen the same thread.
 const courseKey=randomUUID(),courseQuestion='Where is the course?';
 const courseThread=await rpc('icash_support_begin_message',{p_account:account,p_user:owner,p_thread:null,p_request:courseKey,p_message:courseQuestion});
 const courseAnswer=supportConversationFallback({kind:'account',messages:[{role:'user',content:courseQuestion}]});assert.equal(courseAnswer.status,'resolved');
 await rpc('icash_support_finish_conversation',{...finish,p_thread:courseThread.threadId,p_request:courseKey,p_message:courseAnswer.reply,p_status:courseAnswer.status});
 assert.equal((await q('select status from icash_support_threads where id=$1',[courseThread.threadId])).rows[0].status,'resolved');
 assert.equal((await q("select reply from icash_support_owner_copies where source='chat' and thread_id=$1",[courseThread.threadId])).rows[0].reply,courseAnswer.reply,'Resolved reply and course reminder are included in the owner copy');
 const reopenedKey=randomUUID();await rpc('icash_support_begin_message',{p_account:account,p_user:owner,p_thread:courseThread.threadId,p_request:reopenedKey,p_message:'The course will not open'});
 assert.equal((await q('select status from icash_support_threads where id=$1',[courseThread.threadId])).rows[0].status,'open');
 await rpc('icash_support_finish_conversation',{...finish,p_thread:courseThread.threadId,p_request:reopenedKey,p_message:'What error do you see?',p_status:'waiting_on_customer'});
 assert.equal((await q('select status from icash_support_threads where id=$1',[courseThread.threadId])).rows[0].status,'waiting_on_customer');
 const guestCourse={p_hash:hash(randomUUID()),p_key:randomUUID(),p_email:'course@example.invalid',p_phone:null,p_message:courseQuestion};
 const guestId=await rpc('icash_access_help_submit',guestCourse);await replyToAccessHelp(db,guestId,guestCourse.p_key);
 assert.equal((await rpc('icash_access_help_read',{p_hash:guestCourse.p_hash})).status,'resolved');
 const guestNext=randomUUID();await rpc('icash_access_help_submit',{...guestCourse,p_key:guestNext,p_message:'My sign-in code has not arrived'});
 assert.equal((await rpc('icash_access_help_read',{p_hash:guestCourse.p_hash})).status,'open');
 await replyToAccessHelp(db,guestId,guestNext);assert.equal((await rpc('icash_access_help_read',{p_hash:guestCourse.p_hash})).status,'waiting_on_customer');
 // Verified legacy offers use the actual operator route and existing atomic
 // reply receipt: one message/email job across a lost-response retry.
 const legacyHash=hash(randomUUID()),legacyKey=randomUUID();
 const legacyId=await rpc('icash_access_help_submit',{p_hash:legacyHash,p_key:legacyKey,p_email:'legacy@example.invalid',p_phone:null,p_message:'My original iCash X 1.0 stopped working.'});
 await replyToAccessHelp(db,legacyId,legacyKey);
 let legacy=await rpc('icash_access_help_read',{p_hash:legacyHash});assert.match(legacy.messages.at(-1).content,/no longer active/);assert.doesNotMatch(legacy.messages.at(-1).content,/legacy-offer/);
 const offerKey=randomUUID(),offer={id:legacyId,requestId:offerKey,status:'waiting_on_customer',legacyPurchaseVerified:true};
 const sendOffer=()=>admin.POST(new Request('https://example.invalid/api/support/admin/access',{method:'POST',body:JSON.stringify(offer)}));
 assert.equal((await sendOffer()).status,200);assert.equal((await sendOffer()).status,200);
 legacy=await rpc('icash_access_help_read',{p_hash:legacyHash});assert.equal(legacy.messages.filter(m=>m.content===supportVerifiedLegacyOfferReply).length,1);assert.equal(legacy.status,'waiting_on_customer');
 assert.equal((await q('select operator_id from icash_access_help_messages where request_id=$1 and role=\'operator\'',[legacyId])).rows[0].operator_id,owner);
 assert.equal((await q('select count(*)::int as n from icash_support_customer_emails where access_request_id=$1',[legacyId])).rows[0].n,2,'Initial guidance and one reviewed offer, without duplicate notifications');
 for(const role of ['anon','authenticated']){await pg.exec('set role '+role);await assert.rejects(()=>q('select * from icash_access_help_requests'));await assert.rejects(()=>q('select * from icash_purchase_access_attention'));await assert.rejects(()=>rpc('icash_access_help_read',{p_hash:a}));await assert.rejects(()=>rpc('icash_access_help_claim_reply',{p_id:autoId,p_key:autoKey}));await assert.rejects(()=>rpc('icash_access_help_pending_replies',{}));await assert.rejects(()=>rpc('icash_queue_purchase_access_attention',{}));await pg.exec('reset role');}
 console.log('PASS access help: actual private SQL and routes, no-login requests and replies, no purchase disclosure, redacted codes, secure browser binding, operator authorization, replay recovery, rate bounds, expiry, positive payment monitoring, resolved queue, grouped owner notices and deferred customer email jobs. All sends mocked.');
}finally{await pg.close();}
