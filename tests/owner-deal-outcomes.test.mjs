import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {ownerDealOutcomesSchema} from '../lib/owner-deal-outcomes.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
try{
 // Date-only evidence uses the report's Chicago business date across UTC midnight.
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key,owner_user_id uuid);
 create table icash_funding_orders(account_id uuid,mode text,state text);
 create table icash_deal_files(id uuid primary key,account_id uuid,terms jsonb);
 create table icash_signing_envelopes(id uuid primary key,account_id uuid,deal_id uuid,kind text,test_mode boolean,provider_id text,state text,terms_hash text,recipients jsonb,provider_evidence jsonb,created_at timestamptz default now()-interval '1 day',updated_at timestamptz default now()-interval '4 hours');
 create index icash_signing_account on icash_signing_envelopes(account_id,deal_id);
 create table icash_title_replies(id uuid primary key,account_id uuid,deal_id uuid,sender_verified boolean,received_at timestamptz default now()-interval '3 hours');
 create table icash_closing_updates(id uuid primary key,account_id uuid,deal_id uuid,reply_id uuid,kind text,created_at timestamptz default now()-interval '2 hours',effective_date date default (now() at time zone 'America/Chicago')::date,confirmed_by uuid,confirmation_source text,amount_cents bigint);
 create table icash_proceeds_receipts(id uuid primary key,account_id uuid,deal_id uuid,closing_update_id uuid,amount_cents bigint,received_date date default (now() at time zone 'America/Chicago')::date,confirmed_by uuid,created_at timestamptz default now()-interval '1 hour');`);
 const verifier=read('config/platform-shared-learning.sql').match(/create function public\.icash_learning_signature_verified[\s\S]*?end \$\$;/)?.[0];
 assert(verifier,'Use the actual signature verifier, including provider/envelope/terms/recipient matching');await pg.exec(verifier);
 const migration=read('config/owner-deal-outcomes.sql');
 assert.equal(migration,read('supabase/migrations/20261104140953_owner_deal_outcomes.sql'));
 await pg.exec(migration);
 await q('insert into icash_accounts values($1,$2),($3,$4),($5,$6)',[uid(1),uid(11),uid(2),owner,uid(3),uid(13)]);
 await q("insert into icash_funding_orders values($1,'test','paid')",[uid(3)]);
 async function envelope(n,{account=uid(1),kind='purchase',state='completed',deal=n,test=false,practice=false}={}){
  await q('insert into icash_deal_files values($1,$2,$3) on conflict do nothing',[uid(deal),account,{practice}]);
  const recipients=[{id:'seller',phone:'+12145550123'},{id:'customer',email:'fixture@example.invalid'}],hash='a'.repeat(64);
  const evidence={id:'provider-'+n,test_mode:test,status:'completed',apply_signing_order:true,metadata:{icash_envelope:uid(n),terms_hash:hash},recipients:recipients.map((r,i)=>({...r,status:'signed',signing_order:i+1}))};
  await q('insert into icash_signing_envelopes(id,account_id,deal_id,kind,test_mode,provider_id,state,terms_hash,recipients,provider_evidence) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[uid(n),account,uid(deal),kind,test,'provider-'+n,state,hash,recipients,evidence]);
 }
 await envelope(101);await envelope(102,{kind:'assignment',deal:101});
 await envelope(201,{account:uid(2)});await envelope(202,{account:uid(2),kind:'assignment',deal:201});
 await envelope(301,{account:uid(3)});await envelope(401,{test:true});await envelope(501,{practice:true});
 await envelope(601,{state:'awaiting_counterparty'});await envelope(602,{state:'customer_signature_needed'});await envelope(603,{state:'needs_review'});
 await envelope(604);await q("update icash_signing_envelopes set provider_evidence=jsonb_set(provider_evidence,'{recipients,0,status}','\"pending\"') where id=$1",[uid(604)]);
 await envelope(605);await q("update icash_signing_envelopes set created_at=now()-interval '40 days' where id=$1",[uid(605)]);
 await envelope(606);await q("update icash_signing_envelopes set created_at=now()+interval '1 day' where id=$1",[uid(606)]);
 async function closing(n,account,actor){
  await q('insert into icash_title_replies(id,account_id,deal_id,sender_verified) values($1,$2,$3,true)',[uid(n+1000),account,uid(n)]);
  await q("insert into icash_closing_updates(id,account_id,deal_id,reply_id,kind,confirmation_source,amount_cents) values($1,$2,$3,$4,'closed','verified_title_format',null),($5,$2,$3,$4,'funds_disbursed','verified_title_format',1000000)",[uid(n+2000),account,uid(n),uid(n+1000),uid(n+3000)]);
  await q('insert into icash_proceeds_receipts(id,account_id,deal_id,closing_update_id,amount_cents,confirmed_by) values($1,$2,$3,$4,1000000,$5)',[uid(n+4000),account,uid(n),uid(n+3000),actor]);
 }
 await closing(101,uid(1),uid(11));await closing(201,uid(2),owner);
 const report=()=>one('select icash_owner_deal_outcomes($1,30)',[owner]);
 let r=await report();assert(ownerDealOutcomesSchema.safeParse(r).success);assert.equal(r.truncated,false);
 const [customer,own]=r.cohorts;
 assert.deepEqual(customer,{key:'customers',signingStarted:5,awaitingSeller:1,awaitingCustomer:1,needsReview:2,verifiedPurchases:1,verifiedAssignments:1,verifiedClosings:1,receivedDeals:1,receivedCents:1000000});
 assert.equal(own.signingStarted,1);assert.equal(own.receivedCents,1000000,'Owner demonstration is a separate column, never customer success');
 await envelope(103,{kind:'assignment',deal:101,state:'cancelled'});
 await q("update icash_signing_envelopes set updated_at=now()-interval '6 hours' where id=$1",[uid(103)]);
 assert.equal((await report()).cohorts[0].verifiedAssignments,1,'An earlier canceled assignment must not hide the current verified agreement');
 await q('update icash_proceeds_receipts set confirmed_by=$1 where account_id=$2',[owner,uid(1)]);
 r=await report();assert.equal(r.cohorts[0].receivedDeals,0,'Another user cannot confirm a customer receipt');assert.equal(r.cohorts[0].verifiedClosings,1,'Closing and receiving proceeds remain separate');
 await q('update icash_proceeds_receipts set confirmed_by=$1,amount_cents=2000000 where account_id=$2',[uid(11),uid(1)]);
 assert.equal((await report()).cohorts[0].receivedCents,0,'Receipt amount must match original title disbursement');
 await q('update icash_title_replies set sender_verified=false where account_id=$1',[uid(1)]);
 assert.equal((await report()).cohorts[0].verifiedClosings,0,'Unverified title mail cannot establish closing');
 await q('update icash_title_replies set sender_verified=true,account_id=$1 where deal_id=$2',[uid(2),uid(101)]);
 assert.equal((await report()).cohorts[0].verifiedClosings,0,'Cross-account evidence cannot establish closing');
 await q("update icash_signing_envelopes set provider_evidence=jsonb_set(provider_evidence,'{metadata,terms_hash}','\"different\"') where id=$1",[uid(201)]);
 r=await report();assert.equal(r.cohorts[1].verifiedPurchases,0);assert.equal(r.cohorts[1].verifiedAssignments,0);assert.equal(r.cohorts[1].verifiedClosings,0);assert.equal(r.cohorts[1].receivedCents,0,'Downstream successes require the real purchase signature');
 await assert.rejects(one('select icash_owner_deal_outcomes($1,30)',[uid(11)]),/Owner required/);
 for(const days of [null,0,2,31])await assert.rejects(one('select icash_owner_deal_outcomes($1,$2)',[owner,days]),/Invalid report period/);
 for(const role of ['anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'icash_owner_deal_outcomes(uuid,integer)','execute')",[role]),false);
 assert.equal(await one("select provolatile='s' and not prosecdef from pg_proc where oid='icash_owner_deal_outcomes(uuid,integer)'::regprocedure"),true,'Report is stable and does not elevate database privileges');
 for(const patch of [{cohorts:[r.cohorts[0],r.cohorts[0]]},{days:2},{cohorts:[{...r.cohorts[0],verifiedPurchases:999},r.cohorts[1]]},{cohorts:[{...r.cohorts[0],receivedCents:1},r.cohorts[1]]}])assert.equal(ownerDealOutcomesSchema.safeParse({...r,...patch}).success,false);
 await pg.exec(`insert into icash_deal_files select md5('cap'||n)::uuid,'${uid(1)}','{}' from generate_series(1,10001) n;
 insert into icash_signing_envelopes(id,account_id,deal_id,kind,test_mode,state) select md5('cap'||n)::uuid,'${uid(1)}',md5('cap'||n)::uuid,'purchase',false,'creating' from generate_series(1,10001) n;`);
 r=await report();assert.equal(r.truncated,true);assert.equal(r.cohorts.reduce((n,c)=>n+c.signingStarted,0),10000);assert(ownerDealOutcomesSchema.safeParse(r).success,'The bounded result remains valid and explicitly incomplete');
 console.log('PASS owner deal outcomes: customer/owner isolation, actual signature/title/proceeds proof, periods, private grants and explicit sample cap.');
}finally{await pg.close();}
