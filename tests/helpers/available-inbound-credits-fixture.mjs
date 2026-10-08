import assert from 'node:assert/strict';
import {receptionSettlementAttestation} from '../../lib/recorded-reception-settlement.ts';
export async function testAvailableInboundCredits(f){
 const {db,q,val,rpc,read,fn,scenario,account,reserve}=f;
 const migration='supabase/migrations/20261008182808_available_credit_usage.sql';
 const sql=read(migration);
 await db.exec(sql.slice(0,sql.indexOf('CREATE OR REPLACE FUNCTION'))+'commit;');
 await db.exec('alter table public.icash_operation_rates add column if not exists flat_customer_price_cents bigint;');
 await db.exec('create or replace function public.icash_vip_active(p_account uuid) returns boolean language sql as $$select false$$;');
 // Seller-only short-call screening has no role in this incoming-call fixture.
 await db.exec('create or replace function public.icash_limited_seller_voice(p_account uuid,p_operation text) returns boolean language sql as $$select false$$;');
 for(const name of ['icash_reserve_credit','icash_finish_credit','icash_daily_allowance','icash_reserve_before_membership','icash_reserve_before_fractional','icash_reserve_direct_reception','icash_reserve_flexible_reception'])await db.exec(fn(migration,name));
 const privateStart=sql.indexOf('CREATE OR REPLACE FUNCTION icash_recorded_reception_private.automatic_components');
 await db.exec(sql.slice(privateStart,sql.indexOf('$function$;',privateStart)+12));
 await scenario('funded incoming call uses the whole balance with no wallet hold or activation cap',async()=>{
  await q('update public.icash_spend_activations set customer_cap_cents=1');
  await q('update public.icash_accounts set daily_limit_cents=0');
  await q('update public.icash_daily_allowances set base_cents=0');
  const a=await reserve();assert(a.allowed,JSON.stringify(a));assert.equal(a.session.max_total_seconds,600);
  assert.equal(await val('select balance_cents from public.icash_wallets where account_id=$1',[account]),480);
  assert.equal(await val('select reserved_cents from public.icash_wallets where account_id=$1',[account]),0);
  assert.equal((await rpc('icash_daily_allowance',{p_account:account})).remainingCents,480);
 });
 await scenario('a small positive balance admits a bounded call without a maximum-quote deposit',async()=>{
  await q('update public.icash_wallets set balance_cents=1');
  const a=await reserve();assert(a.allowed,JSON.stringify(a));assert.equal(a.session.max_total_seconds,120);
  assert.equal(await val('select reserved_cents from public.icash_wallets where account_id=$1',[account]),0);
 });
 for(const [label,sql] of [['empty wallet','update public.icash_wallets set balance_cents=0'],['disabled permission','update public.icash_spend_activations set enabled=false'],['unpaid credits',"update public.icash_funding_orders set state='pending'"]])await scenario(label+' still stops unfunded or unauthorized work',async()=>{
  await q(sql);assert.equal((await reserve()).allowed,false);assert.equal(await val('select count(*) from public.icash_operation_spend'),0);
 });
 await scenario('VIP incoming call admits and settles the frozen discount against unchanged provider costs',async()=>{
  await db.exec('create or replace function public.icash_vip_active(p_account uuid) returns boolean language sql as $$select true$$;');
  const c=await val('select to_jsonb(c) from icash_recorded_reception_private.configs c where id=$1',[f.config]);
  const costs=c.rate_snapshot.costs_micros;
  const rules=Object.fromEntries(Object.keys(costs).map(cat=>[cat,cat==='twilio'||cat==='elevenlabs'?{source:'provider_receipt',evidenceRef:'SIMULATION provider receipt'}:cat==='llm'?{source:'inclusive_zero',evidenceRef:'SIMULATION inclusive model'}:cat==='other'?{source:'recorded_reception_addons',policyVersion:c.pricing_policy.version,pricingPolicy:c.pricing_policy,evidenceRef:'SIMULATION recording policy'}:{source:'fixed_estimate',amountMicros:costs[cat],evidenceRef:'SIMULATION cost '+cat}]));
  const policy=await val("insert into icash_recorded_reception_private.cost_policies(version,account_id,rate_id,rate_snapshot,enabled,approved_at,reviewed_until,approval_reference,standard_cost_multiplier,elevenlabs_cost_multiplier,components) values('recorded-reception-cost-v1:vip-simulation',$1,$2,$3,true,now()-interval '1 hour',now()+interval '1 day','SIMULATION approved costs',3,3,$4) returning to_jsonb(cost_policies)-'enabled'",[account,f.rate,c.rate_snapshot,rules]);
  const a=await reserve({cost_policy_id:policy.id,cost_policy_snapshot:policy});assert(a.allowed,JSON.stringify(a));
  let r=a.session;assert.equal(Number(r.standard_cost_multiplier),2.4);assert.equal(r.max_total_seconds,600);assert.equal(r.cost_policy_snapshot.standard_cost_multiplier,3);
  await f.trans('claim_setup');await f.trans('bounded',f.boundPayload(r));await f.trans('bind_call_start',f.startPayload(r));
  await f.trans('request_end',{reason:'simulation_caller_ended'});
  const {timeLimitSeconds,...binding}=f.boundPayload(r);r=await f.trans('call_ended',{...binding,status:'completed'});
  const call={sid:r.call_sid,account_sid:r.provider_account_sid,from:r.from_phone,to:r.to_phone,direction:'inbound',status:'completed',start_time:r.call_started_at,price:'-0.0085',price_unit:'USD',duration:'10'};
  const evidence=receptionSettlementAttestation(r,call,null,null);assert(evidence);
  const settled=await rpc('icash_settle_recorded_reception',{p_id:r.id,p_account:account,p_operation:r.operation_key,p_attestation:evidence});assert(settled.settled,JSON.stringify(settled));
  const actual=Number(await val('select actual_micros from public.icash_operation_spend where operation_key=$1',[r.operation_key]));
  assert.equal(settled.chargedCents,Math.ceil(actual*2.4/10000));
 });
}
