import assert from 'node:assert/strict';

// Real callback resolve/reserve/record/context SQL, local synthetic receipts.
// No provider calls, messages, production mutations or receipt deletion.
export async function testOwnerSelfCallbacks(f){
 const {q,val,rpc,account,owner,receiptScenario,id,customer,transition,boundPayload,startPayload}=f;
 const self='+12142185280',business='+14154208230';
 const route=phone=>val('select icash_callback_private.route($1)',[phone??self]);
 const resolve=(source,phone=self)=>rpc('icash_resolve_seller_callback_config',{p_called:source.called_number,p_caller:phone});
 const reserve=(c,phone=self)=>rpc('icash_reserve_direct_reception',{p_config_id:c.id,p_call_sid:'CA'+'b'.repeat(32),p_provider_account_sid:c.provider_account_sid,p_from_phone:phone,p_to_phone:c.called_number,p_direction:'inbound',p_caller_hash:'c'.repeat(64),p_nonce_hash:'a'.repeat(64),p_stop_token_hash:'b'.repeat(64),p_config_hash:c.config_hash,p_version_id:c.reviewed_version_id});
 async function property(n,{acc=account,phone=self,archived=false,thread=true,buyer=false,revoked=true}={}){
  const key=id(n),test=id(n+1000);
  await q('insert into icash_screening_jobs(id,account_id,state,snapshot) values($1,$2,$3,$4)',[key,acc,archived?'archived':'complete',{propertyId:key,address:n+' Fixture Lane'}]);
  await q("insert into icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$1,'draft',jsonb_build_object('address',$3::text))",[key,acc,n+' Fixture Lane']);
  if(thread)await q("insert into icash_text_threads(id,account_id,deal_id,party,recipient,sender,paused,manual_only,retired_at,owner_buyer_test_id) values($1,$2,$1,$3,$4,$5,$6,false,case when $6 then now()-interval '1 hour' end,$7)",[key,acc,buyer?'buyer':'seller',phone,business,archived,buyer?test:null]);
  if(buyer){
   await q('insert into icash_owner_buyer_tests values($1,$2,$3,$4,$3,$5,$6,case when $7 then now()-interval \'1 hour\' end)',[test,acc,key,owner,business,phone,revoked]);
   await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,created_at,provider_id,body) values(gen_random_uuid(),$1,$2,'outgoing','delivered',now()-interval '2 hours','synthetic','Fixture buyer test')",[acc,key]);
  }else await q("insert into icash_call_recordings(account_id,screening_id,party,to_phone,from_phone,call_sid,dial_claimed_at) values($1,$2,'seller',$3,$4,'CA'||repeat('f',32),now()-interval '2 hours')",[acc,key,phone,business]);
  return key;
 }
 async function scenario(name,run){
  return receiptScenario('owner self '+name,async source=>{
   await q('update icash_accounts set bot_paused=false where id=$1',[account]);
   await q('update icash_wallets set balance_cents=10000 where account_id=$1',[account]);
   await q('insert into icash_daily_allowances(account_id,day,opening_cents,base_cents) values($1,public.icash_spending_day(),10000,10000)',[account]);
   await q('insert into icash_spend_activations(account_id,enabled,customer_cap_cents) values($1,true,100000)',[account]);
   await q("insert into icash_funding_orders values($1,'live','paid',now())",[account]);
   await run(source);
  });
 }
 async function start(c){
  const admitted=await reserve(c);assert(admitted.allowed,JSON.stringify(admitted));let r=admitted.session;
  assert.equal(await rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:r.nonce_hash}),null);
  for(const [action,payload] of [['claim_setup',{}],['bounded',boundPayload(r)],['bind_call_start',startPayload(r)],['authorize_recording',{nonceHash:r.nonce_hash,policy:'direct_recorded_v1'}],['claim_start',{}]]){r=await transition(r,action,payload);assert(r,action);}
  r=await transition(r,'started',{recordingSid:'RE'+'e'.repeat(32),providerStartedAt:r.recording_authorized_at});assert(r);return r;
 }
 await scenario('archived history admits the current property',async source=>{
  for(let n=2;n<=27;n++)await property(n,{archived:true,thread:n!==27});
  await property(28,{archived:true,buyer:true});await property(29,{archived:true,buyer:true});const current=await property(1);
  assert.equal(await val('select count(*) from icash_callback_private.candidates($1)',[self]),27);
  const before=await val('select jsonb_agg(to_jsonb(t) order by id) from icash_text_threads t');
  const routed=await route();assert.equal(routed.status,'matched');assert.equal(routed.threadId,current);
  const c=await resolve(source);assert.equal(c.id,source.id);assert.equal(c.callback_template_id,null);
  const r=await start(c);assert.deepEqual(r.callback_route,routed);assert.equal(r.account_id,account);
  const context=await rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:r.nonce_hash});
  assert.equal(context.address,'1 Fixture Lane');assert.equal(context.smsContext.threadId,current);
  assert.equal(await val('select thread_id from icash_seller_agreement_private.inbound_bindings where session_id=$1',[r.id]),current);
  assert.equal(await val('select count(*) from icash_signing_envelopes'),0,'Property context does not issue an agreement');
  assert.deepEqual(await val('select jsonb_agg(to_jsonb(t) order by id) from icash_text_threads t'),before);
  assert.equal(await val('select balance_cents from icash_wallets where account_id=$1',[account]),10000,'Admission holds credits without charging completed usage');
  assert.equal((await reserve(c)).reason,'duplicate_call');assert(await transition(r,'claim_register'));
 });
 await scenario('call-only owner context is saved without inventing a thread',async source=>{
  await property(2,{archived:true});const screening=await property(1,{thread:false}),r=await start(await resolve(source));
  assert.equal(r.callback_route.source,'call');assert.equal(r.callback_route.screeningId,screening);
  const context=await rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:r.nonce_hash});assert.equal(context.address,'1 Fixture Lane');assert.equal(context.smsContext,undefined);
 });
 await scenario('unknown and archived-only callers retain general reception',async source=>{
  await property(2,{archived:true});await property(3,{archived:true,buyer:true});assert.equal(await route(),null);
  const c=await resolve(source);assert.equal(c.id,source.id);const admitted=await reserve(c);assert(admitted.allowed);assert.equal(admitted.session.callback_route,null);
 });
 await scenario('multiple current properties ask for an address',async source=>{
  await property(1);await property(2);await property(3,{archived:true});const r=await start(await resolve(source));
  assert.equal(r.callback_route.status,'ambiguous');assert.deepEqual(await rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:r.nonce_hash}),{status:'ambiguous'});
 });
 for(const [name,sql,args] of [
  ['account Pause','update icash_accounts set bot_paused=true where id=$1',[account]],
  ['manual takeover','insert into icash_property_controls values($1,$2,true)',[account,id(1)]],
  ['thread Pause','update icash_text_threads set paused=true where id=$1',[id(1)]],
  ['retired current thread','update icash_text_threads set retired_at=now() where id=$1',[id(1)]],
  ['opt out',"insert into icash_text_suppressions(phone,reason) values($1,'synthetic opt out')",[self]],
  ['contact suppression',"insert into icash_contact_suppressions values(encode(sha256(convert_to($1,'UTF8')),'hex'))",[self]],
 ])await scenario(name+' remains held',async source=>{
  await property(1);await property(2,{archived:true});const c=await resolve(source);await q(sql,args);assert.equal((await route()).status,'held');assert.equal(await resolve(source),null);
  const denied=await reserve(c);assert.equal(denied.allowed,false);assert.equal(denied.reason,name==='account Pause'?'account_paused_or_changed':'callback_route_changed');assert.equal(await val('select count(*) from icash_operation_spend'),0);
 });
 await scenario('zero balance remains a funding rejection',async source=>{
  await property(1);await q('update icash_wallets set balance_cents=0 where account_id=$1',[account]);
  const r=await reserve(await resolve(source));assert.equal(r.allowed,false);assert.equal(await val('select count(*) from icash_recorded_reception_private.sessions'),0);
 });
 for(const [name,changes] of [
  ['active buyer test',"update icash_owner_buyer_tests set revoked_at=null"],
  ['ordinary buyer',"update icash_text_threads set owner_buyer_test_id=null where party='buyer'"],
  ['unretired buyer',"update icash_text_threads set retired_at=null where party='buyer'"],
  ['unarchived buyer property',"update icash_screening_jobs set state='complete' where id='"+id(2)+"'"],
  ['mismatched buyer identity',"update icash_owner_buyer_tests set phone='+12125550199'"],
 ])await scenario(name+' remains a role conflict',async source=>{
  await property(1);await property(2,{archived:true,buyer:true});await q(changes);
  assert.equal((await route()).status,'ambiguous_account');assert.equal(await resolve(source),null);
 });
 await scenario('other customer archived evidence remains held',async source=>{
  const phone='+12125550198';await property(1,{acc:customer,phone});await property(2,{acc:customer,phone,archived:true});
  assert.equal((await route(phone)).status,'held');assert.equal(await resolve(source,phone),null);
 });
 await scenario('other owner contact archived evidence remains held',async source=>{
  const phone='+12125550198';await property(1,{phone});await property(2,{phone,archived:true});
  assert.equal((await route(phone)).status,'held');assert.equal(await resolve(source,phone),null);
 });
 await scenario('cross-account self-phone evidence stays ambiguous',async source=>{
  await property(1);await property(2,{acc:customer,archived:true});assert.equal((await route()).status,'ambiguous_account');assert.equal(await resolve(source),null);
 });
 await scenario('changed owner identity does not inherit the exemption',async source=>{
  await property(1);await property(2,{archived:true});await q('insert into auth.users values($1)',[id(91)]);await q('update icash_accounts set owner_user_id=$1 where id=$2',[id(91),account]);
  assert.equal((await route()).status,'held');assert.equal(await resolve(source),null);
 });
 await scenario('pause between resolution and reserve is rejected',async source=>{
  await property(1);const c=await resolve(source);await q('update icash_text_threads set paused=true');assert.equal((await reserve(c)).reason,'callback_route_changed');
 });
 await scenario('reset after admission cannot attach the next demo',async source=>{
  await property(1);const r=await start(await resolve(source));await q("update icash_screening_jobs set state='archived'");await q('update icash_text_threads set retired_at=now(),paused=true');await property(2);
  assert.equal((await route()).threadId,id(2));assert.equal(await rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:r.nonce_hash}),null);assert.equal(await transition(r,'claim_register'),null);
 });
 for(const role of ['anon','authenticated'])for(const name of ['archived_owner_self_callback(uuid,uuid,text)','retired_owner_self_buyer(uuid,text)'])assert.equal(await val("select has_function_privilege($1,$2,'execute')",[role,'icash_callback_private.'+name]),false);
}
