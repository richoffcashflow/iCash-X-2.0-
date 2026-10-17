import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {databaseAdapter,loadService} from './helpers/simulated-journey-services.mjs';
import {accessHelpCookie,accessHelpInput,accessHelpUpdate,accessHelpRedact} from '../lib/access-help.ts';
import {normalizeAccessPhone} from '../lib/purchase-phone-access.ts';
import {processSupportOwnerNotifications} from '../lib/support-owner-notifications.ts';
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
 await processSupportOwnerNotifications({db,env,transport,limit:10,monitorAccess:true});await processSupportOwnerNotifications({db,env,transport,limit:10,monitorAccess:true});assert.equal(sent.length,12);assert(sent.some(message=>message.text.includes('email address not verified')));

 // Real route functions: no login dependency, secure browser proof, CSRF, replay and private replies.
 const jar=new Map(),cookieOptions=new Map();let allowed=true,scheduled=0;
 const cookies=async()=>({get:name=>jar.has(name)?{value:jar.get(name)}:undefined,set:(name,value,options)=>{jar.set(name,value);cookieOptions.set(name,options);}});
 const route=await loadService('app/api/support/access/route.ts',{cookies,randomBytes,createHash,db,allowedOrigin:()=>allowed,limitRequest:async()=>{},normalizeAccessPhone,accessHelpCookie,accessHelpInput,accessHelpRedact,scheduleSupportOwnerNotifications:()=>{scheduled++;},process:{env:{VERCEL_ENV:'production'}}});
 assert.equal((await route.GET()).status,200);const secret=jar.get(accessHelpCookie);assert(cookieOptions.get(accessHelpCookie).httpOnly&&cookieOptions.get(accessHelpCookie).secure);await route.GET();assert.equal(jar.get(accessHelpCookie),secret,'Refresh before a first message preserves browser proof');
 const post=body=>route.POST(new Request('https://example.invalid/api/support/access',{method:'POST',body:JSON.stringify(body)}));
 const body={requestId:randomUUID(),email:'new@example.invalid',phone:'2125559999',message:'I cannot get either code.'};
 allowed=false;assert.equal((await post(body)).status,403);allowed=true;
 let response=await post(body);assert.equal(response.status,200);let created=(await response.json()).conversation;assert.equal(created.messages.length,1);assert.equal(created.phone,'+12125559999');assert.equal(scheduled,1);
 await post(body);assert.equal((await (await route.GET()).json()).conversation.messages.length,1);
 assert.equal((await post({...body,email:'invalid'})).status,400);
 assert.equal((await post({...body,phone:'letters'})).status,400);
 const admin=await loadService('app/api/support/admin/access/route.ts',{db,requireTrustedOperator:async()=>{if(!allowed)throw Error('OPERATOR_REQUIRED');return {userId:owner};},allowedOrigin:()=>allowed,accessHelpUpdate,accessHelpRedact});
 allowed=false;assert.equal((await admin.GET(new Request('https://example.invalid/api/support/admin/access'))).status,403);allowed=true;
 response=await admin.GET(new Request('https://example.invalid/api/support/admin/access?id='+created.id));assert.equal(response.status,200);assert(!JSON.stringify(await response.json()).includes('session_hash'));
 response=await admin.POST(new Request('https://example.invalid/api/support/admin/access',{method:'POST',body:JSON.stringify({id:created.id,requestId:randomUUID(),status:'waiting_on_customer',reply:'Please choose Use my checkout phone on the access page.'})}));assert.equal(response.status,200);
 assert.equal((await (await route.GET()).json()).conversation.messages.at(-1).role,'operator');
 await q("update icash_access_help_requests set expires_at=now()-interval '1 second' where id=$1",[created.id]);
 assert.equal((await (await route.GET()).json()).conversation,null);assert.notEqual(jar.get(accessHelpCookie),secret,'Expired browser conversations rotate their proof');
 for(const role of ['anon','authenticated']){await pg.exec('set role '+role);await assert.rejects(()=>q('select * from icash_access_help_requests'));await assert.rejects(()=>q('select * from icash_purchase_access_attention'));await assert.rejects(()=>rpc('icash_access_help_read',{p_hash:a}));await assert.rejects(()=>rpc('icash_queue_purchase_access_attention',{}));await pg.exec('reset role');}
 console.log('PASS access help: actual private SQL and routes, no-login requests and replies, no purchase disclosure, redacted codes, secure browser binding, operator authorization, replay recovery, rate bounds, expiry, positive payment monitoring, resolved queue, grouped owner notices and no customer sends.');
}finally{await pg.close();}
