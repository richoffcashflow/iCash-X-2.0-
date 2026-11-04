import assert from 'node:assert/strict';
import {receptionTarget} from '../../lib/general-reception.ts';
export async function testSellerCallbackRouting(f){
 const {db,q,val,rpc,read,fixture,account,owner,config,rate,boundPayload,startPayload}=f;
 await db.exec(`create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
 alter table icash_text_threads add owner_buyer_test_id uuid,add seller_intake_id uuid;
 alter table icash_sms_conversation_focus add source_id uuid;
 alter table icash_contact_permissions add buyer_id uuid;
 create table icash_business_voice_numbers(phone text,outbound_enabled boolean,forwarding_ready boolean,provider_account_sid text default 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',caller_id_sid text default 'PNbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
 create table icash_call_recordings(account_id uuid,screening_id uuid,party text,to_phone text,from_phone text,call_sid text,dial_claimed_at timestamptz,provider_account_sid text default 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',caller_id_sid text default 'PNbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
 create table icash_customer_phone_calls(account_id uuid,screening_id uuid,recipient_phone text,business_phone text,child_sid text,created_at timestamptz,provider_account_sid text default 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
 create table icash_seller_intakes(id uuid,name text,phone text,state text,data_rights_until timestamptz);
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
 create table icash_buyer_profiles(id uuid,account_id uuid,display_name text);
 create table icash_buyer_candidates(buyer_id uuid,deal_id uuid,rights_until timestamptz);
 `);
 const continuity=read('config/reception-contact-continuity.sql');
 await db.exec(continuity.slice(0,continuity.indexOf('-- Keep the existing authorized buyer')).replace(/^begin;$/m,''));
 await db.exec(`alter function public.icash_recorded_reception_property_context(uuid,text) rename to icash_reception_context_before_agreement;
 create function public.icash_recorded_reception_property_context(p_id uuid,p_nonce_hash text) returns jsonb language sql as $$select public.icash_reception_context_before_agreement(p_id,p_nonce_hash)$$;`);
 await db.exec(f.fn('config/seller-call-agreement.sql','icash_seller_agreement_recording'));
 await db.exec(read('config/seller-callback-routing.sql'));
 const customer='11111111-1111-4111-8111-111111111111',customerOwner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',second='22222222-2222-4222-8222-222222222222',phone='+12125550199';
 const id=n=>String(n).padStart(8,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 async function setup(context={}){
  await fixture(600);
  await q('update public.icash_operating_budget set standard_cost_multiplier=3,elevenlabs_cost_multiplier=3');
  await q('update public.icash_accounts set bot_paused=true where id=$1',[account]);
  await q('update public.icash_wallets set balance_cents=0 where account_id=$1',[account]);
  await q("insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values($1,$2,'Customer',false,100000)",[customer,customerOwner]);
  await q('insert into public.icash_wallets(account_id,balance_cents) values($1,10000)',[customer]);
  await q('insert into public.icash_daily_allowances(account_id,day,opening_cents,base_cents) values($1,public.icash_spending_day(),10000,10000)',[customer]);
  await q('insert into public.icash_spend_activations(account_id,enabled,customer_cap_cents) values($1,true,100000)',[customer]);
  await q("insert into public.icash_funding_orders values($1,'live','paid',now())",[customer]);
  const old=await val('select to_jsonb(r) from public.icash_operation_rates r where id=$1',[rate]);
  let newRate={...old,id:id(80),version:old.version+':standing',expires_at:'9999-12-31T23:59:59Z'};
  await q('insert into public.icash_operation_rates select (jsonb_populate_record(null::public.icash_operation_rates,$1)).*',[newRate]);
  newRate=await val('select to_jsonb(r) from public.icash_operation_rates r where id=$1',[newRate.id]);
  const cfg=await val('select to_jsonb(c) from icash_recorded_reception_private.configs c where id=$1',[config]);
  const components=Object.fromEntries(Object.entries(newRate.costs_micros).map(([name,amount])=>[name,{...(name==='twilio'||name==='elevenlabs'?{source:'provider_receipt'}:name==='llm'?{source:'inclusive_zero'}:name==='other'?{source:'recording_stream_gather_storage_estimate',policyVersion:'recorded-reception-30d-speech-v1',pricingPolicy:cfg.pricing_policy}:{source:'fixed_estimate',amountMicros:amount}),evidenceRef:'SYNTHETIC local reviewed costs only'}]));
  // Use the exact existing standing-policy add-on source name.
  const rule=/part->>'source' is distinct from '([^']+)'[\s\S]*?policyVersion/.exec(read('config/recorded-reception.sql').split("elsif cat='other' then")[1]);
  components.other.source=rule[1];
  const policy=await val("insert into icash_recorded_reception_private.cost_policies(version,account_id,rate_id,rate_snapshot,enabled,approved_at,reviewed_until,approval_reference,standard_cost_multiplier,elevenlabs_cost_multiplier,components) values('synthetic-callback-standing',$1,$2,$3,true,now(),'9999-12-31T23:59:59Z','SYNTHETIC local standing approval',3,3,$4) returning to_jsonb(cost_policies)-'enabled'",[account,newRate.id,Object.fromEntries(Object.entries(newRate).filter(([k])=>k!=='enabled')),components]);
  await q('update icash_recorded_reception_private.configs set enabled=false where id=$1',[config]);
  const source={...cfg,id:id(81),version:2,enabled:true,entry_policy:'direct_recorded_v1',context_policy:'buyer_seller_v1',context_policy_hash:'06b4040c9d2b788ac204479d1179173f9acbd59172a7e930bac0b189438fde57',context_approval_reference:'SYNTHETIC local callback property context',rate_id:newRate.id,rate_snapshot:Object.fromEntries(Object.entries(newRate).filter(([k])=>k!=='enabled')),cost_policy_id:policy.id,cost_policy_snapshot:policy,approved_at:policy.approved_at,reviewed_until:policy.reviewed_until,...context};
  await q('insert into icash_recorded_reception_private.configs select (jsonb_populate_record(null::icash_recorded_reception_private.configs,$1)).*',[source]);
  return source;
 }
 async function property(n,acc=customer,channel='text',sender='+14243948384'){
  const key=id(n);
  await q('insert into icash_screening_jobs(id,account_id,snapshot) values($1,$2,$3)',[key,acc,{propertyId:key}]);
  await q("insert into icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$1,'draft',jsonb_build_object('address',$3::text))",[key,acc,n+' Fixture Lane']);
  await q("insert into icash_text_threads(id,account_id,deal_id,party,recipient,sender,paused,manual_only) values($1,$2,$1,'seller',$3,$4,false,false)",[key,acc,phone,sender]);
  if(channel==='text')await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,created_at,provider_id,body) values(gen_random_uuid(),$1,$2,'outgoing','delivered',now()-interval '1 minute','synthetic','Fixture opener')",[acc,key]);
  if(channel==='call')await q("insert into icash_call_recordings(account_id,screening_id,party,to_phone,from_phone,call_sid,dial_claimed_at) values($1,$2,'seller',$3,$4,'CA'||repeat('f',32),now()-interval '1 minute')",[acc,key,phone,sender]);
  return key;
 }
 const resolve=()=>rpc('icash_resolve_seller_callback_config',{p_called:receptionTarget.calledNumber,p_caller:phone});
 async function reserve(c){return rpc('icash_reserve_direct_reception',{p_config_id:c.id,p_call_sid:'CA'+'b'.repeat(32),p_provider_account_sid:c.provider_account_sid,p_from_phone:phone,p_to_phone:c.called_number,p_direction:'inbound',p_caller_hash:'c'.repeat(64),p_nonce_hash:'a'.repeat(64),p_stop_token_hash:'b'.repeat(64),p_config_hash:c.config_hash,p_version_id:c.reviewed_version_id});}
 const transition=(r,action,payload={})=>rpc('icash_transition_recorded_reception',{p_id:r.id,p_account:r.account_id,p_operation:r.operation_key,p_expected_version:r.row_version,p_action:action,p_payload:payload});
 async function scenario(name,run,context={}){await q('begin');try{const source=await setup(context);await run(source);console.log('PASS seller callback '+name);}finally{await q('rollback');}}
 for(const channel of ['text','call'])await scenario(channel+' receipt routes funded customer while owner is paused and empty',async source=>{
  const thread=await property(1,customer,channel),c=await resolve();assert.equal(c.account_id,customer);assert.equal(c.callback_template_id,source.id);assert.equal(c.config_hash,source.config_hash);assert.equal(c.rate_id,source.rate_id);assert.equal((await resolve()).id,c.id);
  assert.equal(await val('select balance_cents from icash_wallets where account_id=$1',[account]),0);assert.equal(await val('select bot_paused from icash_accounts where id=$1',[account]),true);
  const admitted=await reserve(c);assert(admitted.allowed,JSON.stringify(admitted));let r=admitted.session;assert.equal(r.account_id,customer);assert.equal(r.callback_route.threadId,thread);
  assert.equal(await val('select balance_cents from icash_wallets where account_id=$1',[customer]),10000,'Admission is a hold, not completed-usage charging');
  r=await transition(r,'claim_setup');assert(r);r=await transition(r,'bounded',boundPayload(r));assert(r);r=await transition(r,'bind_call_start',startPayload(r));assert(r);
  r=await transition(r,'authorize_recording',{nonceHash:r.nonce_hash,policy:'direct_recorded_v1'});assert(r);r=await transition(r,'claim_start');assert(r);r=await transition(r,'started',{recordingSid:'RE'+'e'.repeat(32),providerStartedAt:r.recording_authorized_at});assert(r);
  const context=await rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:r.nonce_hash});assert.equal(context.address,'1 Fixture Lane');assert.equal(context.smsContext.threadId,thread);
  assert.equal((await reserve(c)).reason,'duplicate_call');
  assert.equal((await rpc('icash_get_recorded_reception_config',{p_called_number:c.called_number})).id,source.id,'Legacy lookup still has exactly one template');
  await q('update icash_recorded_reception_private.configs set enabled=false where id=$1',[source.id]);assert.equal(await rpc('icash_resolve_seller_callback_config',{p_called:c.called_number,p_id:c.id}),null);assert.equal(await transition(r,'claim_register'),null,'Template disable remains a final gate');
 });
 await scenario('unknown and unsent contacts do not route or provision a customer',async source=>{await property(1,customer,'draft');assert.equal((await resolve()).id,source.id);assert.equal(await val('select count(*) from icash_recorded_reception_private.configs where callback_template_id is not null'),0);});
 await scenario('multiple customer accounts never choose or charge an account',async()=>{await property(1);await q('insert into auth.users values($1)',[id(90)]);await q("insert into icash_accounts(id,owner_user_id,assistant_name,bot_paused) values($1,$2,'Second customer',true)",[second,id(90)]);await property(2,second);assert.equal(await resolve(),null);assert.equal(await val('select count(*) from icash_operation_spend'),0);});
 await scenario('multiple properties ask for an address without guessing',async()=>{await property(1);await property(2);const c=await resolve(),a=await reserve(c);assert(a.allowed);assert.equal(a.session.callback_route.status,'ambiguous');assert.equal(a.session.callback_route.threadId,undefined);});
 await scenario('buyer and seller use of one phone cannot cross roles',async()=>{await property(1);await property(2);await q("update icash_text_threads set party='buyer' where id=$1",[id(2)]);assert.equal(await resolve(),null);assert.equal(await val('select count(*) from icash_operation_spend'),0);});
 for(const [label,sql,args] of [
  ['manual property',"insert into icash_property_controls values($1,$2,true)",[customer,id(1)]],
  ['manual thread','update icash_text_threads set manual_only=true',[]],
  ['Pause','update icash_accounts set bot_paused=true where id=$1',[customer]],
  ['zero balance','update icash_wallets set balance_cents=0 where account_id=$1',[customer]],
  ['opt-out',"insert into icash_text_suppressions(phone,reason) values($1,'synthetic opt out')",[phone]],
 ])await scenario(label+' remains held',async()=>{await property(1);await q(sql,args);assert.equal(await resolve(),null);assert.equal(await val('select count(*) from icash_operation_spend'),0);});
 await scenario('route changes between resolution and reserve are rejected',async()=>{await property(1);const c=await resolve();await q('update icash_text_threads set paused=true');assert.equal((await reserve(c)).reason,'callback_route_changed');});
 await scenario('owner lookup is receipt-backed, scoped by called number, and read-only',async()=>{await property(1);await property(2,customer,'call','+17208134296');await q("insert into icash_business_voice_numbers(phone,outbound_enabled,forwarding_ready) values('+17208134296',true,true)");const r=await rpc('icash_owner_callback_context',{p_actor:owner,p_phone:phone});assert.equal(r.status,'ambiguous');assert.equal(r.matches.length,2);const one=await rpc('icash_owner_callback_context',{p_actor:owner,p_phone:phone,p_business:'+17208134296'});assert.equal(one.status,'matched');assert.equal(one.matches[0].address,'2 Fixture Lane');await q('savepoint forbidden');await assert.rejects(rpc('icash_owner_callback_context',{p_actor:customerOwner,p_phone:phone}),/Owner required/);await q('rollback to savepoint forbidden');assert.equal(await val('select count(*) from icash_operation_spend'),0);});
 for(const role of ['anon','authenticated'])for(const name of ['icash_resolve_seller_callback_config(text,text,uuid)','icash_owner_callback_context(uuid,text,text)'])assert.equal(await val('select has_function_privilege($1,$2,\'execute\')',[role,'public.'+name]),false);
 if(process.env.RECEPTION_RECEIPT_ONLY_CALLBACKS==='1'){
  // Apply the actual callback-only prerequisites from the preceding voice
  // migration; the full voice selector fixture is exercised separately.
  const prerequisites=[...read('config/verified-outbound-business-numbers.sql').matchAll(/\('((?:icash_callback_private\.candidates|public\.icash_owner_callback_context)[^']+)',\s*\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$\)/g)];
  assert.equal(prerequisites.length,2);
  for(const [,signature,needle,replacement] of prerequisites){const definition=await val('select pg_get_functiondef($1::regprocedure)',[signature]);assert.equal(definition.split(needle).length,2);await db.exec(definition.replace(needle,replacement));}
  await db.exec(`create table public.icash_text_senders(phone text primary key,enabled boolean);
   create table public.icash_webinar_phone_suppressions(phone text);
   alter table icash_seller_intakes add assigned_account uuid,add screening_id uuid;
   alter table icash_screening_jobs add state text default 'complete',add result jsonb default '{}';
   create table icash_owner_contacts(account_id uuid,screening_id uuid,result jsonb);
   create schema icash_seller_agreement_private;
   create table icash_seller_agreement_private.inbound_bindings(session_id uuid primary key,account_id uuid,deal_id uuid,thread_id uuid);`);
  // Use the actual agreement context wrapper: call-only context must survive its
  // SMS gate without creating an invented thread or agreement binding.
  const agreement=read('config/seller-call-agreement.sql');
  await db.exec(agreement.slice(agreement.indexOf('alter table icash_recorded_reception_private.configs add column agreement_tool_id'),agreement.indexOf('-- Extend the exact current property resolver')));
  await db.exec(agreement.slice(agreement.indexOf('do $context$'),agreement.indexOf('alter function public.icash_recorded_reception_property_context')).replaceAll('public.icash_recorded_reception_property_context','public.icash_reception_context_before_agreement'));
  await db.exec(f.fn('config/seller-no-emd.sql','icash_recorded_reception_property_context').replace('public.icash_recorded_reception_property_context(','public.icash_reception_context_before_payoff('));
  await db.exec('create or replace function public.icash_recorded_reception_property_context(p_id uuid,p_nonce_hash text) returns jsonb language sql as $$select public.icash_reception_context_before_payoff(p_id,p_nonce_hash)$$;');
  await db.exec(read('config/receipt-only-seller-callbacks.sql'));
  const businessPhones=['+14154208230','+16195364770'];
  const receiptScenario=(name,run)=>scenario('receipt-only '+name,async source=>{
   await q('insert into icash_business_voice_numbers(phone,outbound_enabled,forwarding_ready) values($1,true,true),($2,true,true)',businessPhones);
   await q('insert into icash_text_senders values($1,false),($2,false)',businessPhones);
   await run(source);
   assert.deepEqual((await q('select enabled from icash_text_senders order by phone')).rows,[{enabled:false},{enabled:false}],'Callback handling never enables SMS');
  },{context_policy:'seller_agreement_v3',context_policy_hash:'b2f3791d6af9a3468684a65dd25427a8168dd604f4b1a0b28a7ee4ef5b06e1e8',agreement_tool_id:'tool_fixtureAgreement'});
  async function callProperty(n,{acc=customer,business=businessPhones[0],channel='AI',draft=true,receipt=true,party='seller',at="now()-interval '1 minute'",sid='CA'+'f'.repeat(32)}={}){
   const key=id(n);
   await q('insert into icash_screening_jobs(id,account_id,snapshot) values($1,$2,$3)',[key,acc,{propertyId:key,address:n+' Fixture Lane'}]);
   if(draft)await q("insert into icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$1,'draft',jsonb_build_object('address',$3::text))",[key,acc,n+' Fixture Lane']);
   if(receipt&&channel==='AI')await q(`insert into icash_call_recordings(account_id,screening_id,party,to_phone,from_phone,call_sid,dial_claimed_at) values($1,$2,$3,$4,$5,$6,${at})`,[acc,key,party,phone,business,sid]);
   if(receipt&&channel==='manual')await q(`insert into icash_customer_phone_calls(account_id,screening_id,recipient_phone,business_phone,child_sid,created_at) values($1,$2,$3,$4,$5,${at})`,[acc,key,phone,business,sid]);
   if(channel==='manual'){
    const lead=id(n+1000);await q("insert into icash_seller_intakes(id,name,phone,state,data_rights_until) values($1,'Synthetic seller',$2,'assigned',now()+interval '1 day')",[lead,phone]);
    await q('insert into icash_seller_matches values($1,$2,$3)',[lead,acc,key]);
   }
   return key;
  }
  async function startRecorded(c){
   const admitted=await reserve(c);assert(admitted.allowed,JSON.stringify(admitted));let r=admitted.session;
   assert.equal(await rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:r.nonce_hash}),null,'Context is unavailable before bound recording');
   for(const [action,payload] of [['claim_setup',{}],['bounded',boundPayload(r)],['bind_call_start',startPayload(r)],['authorize_recording',{nonceHash:r.nonce_hash,policy:'direct_recorded_v1'}],['claim_start',{}]]){r=await transition(r,action,payload);assert(r,action);}
   r=await transition(r,'started',{recordingSid:'RE'+'e'.repeat(32),providerStartedAt:r.recording_authorized_at});assert(r);return r;
  }
  for(const [channel,business] of [['AI',businessPhones[0]],['manual',businessPhones[1]]])for(const draft of [true,false])await receiptScenario(channel+' routes funded customer '+(draft?'with':'without')+' a draft while owner is paused and empty',async source=>{
   const screening=await callProperty(1,{channel,business,draft}),c=await resolve();assert.equal(c.account_id,customer);assert.equal(c.callback_template_id,source.id);assert.equal(c.config_hash,source.config_hash);assert.equal(c.rate_id,source.rate_id);
   for(const key of ['agent_id','branch_id','max_total_seconds','charge_cap_cents','context_policy','context_policy_hash'])assert.deepEqual(c[key],source[key],key+' retains exact approved template');
   assert.equal(c.reviewed_version_id,source.version_id);
   assert.equal(await val('select bot_paused from icash_accounts where id=$1',[account]),true);assert.equal(await val('select balance_cents from icash_wallets where account_id=$1',[account]),0);
   const r=await startRecorded(c);assert.equal(r.account_id,customer);assert.equal(r.callback_route.source,'call');assert.equal(r.callback_route.screeningId,screening);assert.equal(r.callback_route.businessNumber,business);assert.equal(r.callback_route.threadId??null,null);
   const context=await rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:r.nonce_hash});assert.deepEqual(context,{status:'matched',address:'1 Fixture Lane',callbackSource:'call'});assert.equal(context.smsContext,undefined,'No invented SMS context');
   assert.equal(await val('select count(*) from icash_seller_agreement_private.inbound_bindings'),0,'Call-only callback never invents agreement authority');
   assert.equal(await val('select count(*) from icash_text_threads'),0);assert.equal(await val('select count(*) from icash_text_messages'),0);
   assert.equal(await val('select balance_cents from icash_wallets where account_id=$1',[customer]),10000,'Admission holds rather than charges completed usage');
   assert.equal((await reserve(c)).reason,'duplicate_call');
   assert.equal(await rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:'f'.repeat(64)}),null,'Wrong context nonce is rejected');
   const registered=await transition(r,'claim_register');assert(registered);assert.equal(await rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:r.nonce_hash}),null,'Context remains restricted to its original setup stage');
   await q('update icash_recorded_reception_private.configs set enabled=false where id=$1',[source.id]);assert.equal(await rpc('icash_resolve_seller_callback_config',{p_called:c.called_number,p_id:c.id}),null,'Template disable blocks copied configuration');
  });
  for(const [label,options] of [
   ['unsent property',{receipt:false}],['unknown AI call',{sid:null}],['unknown manual child',{channel:'manual',sid:null}],['malformed AI SID',{sid:'untrusted'}],['malformed manual SID',{channel:'manual',sid:'untrusted'}],
   ['expired AI receipt',{at:"now()-interval '31 days'"}],['expired manual receipt',{channel:'manual',at:"now()-interval '31 days'"}],
   ['future AI receipt',{at:"now()+interval '1 day'"}],['missing AI claim time',{at:'null'}],['missing manual timestamp',{channel:'manual',at:'null'}],['buyer AI receipt',{party:'buyer'}],
  ])await receiptScenario(label+' does not identify a customer',async source=>{
   await callProperty(1,options);assert.equal((await resolve()).id,source.id);assert.equal(await val('select count(*) from icash_recorded_reception_private.configs where callback_template_id is not null'),0);assert.equal(await val('select count(*) from icash_operation_spend'),0);
  });
  for(const channel of ['AI','manual'])await receiptScenario(channel+' provider account mismatch holds the existing evidence',async()=>{
   await callProperty(1,{channel});await q('update '+(channel==='AI'?'icash_call_recordings':'icash_customer_phone_calls')+' set provider_account_sid=$1',['AC'+'c'.repeat(32)]);
   assert.equal(await resolve(),null);assert.equal(await val('select count(*) from icash_operation_spend'),0);
  });
  await receiptScenario('manual call without a seller source cannot be treated as seller evidence',async()=>{
   await callProperty(1,{channel:'manual'});await q('delete from icash_seller_matches');await q('delete from icash_seller_intakes');
   const result=await resolve();assert.notEqual(result?.account_id,customer);assert.equal(await val('select count(*) from icash_recorded_reception_private.configs where callback_template_id is not null'),0);
  });
  for(const source of ['owner contact','assigned seller intake'])await receiptScenario('manual '+source+' binds the actual seller role',async()=>{
   await callProperty(1,{channel:'manual'});await q('delete from icash_seller_matches');
   if(source==='owner contact'){
    await q('delete from icash_seller_intakes');await q('insert into icash_owner_contacts values($1,$2,$3)',[customer,id(1),{contacts:[{phones:[{number:'(212) 555-0199'}]}]}]);
   }else await q('update icash_seller_intakes set assigned_account=$1,screening_id=$2',[customer,id(1)]);
   const c=await resolve();assert.equal(c.account_id,customer);const admitted=await reserve(c);assert(admitted.allowed);assert.equal(admitted.session.callback_route.source,'call');
  });
  await receiptScenario('unknown manual role conflicts with an otherwise matched seller call',async()=>{
   await callProperty(1);await callProperty(2,{channel:'manual',business:businessPhones[1]});await q('delete from icash_seller_matches');await q('delete from icash_seller_intakes');
   assert.equal(await resolve(),null);assert.equal(await val('select count(*) from icash_operation_spend'),0);
  });
  await receiptScenario('canonical buyer call conflicts with an otherwise matched seller call',async()=>{
   await callProperty(1);await callProperty(2,{party:'buyer',business:businessPhones[1]});assert.equal(await resolve(),null);assert.equal(await val('select count(*) from icash_operation_spend'),0);
  });
  await receiptScenario('missing additional caller-ID receipt cannot identify a customer',async source=>{
   await callProperty(1);await q('update icash_call_recordings set caller_id_sid=null');assert.equal((await resolve()).id,source.id);assert.equal(await val('select count(*) from icash_operation_spend'),0);
  });
  await receiptScenario('conflicting provider-account receipts cannot be collapsed into one match',async()=>{
   await callProperty(1);await q("insert into icash_call_recordings select account_id,screening_id,party,to_phone,from_phone,'CA'||repeat('e',32),dial_claimed_at,'AC'||repeat('c',32),caller_id_sid from icash_call_recordings");assert.equal(await resolve(),null);assert.equal(await val('select count(*) from icash_operation_spend'),0);
  });
  for(const [label,sql,args] of [
   ['account Pause','update icash_accounts set bot_paused=true where id=$1',[customer]],
   ['zero wallet','update icash_wallets set balance_cents=0 where account_id=$1',[customer]],
   ['manual property','insert into icash_property_controls values($1,$2,true)',[customer,id(1)]],
   ['contact suppression',"insert into icash_contact_suppressions values(encode(sha256(convert_to($1,'UTF8')),'hex'))",[phone]],
   ['text opt-out',"insert into icash_text_suppressions(phone,reason) values($1,'synthetic opt out')",[phone]],
   ['webinar opt-out','insert into icash_webinar_phone_suppressions values($1)',[phone]],
   ['closed property',"update icash_deal_files set stage='closed' where id=$1",[id(1)]],
   ['voice forwarding revoked','update icash_business_voice_numbers set forwarding_ready=false',[]],
  ])await receiptScenario(label+' remains held without owner fallback or spend',async()=>{
   await callProperty(1);await q(sql,args);assert.equal(await resolve(),null);assert.equal(await val('select count(*) from icash_operation_spend'),0);
  });
  for(const [label,change] of [['paused','paused=true'],['retired','retired_at=now()'],['manual','manual_only=true']])await receiptScenario(label+' existing thread cannot be bypassed by a call-only candidate',async()=>{
   await property(1,customer,'call',businessPhones[0]);await q('update icash_text_threads set '+change);assert.equal(await resolve(),null);assert.equal(await val('select count(*) from icash_operation_spend'),0);
  });
  await receiptScenario('duplicate AI and manual receipts form one conversation',async()=>{
   await callProperty(1);await q("insert into icash_customer_phone_calls(account_id,screening_id,recipient_phone,business_phone,child_sid,created_at) values($1,$2,$3,$4,'CA'||repeat('e',32),now()-interval '30 seconds')",[customer,id(1),phone,businessPhones[0]]);
   await q('insert into icash_owner_contacts values($1,$2,$3)',[customer,id(1),{contacts:[{phones:[{number:phone}]}]}]);
   const c=await resolve(),a=await reserve(c);assert(a.allowed);assert.equal(a.session.callback_route.status,'matched');
  });
  for(const business of ['+14243948384','+17208134296'])await receiptScenario('legacy '+business+' seller thread supports a manual receipt without separate source records',async()=>{
   if(business!=='+14243948384')await q('insert into icash_business_voice_numbers(phone,outbound_enabled,forwarding_ready) values($1,true,true)',[business]);
   const thread=await property(1,customer,'draft',business);
   await q("insert into icash_customer_phone_calls(account_id,screening_id,recipient_phone,business_phone,child_sid,created_at) values($1,$2,$3,$4,'CA'||repeat('e',32),now()-interval '1 minute')",[customer,id(1),phone,business]);
   assert.equal(await val('select count(*) from icash_owner_contacts'),0);assert.equal(await val('select count(*) from icash_seller_intakes'),0);
   const c=await resolve();assert.equal(c.account_id,customer);const admitted=await reserve(c);assert(admitted.allowed);
   assert.equal(admitted.session.callback_route.threadId,thread);assert.equal(admitted.session.callback_route.source,undefined,'Existing seller-thread mode remains authoritative');
  });
  await receiptScenario('multiple properties ask for an address without choosing one',async()=>{
   await callProperty(1);await callProperty(2,{business:businessPhones[1],draft:false});const c=await resolve(),r=await startRecorded(c);assert.equal(r.callback_route.status,'ambiguous');assert.equal(r.callback_route.screeningId,undefined);
   assert.deepEqual(await rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:r.nonce_hash}),{status:'ambiguous'});
  });
  for(const oldThread of [false,true])await receiptScenario((oldThread?'old-number thread and new call':'two call-only accounts')+' cannot choose or charge an account',async()=>{
   await callProperty(1);await q('insert into auth.users values($1)',[id(90)]);await q("insert into icash_accounts(id,owner_user_id,assistant_name,bot_paused) values($1,$2,'Second customer',true)",[second,id(90)]);
   if(oldThread)await property(2,second);else await callProperty(2,{acc:second,business:businessPhones[1]});
   assert.equal(await resolve(),null);assert.equal(await val('select count(*) from icash_operation_spend'),0);
  });
  await receiptScenario('late route changes fail reserve and recording continuation',async()=>{
   await callProperty(1);const c=await resolve();await q('insert into icash_property_controls values($1,$2,true)',[customer,id(1)]);assert.equal((await reserve(c)).reason,'callback_route_changed');
   await q('delete from icash_property_controls');const r=await startRecorded(c);await q('update icash_call_recordings set from_phone=$1',[businessPhones[1]]);
   assert.equal(await rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:r.nonce_hash}),null,'Saved exact business identity cannot silently move');assert.equal(await transition(r,'claim_register'),null);
  });
  await receiptScenario('late matching text thread cannot spoof a saved call-only route',async()=>{
   await callProperty(1);const c=await resolve(),r=await startRecorded(c);
   await q("insert into icash_text_threads(id,account_id,deal_id,party,recipient,sender,paused,manual_only) values($1,$2,$1,'seller',$3,$4,false,false)",[id(1),customer,phone,businessPhones[0]]);
   assert.equal(await rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:r.nonce_hash}),null);assert.equal(await transition(r,'claim_register'),null);assert.equal(await val('select count(*) from icash_text_messages'),0);
  });
  await receiptScenario('late draft cannot silently change the saved no-draft tuple',async()=>{
   await callProperty(1,{draft:false});const c=await resolve(),r=await startRecorded(c);
   await q("insert into icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$1,'draft','{\"address\":\"1 Fixture Lane\"}')",[id(1),customer]);
   assert.equal(await rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:r.nonce_hash}),null);assert.equal(await transition(r,'claim_register'),null);
  });
  for(const role of ['anon','authenticated'])for(const name of ['manual_seller_source(uuid,uuid,text)','call_candidates(text,text)','call_role_conflict(text)','thread_candidates(text,text)','call_context(icash_recorded_reception_private.sessions)']){
   assert.equal(await val('select has_function_privilege($1,$2,\'execute\')',[role,'icash_callback_private.'+name]),false,'Private callback helper '+name+' denies '+role);
  }
 }
}
