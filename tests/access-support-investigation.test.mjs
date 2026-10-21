import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {databaseAdapter} from './helpers/simulated-journey-services.mjs';
import {investigateAccess} from '../lib/support-access-investigation.ts';
import {replyToSupport} from '../lib/support-conversation.ts';
import {replyToAccessHelp} from '../lib/access-help-replies.ts';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const sql=read('config/access-support-investigation.sql');
assert.equal(sql,read('supabase/migrations/20261021040000_access_support_investigation.sql'));
const pg=await PGlite.create(),{db,rpc,q}=databaseAdapter(pg);
const env={VERCEL_ENV:'production',ICASH_AUTH_EMAIL_READY:'true',CONTIGUITY_API_KEY:'fixture',CONTIGUITY_WEBHOOK_SECRET:'fixture'};
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table icash_access_help_requests(id uuid primary key,email text,phone text,status text default 'open',expires_at timestamptz default now()+interval '1 day',needs_operator boolean default false,session_hash text);
 create table icash_access_help_messages(id uuid primary key default gen_random_uuid(),request_id uuid,request_key uuid,role text,content text,created_at timestamptz default now(),reply_token uuid,reply_claimed_at timestamptz,reply_completed_at timestamptz);
 create table icash_memberships(id uuid primary key,mode text,payer_email text);
 create table icash_membership_invoices(membership_id uuid,amount_cents bigint);
 create table icash_webinar_text_senders(enabled boolean);
 create table icash_purchase_access_emails(id uuid primary key,membership_id uuid,recipient text,status text,delivery text,created_at timestamptz default now(),updated_at timestamptz default now());
 create table icash_purchase_phone_challenges(id uuid primary key,membership_id uuid,email text,phone text,status text,provider_id text,requested_at timestamptz default now());
 alter table icash_access_help_messages enable row level security;alter table icash_access_help_requests enable row level security;
 revoke all on all tables in schema public from public,anon,authenticated;grant all on all tables in schema public to service_role;
 create function icash_access_help_recover(p_id uuid,p_key uuid,p_token uuid) returns void language sql as 'select null::void';`);
 await pg.exec(read('supabase/migrations/20261017213055_support_conversation_replies.sql').match(/create function public\.icash_access_help_claim_reply[\s\S]*?end \$\$;/)[0]);
 await pg.exec(read('supabase/migrations/20261017185057_paid_access_support.sql').match(/create function public\.icash_access_help_read[\s\S]*?\$\$;/)[0]);
 await pg.exec(sql);
 const id=randomUUID(),key=randomUUID(),membership=randomUUID();
 await q('insert into icash_access_help_requests(id,email,phone,session_hash) values($1,$2,$3,$4)',[id,'guest@example.invalid','+12125551234','browser-proof']);
 await q('insert into icash_access_help_messages(request_id,request_key,role,content) values($1,$2,$3,$4)',[id,key,'user','No email code arrived']);
 const claim=await rpc('icash_access_help_claim_reply',{p_id:id,p_key:key});
 const args={p_id:id,p_key:key,p_token:claim.token,p_email_ready:true,p_phone_ready:true,p_recovery:'checked'};
 assert.equal(await rpc('icash_access_help_investigate',{...args,p_token:randomUUID()}),null);
 assert.equal((await q('select access_investigation from icash_access_help_messages')).rows[0].access_investigation,null);
 let result=await rpc('icash_access_help_investigate',args);
 assert.deepEqual(result,{checked:true,email:'configured',phone:'unavailable'},'No enabled sender means no suggested text sign-in');
 await pg.exec('insert into icash_webinar_text_senders values(true)');
 const noPurchase=await rpc('icash_access_help_investigate',args);
 await q('insert into icash_memberships values($1,$2,$3)',[membership,'live','guest@example.invalid']);
 await q('insert into icash_membership_invoices values($1,5000)',[membership]);
 await q('insert into icash_purchase_access_emails(id,membership_id,recipient,status,delivery) values($1,$2,$3,$4,$5)',[randomUUID(),membership,'guest@example.invalid','sent','delivered']);
 await q('insert into icash_purchase_phone_challenges(id,membership_id,email,phone,status,provider_id) values($1,$2,$3,$4,$5,$6)',[randomUUID(),membership,'guest@example.invalid','+12125551234','sent','fixture-receipt']);
 assert.deepEqual(await rpc('icash_access_help_investigate',args),noPurchase,'Guest response cannot enumerate payment, phone or email delivery records');
 const audit=(await q('select access_investigation from icash_access_help_messages')).rows[0].access_investigation;
 assert.equal(audit.receiptEmailMatch,true);assert.equal(audit.purchaseEmail.delivery,'delivered');assert.equal(audit.phoneChallenge.hasReceipt,true);assert.equal(audit.emailCodeDelivery,'unverified');
 assert.doesNotMatch(JSON.stringify(audit),/guest@|1212555|fixture-receipt/,'No destinations, secrets or provider IDs in diagnostic audit');
 const guest=await rpc('icash_access_help_read',{p_hash:'browser-proof'});
 assert.doesNotMatch(JSON.stringify(guest),/access_investigation|receiptEmailMatch|hasReceipt|purchaseEmail/,'Private findings never appear in guest conversation');
 assert.deepEqual(await investigateAccess(db,id,key,claim.token,env),{...noPurchase,recovery:'checked'});
 const unavailable=await investigateAccess(async(path,...rest)=>{if(path.includes('recover'))throw Error('fixture unavailable');return db(path,...rest);},id,key,claim.token,env);
 assert.equal(unavailable.recovery,'unavailable');assert.equal((await q('select access_investigation from icash_access_help_messages')).rows[0].access_investigation.recovery,'unavailable');
 assert.equal((await investigateAccess(async()=>{throw Error('unavailable');},id,key,claim.token,env)).checked,false);
 // Operator and newer user turns win over a stale investigation, just as they
 // win over final reply insertion. No resends, repair expansion or identity changes.
 await q("insert into icash_access_help_messages(request_id,role,content,created_at) values($1,'operator','Payment checked; access unresolved',now()+interval '1 second')",[id]);
 assert.equal(await rpc('icash_access_help_investigate',args),null);
 await q("delete from icash_access_help_messages where role='operator'");
 await q("update icash_access_help_messages set reply_claimed_at=now()-interval '2 minutes'");assert.equal(await rpc('icash_access_help_investigate',args),null);
 await q('update icash_access_help_messages set reply_claimed_at=now(),reply_completed_at=now()');assert.equal(await rpc('icash_access_help_investigate',args),null);
 await q('update icash_access_help_messages set reply_completed_at=null');
 await q("update icash_access_help_requests set expires_at=now()-interval '1 second'");assert.equal(await rpc('icash_access_help_investigate',args),null);
 for(const role of ['anon','authenticated']){await pg.exec('set role '+role);await assert.rejects(()=>rpc('icash_access_help_investigate',args));await assert.rejects(()=>q('select access_investigation from icash_access_help_messages'));await pg.exec('reset role');}
 const definition=(await q("select pg_get_functiondef('icash_access_help_claim_reply(uuid,uuid)'::regprocedure) as body")).rows[0].body;assert.match(definition,/limit 200\)/);

 // Reproduce the real failed sequence without contacting any auth/provider API.
 const conversation=[],replies=[],check={checked:true,email:'configured',phone:'unavailable',recovery:'checked'};
 for(const question of ['I paid through Apple Pay - no email or code came','Yes it matches','I’ve done it a few times','No code came to the phone or email','I’ve already done that .','Are you going to send it ?','Refund','You’re not sending my code I’ve already used my email and checkout phone number','I did that already !','Cancel!']){
  conversation.push({role:'user',content:question});
  const answer=await replyToSupport({kind:'access',messages:conversation,accessInvestigation:check},async()=>{throw Error('No model/provider request allowed');});
  assert.notEqual(answer.status,'resolved');assert.notEqual(answer.status,'closed');assert.equal(answer.ai,false);
  assert.doesNotMatch(answer.reply,/Use another email or resend|Choose .Use my checkout phone|code is on its way|I.(?:ve| have) (?:sent|resent|cancelled)|which sign-in step fails/i);
  if(replies.length>=2)assert.doesNotMatch(answer.reply,/request one fresh code|spam or junk/);
  if(question==='Cancel!')assert.match(answer.reply,/has not cancelled/);
  replies.push(answer.reply);conversation.push({role:'assistant',content:answer.reply});
 }
 assert.equal(replies.filter(reply=>/request one fresh code/.test(reply)).length,1);
 for(const text of ['I’m trying to login it will not send me a email or text','I’ve entered my phone number and email but have not gotten a sign in code to either and I already paid','It never sent me the sign in code in the first place',"It didn't send a text",'I cannot get either code']){
  const answer=await replyToSupport({kind:'access',messages:[{role:'user',content:'I need my email sign-in code'},{role:'user',content:text}],accessInvestigation:check});
  assert.doesNotMatch(answer.reply,/enter the newest code|device and browser|code is on its way|Choose .Use my checkout phone/i);assert.notEqual(answer.status,'resolved');
 }
 conversation.push({role:'operator',content:'The payment screenshot matches. The checkout email differs from your support email. Your next renewal was stopped. Access is unresolved.'},{role:'user',content:'Still no email code'});
 const afterOperator=await replyToSupport({kind:'access',messages:conversation,accessInvestigation:check});
 assert.match(afterOperator.reply,/already recorded/);assert.doesNotMatch(afterOperator.reply,/What are the payment date|request one fresh/);
 conversation.push({role:'user',content:'Cancel'});
 assert.match((await replyToSupport({kind:'access',messages:conversation,accessInvestigation:check})).reply,/confirms your next renewal was stopped/);
 // The actual reply service must use check results and keep the finish lease.
 const calls=[];
 await replyToAccessHelp(async(path,method,body)=>{calls.push({path,body});
  if(path.endsWith('claim_reply'))return {token:'lease',messages:[{role:'user',content:'No email code arrived'}]};
  if(path.endsWith('investigate'))return {checked:true,email:'configured',phone:'unavailable'};
 },'case','turn');
 assert.deepEqual(calls.map(c=>c.path),['rpc/icash_access_help_claim_reply','rpc/icash_access_help_recover','rpc/icash_access_help_investigate','rpc/icash_access_help_finish_reply']);
 assert.match(calls.at(-1).body.p_reply,/Text sign-in is currently unavailable/);assert.equal(calls.at(-1).body.p_token,'lease');assert.equal(calls.at(-1).body.p_handoff,false);
 console.log('PASS real access investigation SQL, private non-enumerating evidence, unknown delivery, unavailable channels, leases/ACLs/operator precedence and actual repeated-code conversation. No real sends.');
}finally{await pg.close();}
