import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {databaseAdapter} from './helpers/simulated-journey-services.mjs';
import {replyToSupport} from '../lib/support-conversation.ts';
import {refundOnly,repeatedRefundReply} from '../lib/support-closure.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const history=[];
for(let i=0;i<3;i++){
 history.push(user(i===1?'No I still want my money back':'I want a refund'));
 const answer=await replyToSupport({kind:'account',messages:history,allowAI:false});
 assert.equal(answer.status,i===2?'closed':'waiting_on_customer');
 history.push(assistant(answer.reply));
}
assert.match(history.at(-1).content,/closing this chat/);assert.match(history.at(-1).content,/reopen/);
assert.doesNotMatch(history.at(-1).content,/resolved|fixed|Course|team|human/i);
for(const question of ['Refund me, you charged twice','I want a refund and cancel my subscription','I want a refund because I cannot sign in','I want a refund. I paid $50 on October 19','Why is my refund pending?','I want a refund $100','I do not want a refund','Don’t refund me','I did not authorize this charge. Refund me','I want a refund under my consumer rights']){
 assert.equal(refundOnly(question),false,question);
 const answer=await replyToSupport({kind:'account',messages:[...history,user(question)],allowAI:false});assert.notEqual(answer.status,'closed',question);
}
for(const issue of ['You charged me twice','No email code arrives','I cannot cancel my subscription','My bot has stopped'])assert.equal(repeatedRefundReply([user(issue),...history,user('I want a refund')]),null,'Unresolved history cannot be ignored');
assert.equal(repeatedRefundReply([...history,user('I want a refund')],[{key:'payments',status:'attention',code:'payment_uncredited'}]),null);
assert.equal(repeatedRefundReply([user('I want a refund'),user('I want a refund'),user('I want a refund')]),null,'Must actually explain policy and give notice first');
const pg=await PGlite.create(),{rpc,q}=databaseAdapter(pg);
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const account=randomUUID(),owner=randomUUID(),operator=randomUUID();
const row=async(sql,args)=>(await q(sql,args)).rows[0];
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
 for(const file of ['config/support-center.sql','config/support-owner-notifications.sql','supabase/migrations/20261017185057_paid_access_support.sql','supabase/migrations/20261017213055_support_conversation_replies.sql','supabase/migrations/20261017214402_support_operator_resolution_guard.sql','supabase/migrations/20261017222557_support_customer_reply_email.sql','supabase/migrations/20261018065930_automated_support_resolution.sql'])await pg.exec(read(file));

 await pg.exec(read('config/support-conversation-closure.sql'));
 await pg.exec(read('supabase/migrations/20261106185532_support_management_review.sql'));
 await q('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'member@example.invalid',operator,'operator@example.invalid']);
 await q('insert into icash_accounts values($1,$2,false)',[account,owner]);
 await q("insert into icash_trusted_operators values($1,null,now()+interval '1 day',array['support'])",[operator]);
 const chat=async({status='waiting_on_customer',role='assistant',age=25}={})=>{
  const id=randomUUID();await q("insert into icash_support_threads(id,account_id,subject,status,updated_at) values($1,$2,'Fixture',$3,now()-($4||' hours')::interval)",[id,account,status,String(age)]);
  await q("insert into icash_support_messages(thread_id,account_id,request_id,role,content,created_at) values($1,$2,$3,$4,'Fixture last turn',now()-($5||' hours')::interval)",[id,account,randomUUID(),role,String(age)]);return id;
 };
 const guest=async({status='waiting_on_customer',role='assistant',age=25,needs=false}={})=>{
  const id=randomUUID();await q("insert into icash_access_help_requests(id,session_hash,email,status,updated_at,needs_operator) values($1,$2,'guest@example.invalid',$3,now()-($4||' hours')::interval,$5)",[id,id.replaceAll('-','').repeat(2),status,String(age),needs]);
  await q("insert into icash_access_help_messages(request_id,request_key,role,content,created_at) values($1,$2,$3,'Fixture last turn',now()-($4||' hours')::interval)",[id,randomUUID(),role,String(age)]);return id;
 };
 const idle=await chat(),idleGuest=await guest();
 const untouched=[await chat({role:'user'}),await chat({status:'open'}),await chat({age:23})];
 const untouchedGuests=[await guest({role:'user'}),await guest({status:'open'}),await guest({age:23}),await guest({needs:true})];
 const mailBefore=(await row('select count(*)::int n from icash_support_customer_emails')).n;
 await pg.exec('set role service_role');
 assert.deepEqual(await rpc('icash_close_inactive_support',{}),{accountChats:1,guestChats:1});
 assert.deepEqual(await rpc('icash_close_inactive_support',{}),{accountChats:0,guestChats:0},'Repeat maintenance cannot duplicate closure notices');
 assert.equal((await row('select status from icash_support_threads where id=$1',[idle])).status,'closed');
 assert.equal((await row('select status from icash_access_help_requests where id=$1',[idleGuest])).status,'closed');
 assert.equal((await row('select count(*)::int n from icash_support_messages where thread_id=$1',[idle])).n,2,'Existing history retained plus one notice');
 assert.equal((await row('select count(*)::int n from icash_support_customer_emails')).n,mailBefore,'Inactivity never sends email');
 for(const id of untouched)assert.notEqual((await row('select status from icash_support_threads where id=$1',[id])).status,'closed');
 for(const id of untouchedGuests)assert.notEqual((await row('select status from icash_access_help_requests where id=$1',[id])).status,'closed');
 const key=randomUUID();await rpc('icash_support_begin_message',{p_account:account,p_user:owner,p_thread:idle,p_request:key,p_message:'New problem: cannot sign in'});
 assert.equal((await row('select status from icash_support_threads where id=$1',[idle])).status,'open');
 assert.deepEqual(await rpc('icash_close_inactive_support',{}),{accountChats:0,guestChats:0},'New user reply wins over stale inactivity');
 const finish={p_account:account,p_user:owner,p_thread:idle,p_request:key,p_message:'I am closing this chat. Reply to reopen.',p_evidence:[],p_status:'closed',p_notify:false};
 assert.equal(await rpc('icash_support_finish_conversation',finish),true);assert.equal(await rpc('icash_support_finish_conversation',finish),true);
 await assert.rejects(rpc('icash_support_begin_message',{p_account:account,p_user:randomUUID(),p_thread:idle,p_request:randomUUID(),p_message:'Wrong user'}));
 const fresh=await rpc('icash_support_begin_message',{p_account:account,p_user:owner,p_thread:idle,p_request:randomUUID(),p_message:'Different issue'});
 const request=(await row("select request_id from icash_support_messages where thread_id=$1 and content='Different issue'",[idle])).request_id;
 await rpc('icash_support_operator_update',{p_operator:operator,p_thread:idle,p_request:randomUUID(),p_status:'closed',p_reply:null});
 assert.equal(await rpc('icash_support_finish_conversation',{...finish,p_request:request,p_status:'waiting_on_customer'}),false,'Late generated reply cannot reopen an operator closure');
 const guestKey=randomUUID(),secret=idleGuest.replaceAll('-','').repeat(2);
 await rpc('icash_access_help_submit',{p_hash:secret,p_key:guestKey,p_email:'guest@example.invalid',p_phone:null,p_message:'New sign-in issue'});
 assert.equal((await row('select status from icash_access_help_requests where id=$1',[idleGuest])).status,'open');
 const claim=await rpc('icash_access_help_claim_reply',{p_id:idleGuest,p_key:guestKey});assert(claim.token);
 assert.equal(await rpc('icash_access_help_finish_reply',{p_id:idleGuest,p_key:guestKey,p_token:claim.token,p_reply:'Closing this chat for now. Reply here to reopen.',p_status:'closed',p_handoff:false}),true);
 assert.equal(await rpc('icash_access_help_claim_reply',{p_id:idleGuest,p_key:guestKey}),null,'Closed guest request cannot be reclaimed');
 const pending=await rpc('icash_access_help_pending_replies',{});assert(!pending.some(x=>x.id===idleGuest));
 assert.equal((await row('select bot_paused from icash_accounts where id=$1',[account])).bot_paused,false,'Closing support does not pause customer work');
 await pg.exec('reset role');
 for(const role of ['anon','authenticated'])await assert.rejects(pg.exec(`set role ${role};select icash_close_inactive_support();`).finally(()=>pg.exec('reset role')));
 for(let i=0;i<101;i++)await chat({role:'user',age:48});
 for(let i=0;i<101;i++)await chat();
 await pg.exec('set role service_role');assert.equal((await rpc('icash_close_inactive_support',{})).accountChats,100);assert.equal((await rpc('icash_close_inactive_support',{})).accountChats,1,'Bounded batch carries remaining work forward');
 // A saved review survives additional customer turns, bot follow-ups and cleanup.
 const reviewed=await chat({status:'open'}), reviewKey=randomUUID();
 const askReview={p_account:account,p_user:owner,p_thread:reviewed,p_request:reviewKey,p_message:'Please request management review'};
 await rpc('icash_support_begin_message',askReview);
 const saveReview={p_account:account,p_user:owner,p_thread:reviewed,p_request:reviewKey,p_message:'Flagged for management review.',p_status:'management_review',p_evidence:[],p_notify:false};
 assert.equal(await rpc('icash_support_finish_conversation',saveReview),true);
 assert.equal(await rpc('icash_support_finish_conversation',saveReview),true);
 assert.equal((await row("select count(*)::int n from icash_support_messages where request_id=$1 and role='assistant'",[reviewKey])).n,1);
 assert.equal((await row('select status from icash_support_threads where id=$1',[reviewed])).status,'escalated');
 await assert.rejects(rpc('icash_support_finish_conversation',{...saveReview,p_user:randomUUID()}));
 const again=randomUUID();await rpc('icash_support_begin_message',{...askReview,p_request:again,p_message:'Another detail'});
 assert.equal(await rpc('icash_support_finish_conversation',{...saveReview,p_request:again,p_status:'resolved'}),true);
 assert.equal((await row('select status from icash_support_threads where id=$1',[reviewed])).status,'escalated');
 const late=randomUUID();await rpc('icash_support_begin_message',{...askReview,p_request:late});
 await rpc('icash_support_operator_update',{p_operator:operator,p_thread:reviewed,p_status:'waiting_on_customer',p_request:randomUUID(),p_reply:null});
 assert.equal(await rpc('icash_support_finish_conversation',{...saveReview,p_request:late}),false);
 const visitor=await guest({status:'open'}), guestAsk=randomUUID();
 const visitorReply={p_id:visitor,p_key:guestAsk,p_status:'management_review',p_reply:'Flagged for management review.',p_handoff:true};
 const addGuest=async(key)=>{await q("insert into icash_access_help_messages(request_id,request_key,role,content) values($1,$2,'user','Help')",[visitor,key]);return rpc('icash_access_help_claim_reply',{p_id:visitor,p_key:key});};
 const lease=await addGuest(guestAsk);
 assert.equal(await rpc('icash_access_help_finish_reply',{...visitorReply,p_token:randomUUID()}),false);
 assert.equal(await rpc('icash_access_help_finish_reply',{...visitorReply,p_token:lease.token}),true);
 let more=randomUUID(),next=await addGuest(more);assert.equal(next.handedOff,true);
 assert.equal(await rpc('icash_access_help_finish_reply',{...visitorReply,p_key:more,p_token:next.token,p_status:'waiting_on_customer',p_handoff:false}),true);
 assert.deepEqual(await row('select status,needs_operator from icash_access_help_requests where id=$1',[visitor]),{status:'open',needs_operator:true});
 more=randomUUID();next=await addGuest(more);
 await rpc('icash_access_help_operator_update',{p_operator:operator,p_id:visitor,p_key:randomUUID(),p_status:'waiting_on_customer',p_reply:null});
 assert.equal(await rpc('icash_access_help_finish_reply',{...visitorReply,p_key:more,p_token:next.token}),false);
 assert.deepEqual(await row('select status,needs_operator from icash_access_help_requests where id=$1',[visitor]),{status:'waiting_on_customer',needs_operator:false});
 // Current policy: waiting for a reply never establishes customer recovery.
 // Install the prospective correction after exercising the historical migration.
 await pg.exec('reset role');
 const waitingAccount=await chat({role:'operator',age:49});
 const waitingGuest=await guest({role:'operator',age:49});
 await q("update icash_support_messages set content='The display correction is installed. Please confirm whether your original issue is resolved.' where thread_id=$1",[waitingAccount]);
 await q("update icash_access_help_messages set content='The purchase email correction is complete. Access is still unconfirmed; please tell us whether sign-in works.' where request_id=$1",[waitingGuest]);
 const changedTopic=await chat({age:49});
 await q("update icash_support_messages set content='The course is in your workspace. Your earlier activity issue has no confirmed result.' where thread_id=$1",[changedTopic]);
 const ordinaryQuestion=await guest({age:49});
 const resolvedAccount=await chat({status:'resolved',role:'user',age:49});
 const resolvedGuest=await guest({status:'resolved',role:'user',age:49});
 for(const [table,column,id] of [['icash_support_messages','thread_id',resolvedAccount],['icash_access_help_messages','request_id',resolvedGuest]])await q(`update ${table} set content='That worked. I can sign in now.' where ${column}=$1`,[id]);
 const historicalClosed=await guest({status:'closed',age:49});
 const beforeFunction=await row("select oid,proowner,proacl::text,prosecdef,proconfig from pg_proc where oid='public.icash_close_inactive_support()'::regprocedure");
 await pg.exec(read('supabase/migrations/20261113161650_preserve_waiting_support_cases.sql'));
 await pg.exec(read('supabase/migrations/20261113161650_preserve_waiting_support_cases.sql')); // Exact replay is harmless.
 const afterFunction=await row("select oid,proowner,proacl::text,prosecdef,proconfig from pg_proc where oid='public.icash_close_inactive_support()'::regprocedure");
 assert.deepEqual(afterFunction,beforeFunction,'Function identity, owner, private ACLs and invoker mode remain intact');
 const capture=async()=>row(`select
  (select jsonb_agg(to_jsonb(t) order by id) from icash_support_threads t) accounts,
  (select jsonb_agg(to_jsonb(t) order by id) from icash_access_help_requests t) guests,
  (select count(*)::int from icash_support_messages) account_messages,
  (select count(*)::int from icash_access_help_messages) guest_messages,
  (select count(*)::int from icash_support_customer_emails) customer_emails`);
 const beforeMaintenance=await capture();
 await pg.exec('set role service_role');
 for(let i=0;i<2;i++)assert.deepEqual(await rpc('icash_close_inactive_support',{}),{accountChats:0,guestChats:0},'Silence cannot close unresolved cases, including after an operator repair');
 assert.deepEqual(await capture(),beforeMaintenance,'No timestamps, statuses, queue flags, history or customer notifications change');
 for(const id of [waitingAccount,changedTopic])assert.equal((await row('select status from icash_support_threads where id=$1',[id])).status,'waiting_on_customer');
 for(const id of [waitingGuest,ordinaryQuestion])assert.equal((await row('select status from icash_access_help_requests where id=$1',[id])).status,'waiting_on_customer');
 assert.equal((await row('select status from icash_access_help_requests where id=$1',[historicalClosed])).status,'closed','No bulk historical reopening');
 assert.equal((await row('select status from icash_support_threads where id=$1',[resolvedAccount])).status,'resolved','Preserve independently confirmed outcomes');
 assert.equal((await row('select status from icash_access_help_requests where id=$1',[resolvedGuest])).status,'resolved');
 await pg.exec('reset role');
 for(const role of ['anon','authenticated'])await assert.rejects(pg.exec(`set role ${role};select icash_close_inactive_support();`).finally(()=>pg.exec('reset role')));
 // Refuse to overwrite an independently changed maintenance implementation.
 await pg.exec('begin');
 await pg.exec("create or replace function public.icash_close_inactive_support() returns jsonb language plpgsql security invoker set search_path='' as $$begin return '{}'::jsonb;end$$");
 await assert.rejects(pg.exec(read('supabase/migrations/20261113161650_preserve_waiting_support_cases.sql')),/Support inactivity source changed/);
 await pg.exec('rollback');
 console.log('PASS support closure: polite policy/warning/close, new issues and payment evidence protected, historical bounded closure and prospective waiting-case preservation, no email fanout, preserved history, account/guest reopen, idempotency, operator races, private ACLs. Local fixtures only.');
}finally{await pg.close();}
