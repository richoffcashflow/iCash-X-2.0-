import assert from 'node:assert/strict';

// Existing recording state machine, immutable evidence guard, leases and ledger.
// The fixture owner's clock override never changes production time or data.
export async function testRecordingReconcileBackoff(f){
 const {pg,q,rpc,read,scenario,trans,get,starting,create,account,operation,ac,call,rec,stop,admin,claim,finish}=f;
 await pg.exec(`create function public.icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function public.icash_seller_voice_permission_current(uuid,uuid) returns boolean language sql as $$select false$$;`);
 await pg.exec(read('config/direct-recorded-outbound.sql'));
 await pg.exec(read('config/required-call-recording-final-clock.sql'));
 const signature='public.icash_finish_call_recording_work(uuid,uuid,text,text,uuid,text,jsonb)';
 const definition=async()=>(await q('select pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition;
 const catalog=async()=>(await q(`select proname,pg_get_functiondef(oid) definition,prosecdef,proconfig,proacl::text,proowner
  from pg_proc where pronamespace='public'::regnamespace and proname in ('icash_create_call_recording','icash_transition_call_recording','icash_claim_call_recording_work','icash_finish_call_recording_work','icash_settle_unstarted_recorded_call') order by proname`)).rows;
 const patch=read('config/recording-reconcile-backoff.sql'),original=await definition();
 const oldRetry="update public.icash_call_recordings set next_reconcile_at=t+interval '1 minute',last_error=p_payload->>'reason',";
 for(const [changed,pattern] of [
  [original.replace('SECURITY DEFINER','SECURITY INVOKER'),/private recording reconciliation security contract/],
  [original.replace(oldRetry,oldRetry+' /* '+oldRetry+' */'),/one unchanged recording retry schedule/],
  [original.replace("last_action='finish_reconcile',","last_action='different',"),/one unchanged recording finish schedule/],
 ]){
  await pg.exec(changed);const unexpected=await definition();
  await assert.rejects(()=>pg.exec(patch),pattern);await pg.exec('rollback;');assert.equal(await definition(),unexpected);
 }
 await pg.exec(original.replace('declare r public.icash_call_recordings;','-- Concurrent unrelated body text must survive.\ndeclare r public.icash_call_recordings;'));
 const before=await catalog();await pg.exec(patch);const after=await catalog();
 for(let i=0;i<before.length;i++){
  const {definition:oldDefinition,...oldMetadata}=before[i],{definition:newDefinition,...newMetadata}=after[i];
  assert.deepEqual(newMetadata,oldMetadata,'Owner, grants and security settings are unchanged');
  if(before[i].proname!=='icash_finish_call_recording_work')assert.equal(newDefinition,oldDefinition,'Claiming, transitions, admission and settlement remain unchanged');
 }
 const patched=await definition();
 const pairs=[...patch.matchAll(/needle:=\$old\$([\s\S]*?)\$old\$;\s*replacement:=\$new\$([\s\S]*?)\$new\$;/g)];
 assert.equal(pairs.length,2);assert.equal(patched,pairs.reduce((s,p)=>s.replace(p[1],p[2]),before.find(x=>x.proname==='icash_finish_call_recording_work').definition));
 await pg.exec(read('tests/required-call-recording-database.sql'));
 await pg.exec(`create or replace function icash_recording_private.clock_now() returns timestamptz language sql volatile set search_path='' as $$
  select coalesce(nullif(current_setting('test.recording_clock',true),'')::timestamptz,clock_timestamp()) $$;`);
 let now;
 const at=async(millis)=>{now=millis;await q("select set_config('test.recording_clock',$1,true)",[new Date(now).toISOString()]);};
 const pin=()=>at(Date.now());
 const financial=async()=>(await q(`select jsonb_build_object('wallets',(select jsonb_agg(to_jsonb(w)) from public.icash_wallets w),
  'spend',(select jsonb_agg(to_jsonb(s) order by s.operation_key) from public.icash_operation_spend s),
  'jobs',(select jsonb_agg(to_jsonb(j) order by j.id) from public.icash_voice_jobs j),
  'ledger',(select jsonb_agg(to_jsonb(l)) from public.icash_credit_ledger l)) as result`)).rows[0].result;
 const prepare=async(kind,attempt,{stopRequested=false}={})=>{
  await pin();
  if(kind==='unknown'){await create();await trans('claim_dial');await trans('dial_unknown');}
  else{
   await starting();await trans('start_unknown');
   if(kind==='ended'||stopRequested)await trans('stop',{stopTokenHash:stop});
   if(kind==='ended')await trans('call_ended',{callSid:call,providerAccountSid:ac,status:'completed'});
  }
  await admin(()=>q('update public.icash_call_recordings set reconcile_attempts=$1,next_reconcile_at=$2,row_version=row_version+1 where operation_key=$3',[attempt-1,new Date(now).toISOString(),operation]));
  const [row]=await claim('reconcile');assert(row);assert.equal(row.reconcile_attempts,attempt);return row;
 };
 const evidence=row=>Object.fromEntries(['state','call_sid','recording_sid','conversation_id','dial_claimed_at','start_claimed_at','consent_at','consent_evidence','call_ended_at','end_requested_at','provider_started_at','ended_at','duration_seconds','provider_recording_price_micros','price_is_estimate'].map(k=>[k,row[k]]));
 for(const kind of ['unknown','ended'])for(const [attempt,seconds] of [[1,60],[3,60],[4,120],[6,120],[7,300],[12,300],[13,900],[10001,900]])await scenario(`${kind} receipt retry attempt ${attempt} waits ${seconds}s without new evidence or billing`,async()=>{
  const row=await prepare(kind,attempt),ledger=await financial();
  const done=await finish(row,'reconcile','retry',{reason:'provider_recording_reconciliation_required'});
  assert.equal(Date.parse(done.next_reconcile_at)-now,seconds*1000);assert.equal(done.reconcile_lease_token,null);assert.equal(done.reconcile_lease_expires_at,null);
  assert.deepEqual(evidence(done),evidence(row));assert.deepEqual(await financial(),ledger);
  if(kind==='unknown')assert.equal(await trans('claim_dial'),null,'Unknown provider outcomes never authorize another dial');
  else assert.equal(await trans('claim_start'),null,'Recorded-start claims remain one-use');
 });
 for(const stopRequested of [false,true])await scenario(`known carrier remains on one-minute retry at 10001 attempts; stop requested ${stopRequested}`,async()=>{
  const row=await prepare('active',10001,{stopRequested}),ledger=await financial();
  const done=await finish(row,'reconcile','retry',{reason:'provider_recording_reconciliation_required'});
  assert.equal(Date.parse(done.next_reconcile_at)-now,60000);assert.equal(done.call_ended_at,null);assert.deepEqual(evidence(done),evidence(row));assert.deepEqual(await financial(),ledger);
 });
 const payload=()=>({recordingSid:rec,providerStartedAt:new Date(now).toISOString(),endedAt:new Date(now).toISOString(),durationSeconds:0});
 for(const kind of ['ended','active'])await scenario(`available audio with missing AI identity backs off only after confirmed end: ${kind}`,async()=>{
  const row=await prepare(kind,101),ledger=await financial(),receipt=payload();
  const done=await finish(row,'reconcile','available',receipt);assert.equal(done.state,'available');assert.equal(done.conversation_id,null);
  assert.equal(Date.parse(done.next_reconcile_at)-now,kind==='ended'?900000:60000);assert.equal(done.recording_sid,rec);assert.equal(done.provider_recording_price_micros,null);
  assert.deepEqual(await financial(),ledger);
  if(kind==='ended'){
   const saved=evidence(done);await at(now+900000);const [again]=await claim('reconcile');assert.equal(again.id,row.id);
   const repeated=await finish(again,'reconcile','available',receipt);assert.deepEqual(evidence(repeated),saved);assert.equal(Date.parse(repeated.next_reconcile_at)-now,900000);
  }
 });
 await scenario('bound completed audio keeps its null schedule after the transition',async()=>{
  const row=await prepare('ended',101),receipt=payload();
  assert(await trans('available',receipt));
  assert(await trans('bind_conversation',{conversationId:'conv_backofffixture',toolTokenHash:'a'.repeat(64)}));
  const ledger=await financial(),done=await finish(row,'reconcile','available',receipt);
  assert.equal(done.next_reconcile_at,null);assert.equal(done.conversation_id,'conv_backofffixture');assert.equal(done.reconcile_lease_token,null);assert.deepEqual(await financial(),ledger);
 });
 await scenario('wrong or expired leases and malformed receipts cannot mutate rows or billing',async()=>{
  const row=await prepare('ended',101),saved=await get(),ledger=await financial();
  assert.equal(await finish(row,'reconcile','retry',{reason:'timeout'},'ffffffff-ffff-4fff-8fff-ffffffffffff'),null);assert.deepEqual(await get(),saved);
  await q('savepoint invalid_receipt');try{await assert.rejects(()=>finish(row,'reconcile','available',{recordingSid:'wrong'}),/Invalid provider recording evidence/);}finally{await q('rollback to savepoint invalid_receipt');await q('release savepoint invalid_receipt');}
  assert.deepEqual(await get(),saved);assert.deepEqual(await financial(),ledger);
  await at(now+120000);assert.equal(await finish(row,'reconcile','retry',{reason:'timeout'}),null);assert.deepEqual(await get(),saved);
  const [replacement]=await claim('reconcile');assert.notEqual(replacement.reconcile_lease_token,row.reconcile_lease_token);
  assert.equal(await finish(row,'reconcile','retry',{reason:'timeout'}),null);assert(await finish(replacement,'reconcile','retry',{reason:'timeout'}));assert.deepEqual(await financial(),ledger);
 });
 await scenario('fresh due receipt is claimed before backed-off old work, which returns exactly at the bounded deadline',async()=>{
  // Two independent synthetic operations; no provider dispatch is performed.
  await pin();const seed=await create(),freshJob='11111111-1111-4111-8111-111111111111',freshId='22222222-2222-4222-8222-222222222222',freshOperation='voice:'+freshJob;
  await admin(async()=>{
   await q(`insert into public.icash_voice_jobs(id,account_id,permission_id,state,operation_key) select $1,account_id,permission_id,'dispatching',$2 from public.icash_voice_jobs where operation_key=$3`,[freshJob,freshOperation,operation]);
   await q(`insert into public.icash_operation_spend select (jsonb_populate_record(null::public.icash_operation_spend,to_jsonb(s)||jsonb_build_object('operation_key',$1::text))).* from public.icash_operation_spend s where operation_key=$2`,[freshOperation,operation]);
   await q(`insert into public.icash_call_recordings select (jsonb_populate_record(null::public.icash_call_recordings,$1::jsonb||jsonb_build_object('id',$2::uuid,'voice_job_id',$3::uuid,'operation_key',$4::text,'next_reconcile_at',$5::timestamptz))).*`,[seed,freshId,freshJob,freshOperation,new Date(now+1000).toISOString()]);
  });
  await trans('claim_dial');await trans('dial_unknown');
  await admin(()=>q('update public.icash_call_recordings set reconcile_attempts=100,row_version=row_version+1 where operation_key=$1',[operation]));
  const [old]=await rpc('icash_claim_call_recording_work',['reconcile',1,120]);assert.equal(old.id,seed.id);
  const ledger=await financial();await finish(old,'reconcile','retry',{reason:'provider_recording_reconciliation_required'});const deadline=now+900000;
  await at(now+1000);const [fresh]=await rpc('icash_claim_call_recording_work',['reconcile',1,120]);assert.equal(fresh.id,freshId);assert.equal(fresh.reconcile_attempts,1);
  // Hold the fresh lease through this queue boundary to isolate the old deadline.
  await admin(()=>q('update public.icash_call_recordings set reconcile_lease_expires_at=$1,row_version=row_version+1 where id=$2',[new Date(deadline+120000).toISOString(),freshId]));
  await at(deadline-1);assert.deepEqual(await rpc('icash_claim_call_recording_work',['reconcile',1,120]),[]);
  await at(deadline);const [returned]=await rpc('icash_claim_call_recording_work',['reconcile',1,120]);assert.equal(returned.id,old.id);assert.equal(returned.reconcile_attempts,102);assert.equal(returned.call_sid,null);assert.equal(returned.recording_sid,null);assert.deepEqual(await financial(),ledger);
 });
 console.log('PASS migration guards, bounded receipt backoff, active-call checks, fair due-time service, leases, immutable evidence and unchanged billing.');
}
