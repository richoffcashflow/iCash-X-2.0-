import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {usageLoopVariant,usageLoopEventSchema,usageLoopReportSchema,createUsageLoopObservation,pruneUsageLoopObservations} from '../lib/usage-loop-tracking.ts';
import {trackUsageLoopEvent} from '../lib/usage-loop-client.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',db=await PGlite.create();
const one=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const schema=readFileSync(new URL('../config/usage-loop-tracking.sql',import.meta.url),'utf8');
assert.equal(schema,readFileSync(new URL('../supabase/migrations/20261015075651_usage_loop_tracking.sql',import.meta.url),'utf8'));
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table public.icash_accounts(id uuid primary key,owner_user_id uuid not null);
 create table public.icash_funding_orders(id uuid primary key,account_id uuid,mode text,state text,paid_at timestamptz,credited_at timestamptz,price_cents bigint,stripe_payment_id text,daily_plan_id uuid);
 create table public.icash_credit_ledger(account_id uuid,event_key text,kind text,delta_cents bigint,evidence_ref text,created_at timestamptz default now());
 create table public.icash_auto_recharge_attempts(order_id uuid);
 create table public.icash_screening_jobs(account_id uuid,state text,result jsonb,completed_at timestamptz,snapshot jsonb);`);
 await db.exec(schema);
 for(let n=1;n<=7;n++)await db.query('insert into public.icash_accounts values($1,$2)',[id(n),n===7?owner:id(100+n)]);
 const create=async(n,action='funding',reason='refill')=>one('select public.icash_create_usage_loop_observation($1,$2,$3)',[id(n),action,reason]);
 const event=(observation,n,event='shown',action='funding',reason='refill')=>one('select public.icash_record_usage_loop_event($1,$2,$3,$4,$5)',[id(100+n),observation.impressionId,event,action,reason]);
 const a=await create(1),b=await create(2),recent=await create(4);
 assert.deepEqual(await create(1),a,'polling must reuse its observation without an extra row');
 assert.equal(await one('select count(*) from public.icash_usage_loop_observations'),3);
 assert.equal(a.variant,usageLoopVariant(id(1)));assert.equal(b.variant,usageLoopVariant(id(2)));
 assert.equal(usageLoopVariant(id(1).toUpperCase()),a.variant);
 assert.equal(await event(a,2),false,'another account cannot mark a visible prompt');
 assert.equal(await event(a,1,'shown','vip','vip'),false,'the stored action cannot be forged');
 assert.equal(await event(a,1,'funded'),false,'conversions are not browser events');
 assert.equal(await event(a,1),true);assert.equal(await event(a,1),true);
 assert.equal(await event(b,2),true);assert.equal(await event(recent,4),true);
 assert.equal(await event(recent,4,'clicked'),true);assert.equal(await event(recent,4,'dismissed'),true);
 await db.query("update public.icash_usage_loop_observations set created_at=now()-interval '11 days',shown_at=now()-interval '11 days',clicked_at=now()-interval '11 days' where id=any($1::uuid[])",[[a.impressionId,b.impressionId]]);
 const fund=async(n,order,days,{mode='live',post=true,auto=false,daily=false}={})=>{
  const payment='pi_fixture'+order;
  await db.query("insert into public.icash_funding_orders values($1,$2,$3,'paid',now()-make_interval(days=>$4),now()-make_interval(days=>$4),2500,$5,$6)",[id(order),id(n),mode,days,payment,daily?id(800):null]);
  if(post)await db.query("insert into public.icash_credit_ledger values($1,$2,'purchase',2500,$3,now()-make_interval(days=>$4))",[id(n),'stripe-funding:'+id(order),payment,days]);
  if(auto)await db.query('insert into public.icash_auto_recharge_attempts values($1)',[id(order)]);
 };
 await fund(1,201,10);await fund(1,202,8);
 await fund(2,203,12);await fund(2,204,9,{auto:true});await fund(2,205,8,{daily:true});
 await fund(3,206,10,{mode:'test'});await fund(4,207,2);await fund(5,208,10,{post:false});await fund(7,209,10);
 await db.query("insert into public.icash_screening_jobs values($1,'complete','{}',now()-interval '9 days','{\"propertyId\":\"prop_real\"}'),($2,'queued',null,null,'{}')",[id(1),id(2)]);
 for(const [snapshot,result] of [[{practice:true},{}],[{propertyId:'practice_fixture'},{}],[{propertyId:'prop_fixture'},{practice:true}],[{propertyId:'prop_fixture'},{property:{propertyId:'practice_fixture'}}]]){
  await db.query("insert into public.icash_screening_jobs values($1,'complete',$2,now()-interval '9 days',$3)",[id(2),result,snapshot]);
 }
 for(const [n,days] of [[1,9],[1,8],[2,9],[2,9]])await db.query("insert into public.icash_credit_ledger values($1,gen_random_uuid()::text,'usage',-10,'completed work',now()-make_interval(days=>$2))",[id(n),days]);
 const report=usageLoopReportSchema.parse(await one('select public.icash_usage_loop_report($1,false)',[owner]));
 assert.deepEqual(report.cohort,{firstFunded:2,firstResult:1,secondManualRefill:1,repeatUsage:1},'same full window excludes immature/test/unposted/owner funding, practice results and automatic refills');
 assert.deepEqual(report.recent,{shownAccounts:1,clickedAccounts:1,dismissedAccounts:1});
 assert.equal(report.variants.reduce((sum,v)=>sum+v.observedAccounts,0),2);
 assert.equal(report.variants.reduce((sum,v)=>sum+v.fundedAccounts,0),1,'auto and daily purchases are not manual prompt follow-through');
 assert.equal((await one('select public.icash_usage_loop_report($1,true)',[owner])).cohort.firstFunded,3);
 await assert.rejects(one('select public.icash_usage_loop_report($1,false)',[id(101)]),/Owner required/);
 assert.equal(await event(a,1),false,'old observation cannot accept a new browser event');
 await db.query("insert into public.icash_usage_loop_observations(account_id,variant,action,reason,created_at) select $1,'control','none','waiting',now()-interval '31 days' from generate_series(1,501)",[id(1)]);
 assert.equal(await one('select public.icash_prune_usage_loop_observations()'),500,'maintenance deletion is bounded');
 assert.equal(await one('select public.icash_prune_usage_loop_observations()'),1);
 for(const role of ['anon','authenticated']){
  assert.equal(await one("select has_table_privilege($1,'public.icash_usage_loop_observations','select')",[role]),false);
  for(const fn of ['icash_create_usage_loop_observation(uuid,text,text)','icash_record_usage_loop_event(uuid,uuid,text,text,text)','icash_usage_loop_report(uuid,boolean)','icash_prune_usage_loop_observations()'])assert.equal(await one('select has_function_privilege($1,$2,$3)',[role,'public.'+fn,'execute']),false);
 }
 assert.equal(await one("select relrowsecurity from pg_class where oid='public.icash_usage_loop_observations'::regclass"),true);
}finally{await db.close();}
assert.equal(usageLoopEventSchema.safeParse({impressionId:id(1),event:'shown',action:'funding',reason:'refill',variant:'progress'}).success,false);
assert.equal(await createUsageLoopObservation(id(1),{action:'funding',reason:'refill'},async()=>{throw Error('optional storage unavailable');}),null);
await pruneUsageLoopObservations(async()=>{throw Error('optional retention unavailable');});
const originalFetch=globalThis.fetch;
try{globalThis.fetch=async()=>{throw Error('offline');};await trackUsageLoopEvent({impressionId:id(1),event:'shown',action:'funding',reason:'refill'});}finally{globalThis.fetch=originalFetch;}
console.log('PASS usage loop: account binding, server variants, dedupe, exact paid/ledger outcomes, mature cohorts, manual vs automatic funding, no PII, bounded retention, optional telemetry failures. No provider calls.');
