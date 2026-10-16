// Isolated database regression for the observed one-second final-provider clock.
// Synthetic receipts only. No provider requests, production data or spending.
import assert from 'node:assert/strict';
export async function testOutboundFinalClock(f){
 const {pg,q,rpc,read,scenario,trans,get,context,account,operation,ac,call,rec,nonce,stop,policy,admin,claim,finish}=f;
 await pg.exec(`create function public.icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function public.icash_seller_voice_permission_current(uuid,uuid) returns boolean language sql as $$select false$$;`);
 await pg.exec(read('config/direct-recorded-outbound.sql'));
 async function stopped(){
  assert(await rpc('icash_create_direct_recorded_call',[account,operation,ac,null,nonce,stop,'direct-fixture',policy,context]));
  assert(await trans('claim_dial'));
  assert(await trans('bind_call',{callSid:call,providerAccountSid:ac,fromPhone:context.fromPhone,toPhone:'+12125550102'}));
  assert(await trans('authorize_recording',{nonceHash:nonce,policy:'direct_recorded_v1'}));
  assert(await trans('claim_start'));
  const initial=new Date(Math.floor(Date.now()/1000)*1000).toISOString();
  assert(await trans('started',{recordingSid:rec,providerStartedAt:initial}));
  assert(await trans('stop',{stopTokenHash:stop}));
  await admin(()=>q("create or replace function icash_recording_private.clock_now() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()+interval '5 minutes'$$"));
  assert(await trans('call_ended',{callSid:call,providerAccountSid:ac,status:'completed'}));
  const payload={recordingSid:rec,providerStartedAt:new Date(Date.parse(initial)+1000).toISOString(),endedAt:new Date(Date.parse(initial)+133000).toISOString(),durationSeconds:132};
  return {row:await get(),payload};
 }
 await scenario('reproduces outbound final receipt rejected for exactly one-second advance',async()=>{
  const {row,payload}=await stopped();
  assert.equal(await trans('available',payload),null);
  assert.deepEqual(await get(),row);
 });
 await scenario('existing completed receipt adopts final clock without rewriting historical evidence',async()=>{
  const {row,payload}=await stopped();
  const exact={...payload,providerStartedAt:row.provider_started_at,endedAt:new Date(Date.parse(row.provider_started_at)+132000).toISOString()};
  const legacy=await trans('available',exact);assert.equal(legacy.state,'available');assert.equal(legacy.final_provider_started_at,undefined);
  // Apply the actual migration inside this scenario's rollback-only transaction.
  await admin(()=>pg.exec(read('config/required-call-recording-final-clock.sql').replace(/^begin;\n/m,'').replace(/\ncommit;\s*$/,'')));
  const adopted=await trans('available',exact);assert.equal(adopted.state,'available');
  for(const key of ['provider_started_at','audio_expires_at','next_delete_at','ended_at','duration_seconds','consent_at','consent_evidence','recording_authorized_at'])assert.deepEqual(adopted[key],legacy[key],key);
  assert.equal(adopted.final_provider_started_at,legacy.provider_started_at);
 });
 await pg.exec(read('config/required-call-recording-final-clock.sql'));
 await scenario('canonical completed clock reconciles through real worker lease and preserves all original evidence',async()=>{
  const {row,payload}=await stopped();
  for(const offset of [-1000,1001,2000]){
   const candidate=Date.parse(row.provider_started_at)+offset;
   assert.equal(await trans('available',{...payload,providerStartedAt:new Date(candidate).toISOString(),endedAt:new Date(candidate+132000).toISOString()}),null);
  }
  for(const action of ['started','processing'])assert.equal(await trans(action,{recordingSid:rec,providerStartedAt:payload.providerStartedAt}),null);
  assert.equal(await trans('available',{...payload,recordingSid:'RE'+'f'.repeat(32)}),null);
  assert.equal(await trans('available',{...payload,endedAt:new Date(Date.parse(payload.endedAt)+1000).toISOString()}),null);
  assert.equal(await rpc('icash_transition_call_recording',[row.id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',operation,row.state,'available',payload]),null);
  assert.equal(await rpc('icash_transition_call_recording',[row.id,account,'voice:wrong',row.state,'available',payload]),null);
  assert.equal(await trans('available',payload,'recording'),null);
  const [leased]=await claim('reconcile');assert.equal(leased.id,row.id);
  assert.equal(await finish(leased,'reconcile','available',payload,'11111111-1111-4111-8111-111111111111'),null);
  assert.equal((await finish(leased,'reconcile','available',payload)).state,'available');
  const done=await get();assert.equal(done.state,'available');assert.equal(done.reconcile_lease_token,null);
  assert.equal(Date.parse(done.final_provider_started_at),Date.parse(payload.providerStartedAt));
  assert.equal(Date.parse(done.ended_at),Date.parse(payload.endedAt));assert.equal(done.duration_seconds,132);
  for(const key of ['provider_started_at','audio_expires_at','next_delete_at','recording_authorized_at','consent_at','consent_evidence','start_claimed_at','dial_claimed_at','provider_account_sid','call_sid','recording_sid','operation_key','account_id','rate_id','charge_cap_cents','pricing_policy'])assert.deepEqual(done[key],row[key],key);
  assert.equal(done.provider_recording_price_micros,null);assert.equal(done.price_is_estimate,true);
  assert.equal((await trans('available',payload)).final_provider_started_at,done.final_provider_started_at,'identical completed receipt is replay safe');
  assert.equal(await trans('available',{...payload,providerStartedAt:row.provider_started_at,endedAt:new Date(Date.parse(row.provider_started_at)+132000).toISOString()}),null);
  assert.equal(await trans('available',{...payload,durationSeconds:133,endedAt:new Date(Date.parse(payload.endedAt)+1000).toISOString()}),null);
  assert.equal((await trans('available',{...payload,providerRecordingPriceMicros:2500})).provider_recording_price_micros,2500);
  assert.equal(await trans('available',{...payload,providerRecordingPriceMicros:2501}),null);
  assert.equal(await trans('available',payload),null,'observed price cannot become unknown on replay');
  for(const set of ["final_provider_started_at=provider_started_at","provider_started_at=provider_started_at+interval '1 second',audio_expires_at=audio_expires_at+interval '1 second'","ended_at=ended_at+interval '1 second',duration_seconds=duration_seconds+1"]){
   await q('savepoint immutable_probe');
   try{await assert.rejects(admin(()=>q('update public.icash_call_recordings set '+set+',row_version=row_version+1 where id=$1',[row.id])),/immutable|transaction is aborted/i);}
   finally{await q('rollback to savepoint immutable_probe');await q('release savepoint immutable_probe');await q('set local role service_role');}
  }
 });
 await scenario('exact start stays compatible and expired final receipt cannot extend retention',async()=>{
  const {row,payload}=await stopped();
  await admin(()=>q("create or replace function icash_recording_private.clock_now() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()+interval '31 days'$$"));
  const done=await trans('available',{...payload,providerStartedAt:row.provider_started_at,endedAt:new Date(Date.parse(row.provider_started_at)+132000).toISOString()});
  assert.equal(done.state,'expired');assert.equal(done.provider_started_at,done.final_provider_started_at);
  assert.equal(done.audio_expires_at,row.audio_expires_at);assert.equal(done.next_delete_at,row.next_delete_at);
 });
 for(const role of ['anon','authenticated'])assert.equal((await q("select has_function_privilege($1,'public.icash_transition_call_recording(uuid,uuid,text,text,text,jsonb)','execute') allowed",[role])).rows[0].allowed,false);
}
