import assert from 'node:assert/strict';

// Real incoming reserve + activation + daily wallet checks; synthetic accounts
// and carrier identifiers only. No network or real customer mutations.
export async function testFlexibleInboundCredits(f){
 const {db,q,val,rpc,read,fn,table,fixture,account,config,rate,trans,boundPayload,startPayload,serviceGet}=f;
 let reserve=f.reserve;
 await q('reset role');
 await db.exec(`alter function public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean) rename to icash_reserve_before_fractional;
 create function public.icash_reserve_operation(p_account uuid,p_operation text,p_rate uuid,p_permission_until timestamptz,p_financial_checked_at timestamptz default null,p_financial_eligible boolean default false) returns jsonb language sql as $$select public.icash_reserve_before_fractional(p_account,p_operation,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible)$$;
 create table public.icash_funding_orders(account_id uuid,mode text,state text,credited_at timestamptz);
 create function public.icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function public.icash_membership_work_allowed(uuid) returns boolean language sql as $$select true$$;
 create function public.icash_general_reception_pause_exempt(uuid,text,bigint) returns boolean language sql as $$select false$$;
 create function public.icash_customer_text_operation(uuid,text) returns boolean language sql as $$select false$$;
 create table public.icash_question_usage(account_id uuid,question_id uuid,state text);`);
 await db.exec(read('config/scoped-spend-activation.sql'));
 await db.exec(`alter function public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean) rename to icash_reserve_before_membership;
 create function public.icash_reserve_operation(p_account uuid,p_operation text,p_rate uuid,p_permission_until timestamptz,p_financial_checked_at timestamptz default null,p_financial_eligible boolean default false) returns jsonb language sql as $$select public.icash_reserve_before_membership(p_account,p_operation,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible)$$;`);
 const activation=await val("select pg_get_functiondef('public.icash_reserve_before_membership(uuid,text,uuid,timestamptz,timestamptz,boolean)'::regprocedure)");
 await db.exec(activation.replace('select charge_cents into charge','select coalesce((public.icash_voice_credit_bound(p_account,p_operation,p_rate)->>\'charge_cents\')::bigint,charge_cents) into charge'));
 const vip='config/vip-and-daily-allowance.sql';
 await db.exec(table(vip,'icash_daily_allowances'));
 for(const n of ['icash_spending_day','icash_daily_allowance','icash_reserve_credit'])await db.exec(fn(vip,n));
 await db.exec(fn('config/flexible-voice-credits.sql','icash_voice_bounded_costs'));
 const parts={llm:0,email:0,other:95000,github:1000,twilio:85000,vercel:3000,railway:3000,payments:10000,supabase:3000,messaging:0,elevenlabs:912000,acquisition:10000,dealmachine:0,title_and_signing:0,support_and_overhead:5000,refund_and_dispute_reserve:5000};
 async function setup(){
  await fixture(600,parts);
  await q('update public.icash_operating_budget set standard_cost_multiplier=3,elevenlabs_cost_multiplier=3');
  await q('update public.icash_wallets set balance_cents=480 where account_id=$1',[account]);
  await q('insert into public.icash_daily_allowances(account_id,day,opening_cents,base_cents) values($1,public.icash_spending_day(),543,208)',[account]);
  await q('insert into public.icash_spend_activations(account_id,enabled,customer_cap_cents) values($1,true,100000)',[account]);
  await q("insert into public.icash_funding_orders values($1,'live','paid',now())",[account]);
 }
 // Demonstrate the old fixed hold fails with exactly the same funded account.
 await q('begin');try{await setup();assert.equal((await reserve()).reason,'customer_funding_denied');}finally{await q('rollback');}
 await db.exec(read('config/flexible-inbound-credits.sql'));
 reserve=()=>f.reserve({},'icash_reserve_flexible_reception');
 async function scenario(name,action){await q('begin');try{await setup();await action();console.log('PASS '+name);}finally{await q('rollback');}}
 await scenario('incoming call fits remaining daily credits without raising any cap',async()=>{
  const prior=await val('select to_jsonb(c) from icash_recorded_reception_private.configs c where id=$1',[config]);
  const rateBefore=await val('select to_jsonb(r) from public.icash_operation_rates r where id=$1',[rate]);
  const result=await reserve();assert.equal(result.allowed,true,JSON.stringify(result));
  const r=result.session;assert.equal(r.max_total_seconds,240);assert.equal(r.charge_cap_cents,196);
  assert.equal((await rpc('icash_daily_allowance',{p_account:account})).remainingCents,12);
  assert.deepEqual(await val('select to_jsonb(c) from icash_recorded_reception_private.configs c where id=$1',[config]),prior);
  assert.deepEqual(await val('select to_jsonb(r) from public.icash_operation_rates r where id=$1',[rate]),rateBefore);
  assert.equal(await val('select balance_cents from public.icash_wallets where account_id=$1',[account]),480);
  assert.equal((await reserve()).reason,'duplicate_call');
  assert.equal(await val('select reserved_cents from public.icash_wallets where account_id=$1',[account]),196);
  await trans('claim_setup');await trans('bounded',boundPayload(r));await trans('bind_call_start',startPayload(r));
  const bound=await serviceGet();assert.equal(Date.parse(bound.call_deadline_at)-Date.parse(bound.call_started_at),240000);
  const costs=await val('select costs_micros from icash_recorded_reception_private.credit_bounds');
  assert.equal(costs.other,95000);assert.equal(costs.twilio,42500);assert.equal(costs.elevenlabs,364800);
 });
 for(const [label,sql] of [
  ['zero credits','update public.icash_wallets set balance_cents=0'],
  ['no daily allowance','update public.icash_daily_allowances set base_cents=0'],
  ['activation cap','update public.icash_spend_activations set customer_cap_cents=100'],
  ['disabled activation','update public.icash_spend_activations set enabled=false'],
  ['unpaid funding',"update public.icash_funding_orders set state='pending'"],
  ['paused account','update public.icash_accounts set bot_paused=true'],
  ['changed rate','update public.icash_operation_rates set enabled=false']
 ])await scenario(label+' still blocks incoming spend atomically',async()=>{
  await q(sql);const result=await reserve();assert.equal(result.allowed,false,JSON.stringify(result));
  assert.equal(await val('select count(*) from icash_recorded_reception_private.credit_bounds'),0);
  assert.equal(await val('select count(*) from public.icash_operation_spend'),0);
  assert.equal(await val('select reserved_cents from public.icash_wallets'),0);
 });
 await scenario('incoming bounds remain private, immutable and account scoped',async()=>{
  const result=await reserve();assert(result.allowed);
  assert.equal(await rpc('icash_reception_credit_bound',{p_account:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p_operation:result.session.operation_key,p_rate:rate}),null);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await val("select has_table_privilege($1,'icash_recorded_reception_private.credit_bounds','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')",[role]),false);
  for(const sql of ['delete from icash_recorded_reception_private.credit_bounds','update icash_recorded_reception_private.credit_bounds set max_seconds=600']){
   await q('savepoint immutable');await assert.rejects(q(sql),/immutable/);await q('rollback to savepoint immutable');
  }
 });
 if(process.env.RECEPTION_DIRECT_ONLY==='1')await (await import('./direct-recorded-inbound-fixture.mjs')).testDirectRecordedInbound({...f,scenario});
}
