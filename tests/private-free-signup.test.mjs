import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {membershipAccessible} from '../lib/membership-policy.ts';
import {vipActive} from '../lib/vip-policy.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=new PGlite(),owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',paid='00000000-0000-4000-8000-000000000003',hash='a'.repeat(64);
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create table public.icash_accounts(id uuid primary key default gen_random_uuid(),owner_user_id uuid unique references auth.users,assistant_name text,billing_model text default 'legacy',bot_paused boolean default false,workspace_ack_version text);
 create table public.icash_wallets(account_id uuid primary key references public.icash_accounts,balance_cents bigint default 0);
 create table public.icash_notification_preferences(account_id uuid primary key references public.icash_accounts);
 create table public.icash_funding_orders(payer_email text,mode text,state text);
 create table public.icash_daily_plans(account_id uuid,guest_hash text,mode text,state text);
 insert into auth.users values('${owner}','new@example.invalid',now()),('${other}','unverified@example.invalid',null),('${paid}','paid@example.invalid',now());`);
 const base=read('supabase/migrations/20261003223200_membership_and_prepaid_credits.sql');
 await pg.exec(base.slice(base.indexOf('create table public.icash_memberships ('),base.indexOf('create table public.icash_membership_invoices')));
 await pg.exec('alter table public.icash_memberships add column vip_until timestamptz,add column vip_retained_at timestamptz,add column retention_requested_at timestamptz;');
 await pg.exec(read('supabase/migrations/20260928015426_icash_idempotent_account_provisioning.sql'));
 await pg.exec(base.slice(base.indexOf('create function public.icash_membership_work_allowed'),base.indexOf('CREATE OR REPLACE FUNCTION public.icash_claim_funding')));
 const guard=read('supabase/migrations/20261004170448_daily_budget_return_and_three_times_usage.sql');
 await pg.exec(guard.slice(guard.indexOf('create function public.icash_guard_recurring_model'),guard.indexOf('create or replace function public.icash_daily_claim')));
 await pg.exec(read('config/returning-account-sign-in.sql'));
 await pg.exec('grant usage on schema auth to service_role;grant select on auth.users to service_role;grant select,insert,update on all tables in schema public to service_role;');
 await pg.exec(read('supabase/migrations/20261017005756_private_free_signup.sql'));
 await pg.query('insert into icash_private_invites(token_hash,mode,label) values($1,\'live\',\'Local fixture\')',[hash]);
 await pg.exec('set role service_role');
 const redeem=async(user=owner,token=hash,mode='live')=>(await pg.query('select icash_redeem_private_invite($1,$2,$3) as result',[token,user,mode])).rows[0].result;
 await assert.rejects(redeem(other),/Verified email/);
 await assert.rejects(redeem(owner,'b'.repeat(64)),/Invitation unavailable/);
 await assert.rejects(redeem(owner,hash,'test'),/Invitation unavailable/);
 assert.deepEqual(await redeem(),{granted:true});assert.deepEqual(await redeem(),{granted:true});
 const m=(await pg.query('select * from icash_memberships')).rows[0];
 assert.equal((await pg.query('select count(*)::int as n from icash_memberships')).rows[0].n,1);
 assert.equal(Number(m.price_cents),0);assert.equal(m.stripe_subscription_id,null);assert(m.private_invite_id);assert(membershipAccessible(m));assert.equal(vipActive(m),false);
 const a=(await pg.query('select * from icash_accounts')).rows[0];assert.equal(a.bot_paused,true);assert.equal(a.workspace_ack_version,null);assert.equal(a.billing_model,'membership_credits');
 assert.equal(Number((await pg.query('select balance_cents from icash_wallets')).rows[0].balance_cents),0);
 assert.equal((await pg.query('select icash_membership_work_allowed($1) as ok',[a.id])).rows[0].ok,true);
 assert.equal((await pg.query("select icash_can_sign_in('new@example.invalid','live') as ok")).rows[0].ok,true);
 await pg.exec("insert into icash_funding_orders values('paid@example.invalid','live','paid')");
 assert.deepEqual(await redeem(paid),{granted:false,reason:'existing_purchase'});
 await pg.query('update icash_private_invites set enabled=false where token_hash=$1',[hash]);await assert.rejects(redeem(),/Invitation unavailable/);
 await pg.query("update icash_private_invites set enabled=true,expires_at=now()-interval '1 minute' where token_hash=$1",[hash]);await assert.rejects(redeem(),/Invitation unavailable/);
 await pg.query('update icash_private_invites set expires_at=null where token_hash=$1',[hash]);
 await assert.rejects(pg.query("update icash_memberships set vip_until=now()+interval '1 day'"),/check constraint/);
 await assert.rejects(pg.query("update icash_memberships set stripe_subscription_id='sub_fake'"),/check constraint/);
 await assert.rejects(pg.query('update icash_memberships set private_invite_id=null'),/check constraint/);
 await pg.exec("update icash_memberships set state='cancelled'");assert.deepEqual(await redeem(),{granted:false,reason:'existing_account'});
 for(const role of ['anon','authenticated']){
  await pg.exec(`reset role;set role ${role}`);
  await assert.rejects(redeem(),/permission denied/);
  await assert.rejects(pg.query('select * from icash_private_invites'),/permission denied/);
 }
}finally{await pg.close();}

let origin=true,validInvite=true,confirmed=true,grant=true,saves=0,claims=0,authCalls=[],limits=[];
const session={user:{id:owner,email:'new@example.invalid',email_confirmed_at:'2026-10-17'},access_token:'fixture',refresh_token:'fixture',expires_in:3600};
const deps={z,NextResponse:{json:(body,options={})=>({body,status:options.status??200,headers:options.headers})},cookies:async()=>({delete:()=>{}}),allowedOrigin:()=>origin,normalizeEmail:value=>typeof value==='string'&&value.includes('@')?value.trim().toLowerCase():null,currentPrivateInvite:async()=>validInvite?{hash,mode:'live'}:null,privateAccessCookie:'fixture',privateAccessHeaders:{'Cache-Control':'private, no-store'},limitRequest:async(...args)=>limits.push(args),authRequest:async(path,body)=>{authCalls.push({path,body});return {...session,user:{...session.user,email_confirmed_at:confirmed?session.user.email_confirmed_at:null}};},saveSession:async()=>{saves++;},db:async(path,method,body)=>{assert.equal(path,'rpc/icash_redeem_private_invite');assert.equal(method,'POST');assert.deepEqual(body,{p_hash:hash,p_user:owner,p_mode:'live'});claims++;return {granted:grant};}};
const oldReady=process.env.ICASH_AUTH_EMAIL_READY;process.env.ICASH_AUTH_EMAIL_READY='true';
try{
 const route=await loadService('app/api/private-access/route.ts',deps);
 const req=body=>new Request('https://www.geticashx.com/api/private-access',{method:'POST',body:JSON.stringify(body)}),email={action:'email',email:'new@example.invalid'},verify={...email,action:'verify',code:'123456'};
 origin=false;assert.equal((await route.POST(req(email))).status,403);origin=true;
 validInvite=false;assert.equal((await route.POST(req(email))).status,403);validInvite=true;assert.equal(authCalls.length,0);
 assert.equal((await route.POST(req({...email,userId:other}))).status,400);
 assert.equal((await route.POST(req(email))).status,200);assert.equal(authCalls[0].path,'otp');assert.equal(claims,0);assert.equal(saves,0);
 confirmed=false;assert.equal((await route.POST(req(verify))).status,400);assert.equal(claims,0);confirmed=true;
 grant=false;assert.equal((await route.POST(req(verify))).status,409);assert.equal(saves,0);grant=true;
 const result=await route.POST(req(verify));assert.equal(result.status,200);assert.equal(result.body.signedIn,true);assert.equal(saves,1);assert.equal(result.headers['Cache-Control'],'private, no-store');
 assert.equal(limits[0][1],'private-access-email');assert.equal(limits.at(-1)[1],'private-access-verify');
}finally{if(oldReady===undefined)delete process.env.ICASH_AUTH_EMAIL_READY;else process.env.ICASH_AUTH_EMAIL_READY=oldReady;}
console.log('PASS private signup: verified email, invite/mode/revocation checks, idempotent new accounts, paid-account protection, no credit or VIP grant, private RPC permissions and authenticated sessions. No external providers called.');
