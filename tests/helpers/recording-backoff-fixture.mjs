// Real database transitions and leases; synthetic receipts, no provider calls.
import assert from 'node:assert/strict';
export async function testRecordingBackoff(f){
 const {pg,q,read,scenario,trans,get,bound,operation,ac,call,rec,nonce,stop,admin,claim,finish}=f;
 await pg.exec(read('config/recording-reconcile-backoff.sql'));
 const seconds=r=>(Date.parse(r.next_reconcile_at)-Date.parse(r.updated_at))/1000;
 const setup=async ended=>{
  await bound();
  assert(await trans('consent',{nonceHash:nonce,source:'twilio_gather_speech',utterance:'yes',confidence:0.99,disclosureVersion:'speech-disclosure-v1'}));
  assert(await trans('claim_start'));
  if(ended){assert(await trans('stop',{stopTokenHash:stop}));assert(await trans('call_ended',{callSid:call,providerAccountSid:ac,status:'completed'}));}
  await admin(()=>q("update public.icash_call_recordings set reconcile_attempts=1999,next_reconcile_at=now()-interval '1 minute',row_version=row_version+1 where operation_key=$1",[operation]));
  return (await claim('reconcile'))[0];
 };
 for(const ended of [false,true])await scenario('retry delay '+(ended?'ended':'active'),async()=>{
  const r=await setup(ended),before=await get();
  assert.equal(await finish(r,'reconcile','retry',{reason:'fixture'},'00000000-0000-4000-8000-000000000001'),null);
  assert.deepEqual(await get(),before,'wrong lease cannot delay work');
  const after=await finish(r,'reconcile','retry',{reason:'provider_recording_reconciliation_required'});
  assert.equal(seconds(after),ended?3600:60);
  assert.equal(after.call_sid,before.call_sid);assert.equal(after.conversation_id,null);
  assert.equal(after.reconcile_lease_token,null);
  const spend=(await q('select state,charged_cents from public.icash_operation_spend where operation_key=$1',[operation])).rows[0];
  assert.deepEqual(spend,{state:'dispatched',charged_cents:null},'backoff never settles or releases uncertain spend');
 });
 await scenario('available recording without AI identity backs off',async()=>{
  const r=await setup(true),started=r.consent_at;
  const after=await finish(r,'reconcile','available',{recordingSid:rec,providerStartedAt:started,endedAt:started,durationSeconds:0});
  assert(after);assert(seconds(after)>3599&&seconds(after)<=3600);
  assert.equal(after.state,'available');assert.equal(after.recording_sid,rec);
  assert.equal(after.next_delete_at,after.audio_expires_at,'backoff never delays retention deletion');
 });
 for(const role of ['anon','authenticated'])assert.equal((await q("select has_function_privilege($1,'icash_finish_call_recording_work(uuid,uuid,text,text,uuid,text,jsonb)','execute') allowed",[role])).rows[0].allowed,false);
}
