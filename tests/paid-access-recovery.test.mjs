import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {databaseAdapter,loadService} from './helpers/simulated-journey-services.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const pg=await PGlite.create(),{rpc,q}=databaseAdapter(pg);
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
 create table icash_accounts(id uuid primary key default gen_random_uuid(),owner_user_id uuid unique,assistant_name text,billing_model text,bot_paused boolean default true);
 create table icash_wallets(account_id uuid primary key);create table icash_notification_preferences(account_id uuid primary key);
 create table icash_funding_orders(id uuid primary key,account_id uuid,payer_email text,mode text,state text,credited_at timestamptz,credit_cents bigint,stripe_payment_id text);
 create table icash_memberships(id uuid primary key,mode text,state text,paid_through timestamptz,payer_email text,stripe_session_id text,account_id uuid,guest_hash text,created_at timestamptz default now());
 create unique index icash_membership_account on icash_memberships(account_id,mode) where state<>'cancelled';
 create table icash_membership_invoices(membership_id uuid,stripe_payment_id text);
 create table icash_billing_reviews(payment_id text,resolved_at timestamptz,account_id uuid);
 create table icash_bot_setups(id uuid primary key,account_id uuid,guest_hash text);
 create function icash_post_credit(uuid,text,text,bigint,text) returns void language sql as 'select';`);
 await pg.exec(read('supabase/migrations/20260928015426_icash_idempotent_account_provisioning.sql'));
 await pg.exec(read('supabase/migrations/20261003223200_membership_and_prepaid_credits.sql').match(/CREATE OR REPLACE FUNCTION public\.icash_claim_funding[\s\S]*?\$function\$\s*;/)[0]);
 const owner=randomUUID(),first=randomUUID(),second=randomUUID();
 await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[owner,'paid@example.invalid']);
 for(const [id,age] of [[first,'2 minutes'],[second,'0 minutes']])await q("insert into icash_memberships(id,mode,state,paid_through,payer_email,created_at) values($1,'live','active',now()+interval '30 days','paid@example.invalid',now()-$2::interval)",[id,age]);
 await assert.rejects(()=>rpc('icash_claim_funding',{p_user:owner,p_mode:'live'}),/duplicate key/,'Reproduce the real paid-access failure with two purchases');
 assert.equal((await q('select count(*)::int n from icash_accounts')).rows[0].n,0,'Failed claim originally rolled back the entire account');
 await pg.exec(read('supabase/migrations/20261018065937_duplicate_safe_paid_access.sql'));
 const account=await rpc('icash_claim_funding',{p_user:owner,p_mode:'live'});
 assert.equal((await q('select account_id from icash_memberships where id=$1',[first])).rows[0].account_id,account);
 assert.equal((await q('select account_id from icash_memberships where id=$1',[second])).rows[0].account_id,null,'Additional purchase is preserved for reconciliation');
 assert.equal(await rpc('icash_claim_funding',{p_user:owner,p_mode:'live'}),account,'Repeat claim is idempotent');
 assert.equal((await q("select count(*)::int n from icash_memberships where state='active'")).rows[0].n,2,'Claim does not cancel or refund any purchase');
 await q("update icash_memberships set state='cancelled' where id=$1",[second]);
 await rpc('icash_claim_funding',{p_user:owner,p_mode:'live'});
 assert.equal((await q('select account_id from icash_memberships where id=$1',[second])).rows[0].account_id,account,'Cancelled purchase history stays linked without blocking access');
 const unknown=randomUUID();await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,null)',[unknown,'unverified@example.invalid']);
 await assert.rejects(()=>rpc('icash_claim_funding',{p_user:unknown,p_mode:'live'}),/Verified/,'An email string cannot grant account access');
 const a=randomUUID(),b=randomUUID(),c=randomUUID();
 for(const id of [a,b,c])await q("insert into icash_memberships(id,mode,state) values($1,'live','pending')",[id]);
 const reserve=(id,email)=>rpc('icash_reserve_membership_email',{p_membership:id,p_email:email});
 assert.equal(await reserve(a,' PAID@example.invalid '),false,'Existing paid subscription blocks another browser checkout');
 assert.equal(await reserve(a,'fresh@example.invalid'),true);
 assert.equal(await reserve(b,'FRESH@example.invalid'),false,'Concurrent browsers share an email reservation');
 assert.equal(await reserve(a,'fresh@example.invalid'),true,'Same checkout retry remains allowed');
 assert.equal(await reserve(a,'changed@example.invalid'),false,'A concurrent request cannot swap an already reserved email');
 await q("update icash_memberships set checkout_email_reserved_until=now()-interval '1 second' where id=$1",[a]);
 assert.equal(await reserve(b,'fresh@example.invalid'),true,'Abandoned reservations eventually release');
 await q("update icash_memberships set state='cancelled' where id=$1",[b]);
 assert.equal(await reserve(c,'fresh@example.invalid'),true,'Expired checkout replacement works');
 for(const role of ['anon','authenticated']){await pg.exec('set role '+role);await assert.rejects(()=>reserve(c,'fresh@example.invalid'));await pg.exec('reset role');}
 // Guest support may repair a verified identity, but cannot authenticate the visitor
 // or disclose account details. A reply lease is required even for the repair.
 await pg.exec(`create table icash_access_help_requests(id uuid primary key,email text,expires_at timestamptz);
 create table icash_access_help_messages(request_id uuid,request_key uuid,role text,reply_token uuid,reply_completed_at timestamptz);`);
 const recoverSql=read('supabase/migrations/20261018065930_automated_support_resolution.sql').match(/create function public\.icash_access_help_recover[\s\S]*?end \$\$;/)[0];
 await pg.exec(recoverSql);
 const recoverUser=randomUUID(),recoverMember=randomUUID(),request=randomUUID(),key=randomUUID(),lease=randomUUID();
 await q("insert into auth.users(id,email,email_confirmed_at) values($1,'recover@example.invalid',now())",[recoverUser]);
 await q("insert into icash_memberships(id,mode,state,paid_through,payer_email) values($1,'live','active',now()+interval '30 days','recover@example.invalid')",[recoverMember]);
 await q("insert into icash_access_help_requests values($1,'recover@example.invalid',now()+interval '1 day')",[request]);
 await q("insert into icash_access_help_messages values($1,$2,'user',$3,null)",[request,key,lease]);
 await rpc('icash_access_help_recover',{p_id:request,p_key:key,p_token:randomUUID()});
 assert.equal((await q('select account_id from icash_memberships where id=$1',[recoverMember])).rows[0].account_id,null);
 assert.equal(await rpc('icash_access_help_recover',{p_id:request,p_key:key,p_token:lease}),'','Guest repair returns no account details or session');
 assert((await q('select account_id from icash_memberships where id=$1',[recoverMember])).rows[0].account_id);
 const recoveries=[];let owned=false;
 const support=await loadService('lib/support-recovery.ts',{fundingMode:()=> 'live',reconcileMembershipCheckout:async m=>recoveries.push(m.id),db:async(path,method,body)=>{
  if(path.startsWith('icash_accounts?')){assert(path.includes('id=eq.'+account)&&path.includes('owner_user_id=eq.'+owner));return owned?[{id:account}]:[];}
  if(path.startsWith('icash_memberships?')){assert(path.includes('account_id=eq.'+account)&&path.includes('mode=eq.live'));return [{id:first,stripe_session_id:'cs_fixture'}];}
  assert.equal(path,'rpc/icash_claim_funding');assert.equal(body.p_user,owner);recoveries.push('claim');return account;
 }});
 await support.recoverSupportAccount(account,owner);assert.deepEqual(recoveries,[]);
 owned=true;await support.recoverSupportAccount(account,owner);assert.deepEqual(recoveries,[first,'claim'],'Only owned canonical purchase reconciliation and idempotent claim run');
 // A consumed valid Auth code must survive a later provisioning failure.
 let failClaim=true,invalidCode=false;const jar=new Map(),events=[];
 const auth=await loadService('lib/account-auth.ts',{cookies:async()=>({get:k=>jar.has(k)?{value:jar.get(k)}:undefined,set:(k,v)=>{events.push(k);jar.set(k,v);},delete:k=>jar.delete(k)}),accountMode:()=> 'live',phoneSessionCookie:'phone',accessHash:x=>x,process:{env:{SUPABASE_URL:'https://auth.example.invalid',SUPABASE_SECRET_KEY:'fixture'}},fetch:async()=>invalidCode?new Response('',{status:403}):Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600,user:{id:owner,email:'paid@example.invalid',email_confirmed_at:'2026-01-01'}}),db:async(path,method,body)=>{assert.equal(path,'rpc/icash_claim_funding');assert.equal(body.p_user,owner);events.push('claim');if(failClaim)throw Error('temporary database failure');return account;}});
 assert.deepEqual(await auth.verifyEmail('paid@example.invalid','123456'),{accessPending:true});
 assert.deepEqual(events,['icash_access','icash_refresh','claim']);assert.equal(jar.get('icash_access'),'fixture-access');
 failClaim=false;assert.deepEqual(await auth.verifyEmail('paid@example.invalid','654321'),{accessPending:false});
 invalidCode=true;jar.clear();await assert.rejects(()=>auth.verifyEmail('paid@example.invalid','000000'));assert.equal(jar.size,0,'Rejected codes never get a session');
 console.log('PASS paid access recovery: real duplicate failure, one valid entitlement, stable repeat claims, preserved history, verified identity, cross-browser email lock, expiry, private grants and session preservation. No live charges or codes.');
}finally{await pg.close();}
