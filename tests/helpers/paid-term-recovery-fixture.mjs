import {readFileSync} from 'node:fs';
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export async function recoveryFixture(){
 const {PGlite}=await import('@electric-sql/pglite');
 const pg=new PGlite();
 await pg.exec(recoverySchema());
 return {pg};
}
export function recoverySchema(){
 const chunks=[];
 chunks.push(`create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to anon,authenticated,service_role;
 create table icash_accounts(id uuid primary key,owner_user_id uuid not null,bot_paused boolean not null,balance_cents bigint default 0);
 create table icash_operating_budget(id integer primary key);insert into icash_operating_budget values(1);
 create table icash_support_threads(id uuid primary key,account_id uuid references icash_accounts);
 create table icash_billing_reviews(payment_id text primary key,resolved_at timestamptz,account_id uuid);`);
 const foundation=read('supabase/migrations/20261003223200_membership_and_prepaid_credits.sql');
 chunks.push(foundation.slice(foundation.indexOf('create table public.icash_memberships'),foundation.indexOf('alter table public.icash_membership_offer')));
 chunks.push(`alter table icash_memberships drop constraint icash_memberships_state_check;
 alter table icash_memberships add constraint icash_memberships_state_check check(state in('pending','active','cancel_requested','cancelled','needs_review','payment_failed'));
 alter table icash_memberships add vip_until timestamptz,add private_invite_id uuid,add legacy_trial_offer text,add vip_retained_at timestamptz,add retention_requested_at timestamptz,add checkout_email text,add post_purchase_webinar_id uuid;
 create table icash_plan_changes(id uuid primary key,membership_id uuid,account_id uuid,action text,state text,period_end timestamptz,from_price bigint,to_price bigint,payment_id text);
 grant select,insert,update,delete on all tables in schema public to service_role;`);
 chunks.push(`create function public.icash_pause_work_and_billing(p_user uuid,p_account uuid,p_mode text) returns void language plpgsql as $$ begin update public.icash_accounts set bot_paused=true where id=p_account and owner_user_id=p_user; if not found then raise exception 'Account ownership mismatch';end if;end $$;`);
 const cancellation=read('config/immediate-membership-cancellation.sql');
 chunks.push(cancellation.slice(cancellation.indexOf('create function public.icash_preserve_membership_cancellation'),cancellation.indexOf('-- New checkouts record')));
 chunks.push(read('config/paid-term-recovery.sql'));
 return chunks.join('\n');
}
export async function seedRecovery(pg,n=1,days=20){
 const id=k=>`00000000-0000-4000-8000-${(n*100+k).toString().padStart(12,'0')}`;
 const account=id(1),source=id(2),upgrade=id(3),support=id(4),owner=id(5),invoice=`in_fixture${n}`,payment=`pi_software${n}`,vipPayment=`pi_vip${n}`,end=new Date(Date.now()+days*86400000).toISOString(),authorization='Owner approved finite original paid term, no charge or resume.';
 await pg.query('insert into icash_accounts values($1,$2,true,0)',[account,owner]);
 await pg.query('insert into icash_support_threads values($1,$2)',[support,account]);
 await pg.query("insert into icash_memberships(id,account_id,mode,guest_hash,price_cents,offer_revision,state,stripe_subscription_id,stripe_customer_id,paid_through,vip_until,consent_version,consent_text) values($1::uuid,$2,'live',md5($1::uuid::text)||md5($1::uuid::text),10000,1,'cancelled',$3,$4,$5,$5,'membership-fixture','Original accepted purchase terms')",[source,account,`sub_fixture${n}`,`cus_fixture${n}`,end]);
 await pg.query('insert into icash_membership_invoices(stripe_invoice_id,membership_id,stripe_payment_id,amount_cents,period_end) values($1,$2,$3,5000,$4)',[invoice,source,payment,end]);
 await pg.query("insert into icash_plan_changes values($1,$2,$3,'upgrade','applied',$4,5000,10000,$5)",[upgrade,source,account,end,vipPayment]);
 await pg.query('update icash_memberships set post_purchase_webinar_id=$1 where id=$2',[id(6),source]);
 const args=[account,source,invoice,upgrade,support,end,authorization];
 const restore=async(a=args)=>(await pg.query('select (icash_restore_paid_term($1,$2,$3,$4,$5,$6,$7)).*',a)).rows[0];
 return {account,source,upgrade,support,owner,invoice,payment,vipPayment,end,args,restore};
}
