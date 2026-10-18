import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {databaseAdapter} from './simulated-journey-services.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export async function privateVipFixture(){
 const pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table icash_billing_reviews(payment_id text,resolved_at timestamptz);
 create table icash_accounts(id uuid primary key);
 create table icash_memberships(id uuid primary key,account_id uuid references icash_accounts,mode text,guest_hash text,price_cents bigint check(price_cents>=0),private_invite_id uuid,state text,paid_through timestamptz,vip_until timestamptz,vip_retained_at timestamptz,retention_requested_at timestamptz,stripe_session_id text,stripe_subscription_id text,stripe_customer_id text,checkout_url text,payer_email text,consent_version text,consent_text text,updated_at timestamptz default now());
 create table icash_plan_changes(id uuid primary key,membership_id uuid,account_id uuid,action text,state text);
 create table icash_funding_orders(id uuid,mode text,state text,account_id uuid,guest_hash text,price_cents bigint);
 create table icash_daily_plans(id uuid,mode text,state text,account_id uuid,guest_hash text);
 create table icash_daily_quotes(id uuid,plan_id uuid,budget_cents bigint,fee_cents bigint,consent_text text);
 grant select,insert,update on all tables in schema public to service_role;`);
 const evidence=read('config/stripe-dispute-protection.sql');await pg.exec(evidence.slice(evidence.indexOf('create table public.icash_purchase_acceptances'),evidence.indexOf('-- Keep the previous RPC')));
 await pg.exec(read('config/free-standard-vip-subscription.sql'));
 const account='00000000-0000-4000-8000-000000000001',membership='00000000-0000-4000-8000-000000000002';
 await pg.query('insert into icash_accounts values($1)',[account]);
 await pg.query("insert into icash_memberships(id,account_id,mode,guest_hash,price_cents,private_invite_id,state,paid_through,payer_email) values($1,$2,'live','fixture',0,$1,'active','9999-12-31T23:59:59Z','fixture@example.invalid')",[membership,account]);
 await pg.exec('set role service_role');const adapter=databaseAdapter(pg);
 const current=async()=>(await pg.query('select to_jsonb(m) as m from icash_memberships m')).rows[0].m;
 return {pg,...adapter,account,membership,current};
}
