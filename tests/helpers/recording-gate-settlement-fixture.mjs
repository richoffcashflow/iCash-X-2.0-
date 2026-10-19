// Real settlement SQL and local ledger, with synthetic carrier receipts only.
import assert from 'node:assert/strict';
import {costCategories} from '../../lib/cost-guard.ts';
import {settleRecordingGateOnly} from '../../lib/required-call-recording-billing.ts';
export async function testRecordingGateSettlement(f){
 const {pg,q,rpc,read,scenario,trans,get,bound,createArgs,context,account,permission,operation,ac,call,admin}=f;
 await pg.exec(`create function public.icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function public.icash_seller_voice_permission_current(uuid,uuid) returns boolean language sql as $$select false$$;`);
 await pg.exec(read('config/direct-recorded-outbound.sql'));
 const lifecycle=read('supabase/migrations/20261007020025_terminal_call_status_and_credit_readiness.sql');
 await pg.exec(lifecycle.slice(0,lifecycle.indexOf('-- Match the actual funded-credit'))+'\ncommit;');
 await pg.exec(read('supabase/migrations/20261007020639_terminal_receipt_read_only_recording_access.sql'));
 // Compare the actual catalog definition before/after: only the guarded clause may change.
 const oldClause="or (r.state='declined' and p_receipt->'speechGatherUsed' is distinct from 'true'::jsonb)";
 const newClause="or r.entry_policy is null or r.entry_policy not in ('spoken_v1','direct_recorded_v1')\n  or p_receipt->'speechGatherUsed' is distinct from to_jsonb(r.entry_policy='spoken_v1' and (r.state='declined' or p_receipt->>'status'='completed'))";
 const definition=async()=>(await q("select pg_get_functiondef('public.icash_settle_unstarted_recorded_call(uuid,uuid,text,jsonb,jsonb,text)'::regprocedure) definition")).rows[0].definition;
 // A concurrent unrelated body comment must survive the patch, not be overwritten by a snapshot.
 const original=await definition(),concurrent=original.replace('-- Same budget','-- Synthetic concurrent change must survive.\n -- Same budget');
 const patch=read('config/recording-gate-settlement-policy.sql');
 // Prerequisite failures abort without changing an unexpected function or its access contract.
 for(const [changed,pattern] of [
  [original.replace('SECURITY DEFINER','SECURITY INVOKER'),/Expected gate settlement function security contract/],
  [original.replace(oldClause,oldClause+' /* '+oldClause+' */'),/Expected one unchanged gate speech validation clause/],
 ]){
  await pg.exec(changed);const unexpected=await definition();
  await assert.rejects(()=>pg.exec(patch),pattern);await pg.exec('rollback;');assert.equal(await definition(),unexpected);
 }
 await pg.exec(concurrent);const before=await definition();
 await pg.exec(patch);
 assert.equal(await definition(),before.replace(oldClause,newClause),'Only policy validation changes; concurrent body and security settings survive');
 const emptyCosts=Object.fromEntries(costCategories.map(k=>[k,0]));
 const setup=async(entryPolicy,state='declined')=>{
  await admin(async()=>{await q('update public.icash_operation_rates set costs_micros=$1',[emptyCosts]);await q('update public.icash_operation_spend set standard_cost_multiplier=1.6');});
  if(entryPolicy==='direct_recorded_v1'){
   assert(await rpc('icash_create_direct_recorded_call',createArgs));await trans('claim_dial');
   assert(await trans('bind_call',{callSid:call,providerAccountSid:ac,fromPhone:context.fromPhone,toPhone:'+12125550102'}));
  }else await bound();
  assert(await trans(state==='declined'?'decline':'fail',{reason:state==='declined'?'declined':'call_ended_before_recording'}));return get();
 };
 const carrier=r=>({sid:call,account_sid:ac,from:r.from_phone,to:r.to_phone,direction:'outbound-api',date_created:r.created_at,status:'completed',duration:'0',price:'-0.014000',price_unit:'USD'});
 const receipt=(r,speech)=>({providerAccountSid:ac,callSid:call,fromPhone:r.from_phone,toPhone:r.to_phone,status:'completed',durationSeconds:0,priceMicros:14000,currency:'USD',speechGatherUsed:speech});
 const parts=(speech,price=14000)=>{
  const result=Object.fromEntries(costCategories.map(k=>[k,{amountMicros:k==='twilio'?price:k==='other'&&speech?20000:0,basis:['elevenlabs','llm'].includes(k)?'not_applicable':k==='other'?'estimated':'verified',evidenceRef:'Synthetic gate-only SQL fixture '+k}]));
  result.other.subitems={speechGatherMicros:speech?20000:0,recordingMicros:0,storageMicros:0};return result;
 };
 const settle=(r,speech,over={},manifest=parts(speech))=>rpc('icash_settle_unstarted_recorded_call',[r.id,account,operation,{...receipt(r,speech),...over},manifest,'Synthetic canonical terminal carrier receipt']);
 const ledger=async()=>({spend:(await q('select state,actual_micros,charged_cents,settlement_evidence from public.icash_operation_spend where operation_key=$1',[operation])).rows[0],wallet:(await q('select balance_cents,reserved_cents from public.icash_wallets where account_id=$1',[account])).rows[0],entries:(await q('select count(*)::int n from public.icash_credit_ledger')).rows[0].n});
 const rejects=async(fn,pattern)=>{await q('savepoint gate_reject');try{await assert.rejects(fn,pattern);}finally{await q('rollback to savepoint gate_reject');await q('release savepoint gate_reject');}};
 for(const entryPolicy of ['direct_recorded_v1','spoken_v1'])await scenario(entryPolicy+' decline settles exact carrier/policy cost once and rejects opposite speech',async()=>{
  const r=await setup(entryPolicy),speech=entryPolicy==='spoken_v1',before=await ledger();
  await rejects(()=>settle(r,!speech),/Bound terminal carrier receipt/);assert.deepEqual(await ledger(),before);
  for(const over of [{currency:'EUR'},{priceMicros:null},{priceMicros:-1},{priceMicros:0.1},{callSid:'CA'+'f'.repeat(32)},{fromPhone:'+12125550999'},{providerAccountSid:'AC'+'f'.repeat(32)},{speechGatherUsed:null},{speechGatherUsed:'false'}]){
   await rejects(()=>settle(r,speech,over),/Bound terminal carrier receipt/);assert.deepEqual(await ledger(),before);
  }
  const charge=speech?6:3;assert.equal((await settle(r,speech)).chargedCents,charge);
  const after=await ledger();assert.equal(after.spend.actual_micros,speech?34000:14000);assert.equal(after.wallet.balance_cents,10000-charge);assert.equal(after.wallet.reserved_cents,0);assert.equal(after.entries,1);
  assert.equal((await settle(r,speech)).chargedCents,charge);assert.deepEqual(await ledger(),after);
  await rejects(()=>settle(r,speech,{durationSeconds:1}),/Terminal cost receipt conflict/);assert.deepEqual(await ledger(),after);
  assert.equal((await get()).next_reconcile_at,null);assert.equal((await get()).last_action,'gate_settled');
 });
 for(const [entryPolicy,state,status,speech] of [['spoken_v1','failed','completed',true],['spoken_v1','failed','busy',false],['direct_recorded_v1','failed','completed',false]])await scenario('SQL speech policy '+[entryPolicy,state,status].join('/'),async()=>{
  const r=await setup(entryPolicy,state),over={status};await rejects(()=>settle(r,!speech,over),/Bound terminal carrier receipt/);assert.equal((await settle(r,speech,over)).settled,true);
 });
 await scenario('gate-only charge cap and operation identity exclusions remain unchanged',async()=>{
  const r=await setup('direct_recorded_v1'),before=await ledger();
  assert.equal(await settle(r,false,{priceMicros:10000000},parts(false,10000000)),null);assert.deepEqual(await ledger(),before);
  for(const [sql,args] of [
   ['update public.icash_operation_spend set customer_price_micros=1',[]],
   ["update public.icash_operation_spend set state='reserved'",[]],
   ['update public.icash_operation_spend set charge_cap_cents=976',[]],
   ["update public.icash_voice_jobs set conversation_id='conv_fixture'",[]],
  ]){await q('savepoint gate_identity');try{await admin(()=>q(sql,args));assert.equal(await settle(r,false),null);assert.equal((await ledger()).entries,0);}finally{await q('rollback to savepoint gate_identity');await q('release savepoint gate_identity');}}
  assert.equal(await rpc('icash_settle_unstarted_recorded_call',[r.id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',operation,receipt(r,false),parts(false),'Synthetic canonical terminal carrier receipt']),null);assert.deepEqual(await ledger(),before);
 });
 await scenario('adapter and real SQL agree on direct declined call; pending price never settles',async()=>{
  const r=await setup('direct_recorded_v1'),before=await ledger();
  const db=async(path,method,body)=>{
   if(path.startsWith('rpc/'))return rpc(path.slice(4),Object.values(body));
   assert(path.startsWith('icash_operation_rates?'));return (await q('select costs_micros from public.icash_operation_rates where id=$1',[permission])).rows;
  };
  assert.equal((await settleRecordingGateOnly(db,{getCall:async()=>({...carrier(r),price:null})},r)).reason,'terminal_carrier_price_pending');assert.deepEqual(await ledger(),before);
  assert.equal((await settleRecordingGateOnly(db,{getCall:async()=>carrier(r)},r)).settled,true);
  const after=await ledger();assert.equal(after.spend.charged_cents,3);assert.equal(after.entries,1);
  assert.equal((await settleRecordingGateOnly(db,{getCall:async()=>carrier(r)},r)).settled,true);assert.deepEqual(await ledger(),after);
 });
 // The real schema also rejects null/unknown policy values before the RPC can see them.
 for(const policy of [null,'unknown_policy'])await scenario('SQL rejects invalid immutable entry policy '+String(policy),async()=>{
  await setup('direct_recorded_v1');const before=await ledger();
  await admin(()=>rejects(()=>q('update public.icash_call_recordings set entry_policy=$1,row_version=row_version+1',[policy]),/immutable|not-null|check constraint/));assert.deepEqual(await ledger(),before);
 });
 for(const role of ['anon','authenticated'])assert.equal((await q("select has_function_privilege($1,'public.icash_settle_unstarted_recorded_call(uuid,uuid,text,jsonb,jsonb,text)','execute') allowed",[role])).rows[0].allowed,false);
 assert.equal((await q("select has_function_privilege('service_role','public.icash_settle_unstarted_recorded_call(uuid,uuid,text,jsonb,jsonb,text)','execute') allowed")).rows[0].allowed,true);
}
