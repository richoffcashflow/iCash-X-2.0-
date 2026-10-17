import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';
try{
 await db.exec(`
 create role anon;create role authenticated;create role service_role;
 create table public.icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean,member boolean default true,enabled boolean default true);
 create table public.icash_wallets(account_id uuid,balance_cents bigint);
 create table public.icash_funding_orders(account_id uuid,mode text,state text);
 create table public.icash_seller_intakes(id uuid primary key,created_at timestamptz,state text,numbers_passed boolean,market_qualified boolean,canonical_id uuid,contact_consent_scope text);
 create table public.icash_seller_matches(lead_id uuid,account_id uuid,assigned_at timestamptz);
 create function public.icash_membership_work_allowed(p uuid) returns boolean language sql stable as 'select member from public.icash_accounts where id=p';
 create function public.icash_credit_acquisition_allowed(p uuid) returns boolean language sql stable as 'select coalesce(bool_or(a.member and a.enabled and not a.bot_paused and w.balance_cents>0),false) from public.icash_accounts a left join public.icash_wallets w on w.account_id=a.id where a.id=p';
 insert into public.icash_accounts(id,owner_user_id,bot_paused) select md5(n::text)::uuid,md5(('user'||n)::text)::uuid,false from generate_series(1,7) n;
 insert into public.icash_wallets select id,10000 from public.icash_accounts;
 update public.icash_accounts set owner_user_id='${owner}' where id=md5('7')::uuid;
 insert into public.icash_funding_orders values(md5('6')::uuid,'test','paid');
 update public.icash_accounts set bot_paused=true where id=md5('3')::uuid;
 update public.icash_wallets set balance_cents=0 where account_id=md5('4')::uuid;
 update public.icash_accounts set enabled=false where id=md5('5')::uuid;
 insert into public.icash_seller_intakes(id,created_at,state,numbers_passed,market_qualified,contact_consent_scope)
 values(md5('good1')::uuid,now()-interval '2 hours','assigned',true,true,'homeoffer_network_and_matched_buyers'),
 (md5('good2')::uuid,now()-interval '3 hours','qualified',true,true,'homeoffer_network_and_matched_buyers'),
 (md5('bad')::uuid,now()-interval '1 hour','numbers_review',false,true,null),
 (md5('demo')::uuid,now()-interval '1 hour','assigned',true,true,'icash_x_demo'),
 (md5('duplicate')::uuid,now()-interval '1 hour','duplicate',true,true,null),
 (md5('repeat')::uuid,now()-interval '1 hour','qualified',true,true,null),
 (md5('future')::uuid,now()+interval '1 hour','qualified',true,true,null);
 update public.icash_seller_intakes set canonical_id=md5('good1')::uuid where id=md5('repeat')::uuid;
 insert into public.icash_seller_matches values(md5('good1')::uuid,md5('1')::uuid,now()-interval '1 hour'),(md5('good2')::uuid,md5('1')::uuid,now()-interval '1 hour'),(md5('demo')::uuid,md5('2')::uuid,now()-interval '1 hour');
 -- A completed real cohort with one customer plus owner/test deliveries.
 insert into public.icash_seller_intakes values(md5('old')::uuid,now()-interval '10 days','assigned',true,true,null,null);
 insert into public.icash_seller_matches select md5('old')::uuid,md5(n::text)::uuid,now()-interval '9 days' from unnest(array[1,6,7]) n;
 -- Yesterday's pending request does not lower the completed-request yield.
 insert into public.icash_seller_intakes values(md5('resolved')::uuid,now()-interval '2 days','qualified',true,true,null,null),
 (md5('rejected')::uuid,now()-interval '2 days','rejected',false,false,null,null),
 (md5('pending')::uuid,now()-interval '2 days','looking_up',false,false,null,null);
 `);
 await db.exec(readFileSync(new URL('../config/owner-lead-supply.sql',import.meta.url),'utf8'));
 const report=async()=> (await db.query('select public.icash_owner_lead_supply($1::uuid) report',[owner])).rows[0].report;
 let r=await report();
 assert.equal(r.activeAccounts,2);assert.equal(r.coveredAccounts24h,1,'Multiple deliveries to one user count once; demos never satisfy coverage');
 assert.equal(r.qualified24h,2,'Exclude failed numbers, duplicates, canonical repeats, private demos and future rows');
 assert.equal(r.pausedAccounts,1);assert.equal(r.unfundedAccounts,1);assert.equal(r.setupAccounts,1);
 assert.equal(r.matureLeads,1);assert.equal(r.matureDeliveries,1,'Owner/test deliveries cannot inflate realized customer yield');
 assert.equal(r.resolvedRequests7d,2);assert.equal(r.qualifiedRequests7d,1);
 await assert.rejects(()=>db.query('select public.icash_owner_lead_supply($1::uuid) report',['00000000-0000-0000-0000-000000000000']),/Owner required/);
 const privileges=(await db.query(`select has_function_privilege('anon','public.icash_owner_lead_supply(uuid)','execute') anon,has_function_privilege('authenticated','public.icash_owner_lead_supply(uuid)','execute') authenticated,has_function_privilege('service_role','public.icash_owner_lead_supply(uuid)','execute') service`)).rows[0];
 assert.deepEqual(privileges,{anon:false,authenticated:false,service:true});
 await db.exec('update public.icash_wallets set balance_cents=0');r=await report();assert.equal(r.activeAccounts,0);assert.equal(r.coveredAccounts24h,0);
 console.log('PASS lead supply database: eligibility, owner/test exclusions, unique recipient coverage, qualified cohorts, read-only reporting and restricted access.');
}finally{await db.close();}
