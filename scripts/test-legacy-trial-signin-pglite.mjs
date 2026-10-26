import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);const pg=await PGlite.create();
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
 create table icash_accounts(id uuid primary key,owner_user_id uuid);
 create table icash_funding_orders(payer_email text,state text,mode text);
 create table icash_memberships(id uuid primary key default gen_random_uuid(),payer_email text,payer_phone text,mode text,state text,paid_through timestamptz,account_id uuid,checkout_email text,legacy_trial_offer text,legacy_trial_started_at timestamptz,stripe_subscription_id text,stripe_session_id text);
 create table icash_purchase_phone_identities(user_id uuid,email text,membership_id uuid,revoked_at timestamptz,phone text);
 create table icash_billing_reviews(account_id uuid,resolved_at timestamptz);
 create function icash_access_phone(text) returns text language sql as $$select $1$$;
 insert into icash_memberships(payer_email,mode,state,paid_through) values('paid@example.test','live','active',now()+interval '1 day');
 insert into icash_funding_orders values('funded@example.test','paid','live');
 insert into auth.users(id,email,email_confirmed_at) values('00000000-0000-4000-8000-000000000001','account@example.test',now());
 insert into icash_accounts values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');
 `);
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261018131443_verified_phone_identity_email_signin.sql',import.meta.url),'utf8'));
 const original=(await pg.query("select pg_get_functiondef('icash_can_sign_in(text,text)'::regprocedure) definition")).rows[0].definition;
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261025234000_legacy_trial_pending_signin.sql',import.meta.url),'utf8'));
 const can=async(email,mode='live')=>(await pg.query('select icash_can_sign_in($1,$2) ok',[email,mode])).rows[0].ok;
 for(const email of ['paid@example.test','funded@example.test','account@example.test'])assert.equal(await can(email),true,'Original eligibility preserved');
 assert.equal(await can('unknown@example.test'),false);
 await pg.query("insert into icash_memberships(mode,state,checkout_email,legacy_trial_offer,stripe_session_id) values('live','pending','trial@example.test','legacy-trial-2026-10-25.1','cs_live_trial')");
 assert.equal(await can(' TRIAL@example.test '),true,'Pending checkout may request identity verification');
 assert.equal(await can('trial@example.test','test'),false);assert.equal(await can('trial@example.test','bad'),false);
 const changes=[['state',"'cancelled'"],['state',"'needs_review'"],['state',"'cancel_requested'"],['legacy_trial_offer',"'other'"],['legacy_trial_started_at','now()'],['stripe_subscription_id',"'sub_one'"],['stripe_session_id','null'],['stripe_session_id',"'cs_test_trial'"]];
 for(const [field,expression] of changes){await pg.exec('begin');await pg.exec(`update icash_memberships set ${field}=${expression} where checkout_email='trial@example.test'`);assert.equal(await can('trial@example.test'),false,field);await pg.exec('rollback');}
 await pg.exec("insert into icash_memberships(mode,state,payer_email) values('live','needs_review','trial@example.test')");assert.equal(await can('trial@example.test'),false,'Review hold survives pending OTP branch');await pg.exec("delete from icash_memberships where state='needs_review'");
 await pg.exec("insert into auth.users(id,email,banned_until) values('00000000-0000-4000-8000-000000000002','trial@example.test',now()+interval '1 day')");assert.equal(await can('trial@example.test'),false);await pg.exec("delete from auth.users where email='trial@example.test'");
 assert.equal((await pg.query("select count(*)::int n from icash_accounts")).rows[0].n,1,'Eligibility creates no account');
 assert.equal((await pg.query("select paid_through from icash_memberships where checkout_email='trial@example.test'")).rows[0].paid_through,null,'Eligibility grants no access');
 for(const role of ['anon','authenticated']){await pg.exec(`set role ${role}`);await assert.rejects(can('trial@example.test'));await pg.exec('reset role');}
 // SQL patch preserves all original branches byte-for-byte after the insertion.
 const updated=(await pg.query("select pg_get_functiondef('icash_can_sign_in(text,text)'::regprocedure) definition")).rows[0].definition;
 assert(updated.includes(original.slice(original.indexOf('exists(select 1 from public.icash_funding_orders'))));
 const route=readFileSync(new URL('../app/api/auth/email/route.ts',import.meta.url),'utf8');assert.match(route,/limitRequest\(req,"email",email,3,600\)/);assert.match(route,/if\(eligible\)await authRequest/);assert.match(route,/return NextResponse.json\(\{sent:true/);
 const auth=readFileSync(new URL('../lib/account-auth.ts',import.meta.url),'utf8');assert(auth.indexOf('await saveSession(s);',auth.indexOf('export async function verifyEmail'))<auth.indexOf('rpc/icash_claim_funding',auth.indexOf('export async function verifyEmail')));assert.match(auth,/catch\{return \{accessPending:true\};\}/);
 console.log('PASS pending trial OTP SQL: exact stored checkout/mode/marker, pending-only, holds/bans, all prior eligibility unchanged, no account/access grant, private RPC, unchanged rate limits/generic response and verified-session recovery. No real OTP.');
}finally{await pg.close();}
