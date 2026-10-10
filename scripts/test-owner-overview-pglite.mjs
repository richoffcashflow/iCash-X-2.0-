// Actual reporting SQL, fixture-only Postgres. No paid services or production writes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validOwnerOverview} from '../lib/owner-overview.ts';
const {PGlite}=await import(process.argv[2]);
const db=new PGlite();
const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',own='11111111-1111-4111-8111-111111111111',customer='22222222-2222-4222-8222-222222222222',test='33333333-3333-4333-8333-333333333333';
await db.exec(`
 create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key,owner_user_id uuid,legal_name text,assistant_name text);
 create table icash_funding_orders(account_id uuid,mode text,state text);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,state text,charged_cents bigint,actual_micros bigint,cost_basis text,customer_price_micros bigint,settled_at timestamptz,dispatched_at timestamptz,created_at timestamptz default now());
 create table icash_usage_coverage(operation_key text primary key,account_id uuid,covered_cents bigint);
 create table icash_seller_intakes(id uuid primary key default gen_random_uuid(),canonical_id uuid,name text,address text,phone text,email text,state text,attribution jsonb,assigned_account uuid,created_at timestamptz default now());
`);
const sql=await readFile(new URL('../config/owner-overview.sql',import.meta.url),'utf8');
assert.equal(sql,await readFile(new URL('../supabase/migrations/20261010013953_owner_overview.sql',import.meta.url),'utf8'));
await db.exec(sql);
await db.query(`insert into icash_accounts values ($1,$2,'Owner business','Owner bot'),($3,$3,'Customer company','Customer bot'),($4,$4,'Test account','Test bot')`,[own,owner,customer,test]);
await db.query(`insert into icash_funding_orders values ($1,'live','paid'),($1,'test','paid'),($2,'live','paid'),($3,'test','paid')`,[own,customer,test]);
// A frozen clock exercises a 25-hour DST day while retaining the actual function body.
await db.exec(sql.replace('end_at timestamptz:=now();',"end_at timestamptz:='2026-11-02T05:59:59Z';"));
await db.query(`insert into icash_operation_spend(operation_key,account_id,state,charged_cents,actual_micros,cost_basis,customer_price_micros,settled_at,dispatched_at) values
 ('paid',$1,'settled',10000,20000000,'estimated',null,'2026-11-01T06:00:00Z',null),
 ('fraction',$1,'settled',0,3000,'verified',9000,'2026-11-01T06:30:00Z',null),
 ('pending',$1,'dispatched',null,null,'unreconciled',null,null,'2026-11-01T07:00:00Z'),
 ('cancelled',$1,'cancelled',90000,0,'verified',null,'2026-11-01T07:00:00Z',null),
 ('own',$2,'settled',500,1000000,'verified',null,'2026-11-01T07:00:00Z',null),
 ('test',$3,'settled',90000,3000000,'verified',null,'2026-11-01T07:00:00Z',null),
 ('before',$1,'settled',90000,0,'verified',null,'2026-11-01T04:59:59.999Z',null),
 ('future',$1,'settled',90000,0,'verified',null,'2026-11-02T06:00:00Z',null)`,[customer,own,test]);
await db.query(`insert into icash_usage_coverage values('paid',$1,2000)`,[customer]);
await db.query(`insert into icash_seller_intakes(name,address,phone,email,state,attribution,assigned_account,created_at)
 select 'Seller '||n,'Property '||n,'+12145550000',null,case when n=1 then 'review' else 'assigned' end,'{"source":"meta","campaign":"launch"}',$1,'2026-11-01T05:00:00Z'::timestamptz from generate_series(1,26) n`,[customer]);
await db.exec(`insert into icash_seller_intakes(name,address,phone,state,created_at) values('Literal 100%_','A fixture','+12145550000','received','2026-11-01T05:00:00Z');
 insert into icash_seller_intakes(name,address,phone,state,created_at) values('Old lead','Old','+12145550000','received','2026-11-01T04:59:59.999Z');
 insert into icash_seller_intakes(name,address,phone,state,canonical_id,created_at) values('Repeat','Repeat','+12145550000','duplicate',gen_random_uuid(),'2026-11-01T10:00:00Z');`);
const get=async({days=1,includeOwner=false,query='',page=1,actor=owner}={})=>{
 const result=(await db.query('select icash_owner_overview($1,$2,$3,$4,$5) report',[actor,days,includeOwner,query,page])).rows[0].report;
 assert(validOwnerOverview(result,{days,includeOwner,query,page}));return result;
};
let passed=0;
async function scenario(name,fn){await fn();console.log(`PASS ${++passed}/7 ${name}`);}
await scenario('Usage margin uses posted charges, subtracts platform coverage and preserves fractional costs',async()=>{
 const {usage}=await get();
 assert.deepEqual(usage,{chargedCents:8000,completedCount:2,costMicros:20003000,coveredCents:2000,estimatedCount:1,knownCostMicros:20003000,marginMicros:59997000,missingChargeCount:0,missingCostCount:0,pendingCount:1});
});
await scenario('Owner inclusion is explicit; test-only funding and cancelled usage never inflate earnings',async()=>{
 const {usage}=await get({includeOwner:true});assert.equal(usage.chargedCents,8500);assert.equal(usage.completedCount,3);
});
await scenario('Central calendar boundaries include the entire 25-hour DST day and exclude future data',async()=>{
 const report=await get();assert.equal(Date.parse(report.startAt),Date.parse('2026-11-01T05:00:00Z'));assert.equal(Date.parse(report.endAt),Date.parse('2026-11-02T05:59:59Z'));assert.equal(report.leadCount,27);
 const week=await get({days:7});assert.equal(Date.parse(week.startAt),Date.parse('2026-10-26T05:00:00Z'));assert.equal(week.usage.chargedCents,98000);
});
await scenario('Missing costs or charges suppress margin instead of fabricating zero; losses stay negative',async()=>{
 await db.exec(`update icash_operation_spend set cost_basis='unreconciled' where operation_key='paid'`);
 let u=(await get()).usage;assert.equal(u.costMicros,null);assert.equal(u.marginMicros,null);assert.equal(u.knownCostMicros,3000);assert.equal(u.missingCostCount,1);
 await db.exec(`update icash_operation_spend set cost_basis='verified',actual_micros=90000000 where operation_key='paid'`);
 u=(await get()).usage;assert.equal(u.marginMicros,-10003000);
 await db.exec(`update icash_operation_spend set charged_cents=null where operation_key='paid'`);
 u=(await get()).usage;assert.equal(u.chargedCents,null);assert.equal(u.marginMicros,null);assert.equal(u.missingChargeCount,1);
});
await scenario('Lead search is literal and cannot inject SQL; pagination is stable and excludes duplicates',async()=>{
 const a=await get(),b=await get({page:2});assert.equal(a.leads.length,25);assert.equal(b.leads.length,2);assert.equal(new Set([...a.leads,...b.leads].map(l=>l.id)).size,27);assert.equal(a.reviewCount,1);
 assert.deepEqual(a.leads,(await get()).leads);
 const literal=await get({query:'%_'});assert.equal(literal.leads.length,1);assert.equal(literal.leadCount,27);assert.equal(literal.matchedCount,1);
 assert.equal((await get({query:"' OR 1=1 --"})).matchedCount,0);
});
await scenario('Only the service role can execute and owner identity is enforced independently',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  const allowed=(await db.query("select has_function_privilege($1,'icash_owner_overview(uuid,integer,boolean,text,integer)','execute') allowed",[role])).rows[0].allowed;
  assert.equal(allowed,role==='service_role');
 }
 assert.equal((await db.query("select prosecdef from pg_proc where proname='icash_owner_overview'")).rows[0].prosecdef,false);
 await assert.rejects(get({actor:customer}),/Owner required/);await assert.rejects(get({actor:null}),/Owner required/);
 for(const filters of [{days:2},{page:0},{query:'x'.repeat(101)},{includeOwner:null}])await assert.rejects(get(filters),/Invalid report filters/);
});
await scenario('No activity returns explicit zero totals and never invents a lead or operation',async()=>{
 await db.exec('truncate icash_operation_spend,icash_seller_intakes');const report=await get();
 assert.equal(report.leadCount,0);assert.deepEqual(report.leads,[]);assert.equal(report.usage.marginMicros,0);assert.equal(report.usage.pendingCount,0);
});
await db.close();assert.equal(passed,7);
