import assert from 'node:assert/strict';
import {costCategories} from '../../lib/cost-guard.ts';
import {settleRecordingGateOnly} from '../../lib/required-call-recording-billing.ts';
import {recordingAddonCosts} from '../../lib/required-call-recording-cost.ts';
export async function testCarrierAnswerDetection(f){
 const {pg,q,rpc,read,scenario,trans,get,createArgs,context,account,permission,operation,ac,call,rec,admin}=f;
 await pg.exec(`create function public.icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function public.icash_seller_voice_permission_current(uuid,uuid) returns boolean language sql as $$select false$$;
 create function public.icash_property_call_sender(uuid,uuid,text) returns text language sql as $$select '+12125550101'::text$$;
 create table public.icash_cost_observations(provider text,event_key text,source_ref text,amount numeric,units text);`);
 await pg.exec(read('config/direct-recorded-outbound.sql'));
 const lifecycle=read('supabase/migrations/20261007020025_terminal_call_status_and_credit_readiness.sql');
 await pg.exec(lifecycle.slice(0,lifecycle.indexOf('-- Match the actual funded-credit'))+'\ncommit;');
 await pg.exec(read('supabase/migrations/20261007020639_terminal_receipt_read_only_recording_access.sql'));
 await pg.exec(`create table icash_recording_private.capacity_quarantines(operation_key text);`);
 const sources=JSON.parse(read('tests/fixtures/carrier-answer-detection-before.json'));
 for(const s of sources){await pg.exec(s.definition);await pg.exec(`revoke all on function public.${s.signature} from public,anon,authenticated,untrusted_test_role;grant execute on function public.${s.signature} to service_role;`);}
 const definition=async(signature)=>(await q('select pg_get_functiondef($1::regprocedure) as d',[signature])).rows[0].d;
 const patch=read('config/carrier-answer-detection.sql');
 const source=sources[0],original=await definition(source.signature);
 await pg.exec(original.replace('begin','begin\n -- source drift'));
 await assert.rejects(()=>pg.exec(patch),/source or access contract changed/);await pg.exec('rollback;');
 for(const s of sources)assert.equal(await definition(s.signature),s===source?original.replace('begin','begin\n -- source drift'):s.definition);
 await pg.exec(original);
 const forward=read('supabase/migrations/20261117045315_carrier_answer_detection.sql');
 assert(!/^\s*(?:begin|commit);/im.test(forward),'Forward migration must share the runner ledger transaction');
 assert.equal(forward,patch.replace('\nbegin;\n','\n-- The migration runner owns the transaction and schema ledger.\n').replace(/commit;\n$/,''));
 await pg.exec('begin;');await pg.exec(forward);await pg.exec('create table public.amd_fixture_ledger(version text);');
 await assert.rejects(()=>pg.exec('select 1/0;'),/division by zero/);await pg.exec('rollback;');
 for(const s of sources)assert.equal(await definition(s.signature),s.definition);
 assert.equal((await q("select to_regclass('public.amd_fixture_ledger') as ledger")).rows[0].ledger,null);
 await pg.exec(patch);
 const patched=await Promise.all(sources.map(s=>definition(s.signature)));
 await assert.rejects(()=>pg.exec(patch),/source or access contract changed/);await pg.exec('rollback;');
 for(let i=0;i<sources.length;i++)assert.equal(await definition(sources[i].signature),patched[i]);
 const emptyCosts=Object.fromEntries(costCategories.map(k=>[k,k==='other'?51000:0]));
 const setup=async(marked=true)=>{
  await admin(async()=>{await q('update public.icash_operation_rates set costs_micros=$1',[emptyCosts]);await q('update public.icash_operation_spend set standard_cost_multiplier=1.6');});
  const ctx=structuredClone(context);if(marked)ctx.callContext.answerPolicy='carrier_amd_enable_v1';
  assert(await rpc('icash_create_direct_recorded_call',[...createArgs.slice(0,8),ctx]));await trans('claim_dial');
  assert(await trans('bind_call',{callSid:call,providerAccountSid:ac,fromPhone:context.fromPhone,toPhone:'+12125550102'}));
  return get();
 };
 const reject=async(fn,pattern)=>{await q('savepoint amd_reject');try{await assert.rejects(fn,pattern);}finally{await q('rollback to savepoint amd_reject');await q('release savepoint amd_reject');}};
 const ledger=async()=>({spend:(await q('select state,actual_micros,charged_cents from public.icash_operation_spend where operation_key=$1',[operation])).rows[0],entries:(await q('select count(*)::int n from public.icash_credit_ledger')).rows[0].n});
 const parts=(amd=0,marked=true,price=14000)=>{
  const p=Object.fromEntries(costCategories.map(k=>[k,{amountMicros:k==='twilio'?price:k==='other'?amd:0,basis:['elevenlabs','llm'].includes(k)?'not_applicable':k==='other'?'estimated':'verified',evidenceRef:'Synthetic exact carrier AMD fixture '+k}]));
  p.other.subitems={speechGatherMicros:0,recordingMicros:0,storageMicros:0,...(marked?{answerDetectionMicros:amd}:{})};return p;
 };
 const receipt=(r,status='completed')=>({providerAccountSid:ac,callSid:call,fromPhone:r.from_phone,toPhone:r.to_phone,status,durationSeconds:status==='completed'?2:0,priceMicros:status==='completed'?14000:0,currency:'USD',speechGatherUsed:false});
 const settle=(r,p,status='completed')=>rpc('icash_settle_unstarted_recorded_call',[r.id,account,operation,receipt(r,status),p,'Synthetic exact carrier AMD gate receipt']);
 await scenario('AMD direct call saves immutable marker only with covered budget',async()=>{
  const r=await setup();assert.equal(r.call_context.answerPolicy,'carrier_amd_enable_v1');
  await reject(()=>q("update public.icash_call_recordings set call_context=call_context-'answerPolicy',row_version=row_version+1"),/permission denied|immutable/);
  const changed=structuredClone(context);changed.callContext.answerPolicy='carrier_amd_enable_v2';
  await reject(()=>rpc('icash_create_direct_recorded_call',[...createArgs.slice(0,8),changed]),/Invalid bound call context/);
 });
 for(const marker of [null,{},false,'invalid'])await scenario('AMD rejects malformed immutable marker '+JSON.stringify(marker),async()=>{
  const changed=structuredClone(context);changed.callContext.answerPolicy=marker;
  await reject(()=>rpc('icash_create_direct_recorded_call',[...createArgs.slice(0,8),changed]),/Invalid bound call context/);
  assert.equal(await get(),undefined);
 });
 await scenario('AMD rejects uncovered rate but legacy admission survives',async()=>{
  await admin(()=>q('update public.icash_operation_rates set costs_micros=$1',[{...emptyCosts,other:38000}]));
  const changed=structuredClone(context);changed.callContext.answerPolicy='carrier_amd_enable_v1';
  assert.equal(await rpc('icash_create_direct_recorded_call',[...createArgs.slice(0,8),changed]),null);
  assert(await rpc('icash_create_direct_recorded_call',createArgs));
 });
 await scenario('legacy optional missing context remains admitted',async()=>{
  const changed=structuredClone(context);delete changed.callContext;
  assert(await rpc('icash_create_direct_recorded_call',[...createArgs.slice(0,8),changed]));
 });
 for(const marked of [true,false])for(const status of ['completed','no-answer'])await scenario(`AMD gate exact fee, legacy and unanswered ${marked}/${status}`,async()=>{
  let r=await setup(marked);r=await trans('fail',{reason:'carrier_machine_detected'});const before=await ledger();
  const amd=marked&&status==='completed'?7500:0,p=parts(amd,marked,status==='completed'?14000:0);
  if(marked){
   await reject(()=>settle(r,parts(0,false,status==='completed'?14000:0),status),/Carrier or speech cost mismatch/);
   if(status==='completed')await reject(()=>settle(r,parts(0,true),status),/Carrier or speech cost mismatch/);
  }
  assert.deepEqual(await ledger(),before);
  assert.equal((await settle(r,p,status)).settled,true);const after=await ledger();
  assert.equal(after.spend.actual_micros,(status==='completed'?14000:0)+amd);assert.equal(after.entries,status==='completed'?1:0);
  assert.equal((await settle(r,p,status)).settled,true);assert.deepEqual(await ledger(),after);
  assert.equal((await q('select count(*)::int n from public.icash_live_conversations')).rows[0].n,0);
  assert.equal((await get()).start_claimed_at,null);assert.equal((await get()).recording_sid,null);
 });
 await scenario('AMD adapter persists separately estimated fee and original carrier price',async()=>{
  let r=await setup();r=await trans('fail',{reason:'carrier_machine_detected'});
  const db=async(path,method,body)=>path.startsWith('rpc/')?rpc(path.slice(4),Object.values(body)):(await q('select costs_micros from public.icash_operation_rates where id=$1',[permission])).rows;
  const carrier={sid:call,account_sid:ac,from:r.from_phone,to:r.to_phone,direction:'outbound-api',date_created:r.created_at,status:'completed',duration:'2',price:'-0.014000',price_unit:'USD'};
  assert.equal((await settleRecordingGateOnly(db,{getCall:async()=>carrier},r)).settled,true);
  const m=(await q('select components from public.icash_cost_manifests')).rows[0].components;
  assert.equal(m.twilio.amountMicros,14000);assert.equal(m.other.amountMicros,7500);assert.equal(m.other.subitems.answerDetectionMicros,7500);assert.equal(m.other.basis,'estimated');
 });
 for(const [seconds,observed] of [[0,0],[61,6500],[600,null]])await scenario('AMD completed exact costs and omission rejection '+seconds+' seconds',async()=>{
  let r=await setup();assert(await trans('authorize_recording',{nonceHash:createArgs[4],policy:'direct_recorded_v1'}));assert(await trans('claim_start'));
  const start=new Date().toISOString();assert(await trans('started',{recordingSid:rec,providerStartedAt:start}));
  assert(await trans('bind_conversation',{conversationId:'conv_amdfixture',toolTokenHash:'f'.repeat(64)}));
  // Local clock advances inside this rolled-back fixture; no wall-clock waits.
  if(seconds)await admin(()=>pg.exec(`create or replace function icash_recording_private.clock_now() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()+interval '601 seconds'$$;`));
  r=await trans('available',{recordingSid:rec,providerStartedAt:start,endedAt:new Date(Date.parse(start)+seconds*1000).toISOString(),durationSeconds:seconds,...(observed===null?{}:{providerRecordingPriceMicros:observed})});assert(r);
  await admin(async()=>{await q("update public.icash_live_conversations set state='complete',completed_at=now(),result=$1",[{durationSeconds:seconds}]);await q("insert into public.icash_cost_observations values('elevenlabs','conv_amdfixture',$1,0,'usd')",[operation]);});
  const add=recordingAddonCosts(r),p=parts(add.total,true,0);p.other.subitems={recordingMicros:add.recording,storageMicros:add.storage,speechGatherMicros:0,answerDetectionMicros:7500};p.elevenlabs.basis='verified';p.llm.basis='verified';
  const run=manifest=>rpc('icash_settle_voice_usage',[operation,manifest,'Synthetic complete recorded AMD voice receipt']);
  const before=await ledger();const omitted=structuredClone(p);omitted.other.amountMicros=0;delete omitted.other.subitems;
  await reject(()=>run(omitted),/Complete carrier AMD recording costs/);assert.deepEqual(await ledger(),before);
  assert.equal(await run(p),true);const after=await ledger();assert.equal(after.spend.actual_micros,add.total);assert.equal(after.entries,1);
  assert.equal(await run(p),true);assert.deepEqual(await ledger(),after);
 });
 for(const source of sources){
  for(const role of ['anon','authenticated','untrusted_test_role'])assert.equal((await q('select has_function_privilege($1,$2,\'execute\') as allowed',[role,source.signature])).rows[0].allowed,false);
  assert.equal((await q('select has_function_privilege(\'service_role\',$1,\'execute\') as allowed',[source.signature])).rows[0].allowed,true);
  console.log('AMD installed local function',source.signature,(await q('select md5(pg_get_functiondef($1::regprocedure)) as hash',[source.signature])).rows[0].hash);
 }
}
