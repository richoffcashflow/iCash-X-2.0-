// Offline PostgreSQL only. Real lifecycle/routing SQL, no provider or billing work.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {assertOwnerDemoRestartParity} from './helpers/owner-demo-restart-parity.mjs';
import {setupOwnerDemoRunFixture} from './helpers/owner-demo-run-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>(await q(s,a)).rows[0],val=async(s,a=[])=>Object.values(await one(s,a))[0];
const account='48dfb798-8c1a-404f-88c0-c396cc067062',owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',phone='+12142185280',sender='+17208134296',other=randomUUID();
const sql=read('config/owner-demo-run-lifecycle.sql');assertOwnerDemoRestartParity('owner-demo-run-lifecycle');
let scenarios=0;
const scenario=async(name,fn)=>{await pg.exec('begin');try{await fn();scenarios++;}catch(e){throw new Error(name+': '+e.message,{cause:e});}finally{await pg.exec('rollback');}};
const call=(name,a)=>val(`select ${name}(${a.map((_,i)=>'$'+(i+1)).join(',')})`,a);
const submit=async({request=randomUUID(),recipient=phone,a=account,actor=owner}={})=>{
 const args=[actor,a,request,'a'.repeat(64),'Fixture Owner','100 Test Lane, Dallas, TX 75201',recipient,true,'b'.repeat(64),'America/Chicago','c'.repeat(64)];
 return {id:await call('icash_submit_bot_demo_intake',args),request,args};
};
const assign=async(r,{a=account,recipient=phone}={})=>{
 const screen=randomUUID(),deal=randomUUID();
 await q("update icash_seller_intakes set state='assigned',assigned_account=$2,screening_id=$3,data_rights_until=now()+interval '1 day' where id=$1",[r.id,a,screen]);
 await q("insert into icash_screening_jobs(id,account_id,state,snapshot) values($1,$2,'complete','{\"propertyId\":\"fixture\"}')",[screen,a]);
 await q('insert into icash_seller_matches(lead_id,account_id,screening_id) values($1,$2,$3)',[r.id,a,screen]);
 await q("insert into icash_deal_files values($1,$2,$3,'draft','{\"address\":\"100 Test Lane, Dallas, TX 75201\"}')",[deal,a,screen]);
 await q("insert into icash_optin_call_requests values($1,$2,$3,$4,$5,'demo_form','icash-optin-call-now-2026-10-16.1','icash-optin-call-now-2026-10-16.1',now(),now()+interval '5 minutes')",[r.id,r.request,recipient,a,owner]);
 return {...r,screen,deal};
};
const activate=r=>call('icash_demo_run_private.activate',[account,r.id]);
const contacts=async r=>{
 const thread=randomUUID(),permission=randomUUID(),job=randomUUID();
 await q("insert into icash_contact_permissions(id,account_id,screening_id,seller_intake_id,phone,contact_key,party,permission_until) values($1,$2,$3,$4,$5,encode(sha256(convert_to($5,'UTF8')),'hex'),'seller',now()+interval '1 day')",[permission,account,r.screen,r.id,phone]);
 await q("insert into icash_text_threads(id,account_id,deal_id,seller_intake_id,sender,recipient,party,paused,manual_only,ai_mode) values($1,$2,$3,$4,$5,$6,'seller',false,false,'auto')",[thread,account,r.deal,r.id,sender,phone]);
 await q("insert into icash_voice_jobs(id,account_id,permission_id,state,created_at) values($1,$2,$3,'ready',now())",[job,account,permission]);
 await q("insert into icash_seller_responses values($1,$2,$3,'pending','fixture',now())",[r.id,account,r.screen]);
 return {...r,thread,permission,job};
};
const fresh=async()=>{const r=await assign(await submit());assert.equal(await activate(r),true);return contacts(r);};
const message=async(r,state='ready')=>{
 const id=randomUUID();await q("insert into icash_text_messages(id,thread_id,account_id,direction,state,provider_id,body,created_at) values($1,$2,$3,'outgoing',$4,$5,'Fixture only',now())",[id,r.thread,account,state,state==='delivered'?'provider-'+id:null]);return id;
};
const voice=async(r,{ended=false,settled=false,old=false}={})=>{
 const id=randomUUID(),sid='CA'+randomUUID().replaceAll('-','');
 await q("insert into icash_operation_spend(operation_key,account_id,state,settled_at) values($1,$2,$3,case when $4 then clock_timestamp() end)",['voice:'+r.job,account,settled?'settled':'dispatched',settled]);
 await q("insert into icash_call_recordings(id,account_id,voice_job_id,permission_id,screening_id,to_phone,from_phone,call_sid,provider_account_sid,dial_claimed_at,call_ended_at,operation_key) values($1,$2,$3,$4,$5,$6,$7,$8,'ACfixture',now()-interval '1 minute',case when $9 then case when $10 then now()-interval '1 minute' else clock_timestamp() end end,$11)",[id,account,r.job,r.permission,r.screen,phone,sender,sid,ended,old,'voice:'+r.job]);
 await q("update icash_voice_jobs set state='dispatched',operation_key=$2,provider_call_sid=$3 where id=$1",[r.job,'voice:'+r.job,sid]);
 return id;
};
const incoming=async(body,optout=false,id=randomUUID())=>{await call('icash_ingest_text_event_before_operational',[{id,type:'text.incoming.sms',data:{from:phone,to:sender,body}},optout]);return one('select * from icash_text_messages where event_id=$1',[id]);};
try{
 await setupOwnerDemoRunFixture({pg,account,owner,other,phone,sender});
 await pg.exec(sql);
 await scenario('exact retry and distinct requests',async()=>{
  const a=await submit();assert.equal(await call('icash_submit_bot_demo_intake',a.args),a.id);assert.equal(await val('select count(*) from icash_demo_run_private.runs'),1);
  await assert.rejects(call('icash_submit_bot_demo_intake',a.args.map((v,i)=>i===4?'Changed name':v)),/retry mismatch/); // transaction abort requires savepoint below
 });
 await scenario('more runs than sender pool without manual reset',async()=>{
  let prior;for(let i=0;i<8;i++){
   const r=await assign(await submit());assert.equal(await activate(r),true);
   if(prior){assert.equal(await val('select state from icash_screening_jobs where id=$1',[prior.screen]),'archived');assert.equal(await val('select state from icash_voice_jobs where id=$1',[prior.job]),'canceled');assert(await val('select revoked_at from icash_contact_permissions where id=$1',[prior.permission]));}
   prior=await contacts(r);await message(prior);assert.equal(await val('select count(*) from icash_text_threads where retired_at is null'),1);
  }
  assert.equal(await val('select count(distinct sender) from icash_text_threads'),1);assert.equal(await val('select count(*) from icash_demo_run_private.runs'),8);
 });
 await scenario('delivered old yes no and STOP stay unbound; current revision unchanged',async()=>{
  const a=await fresh(),oldMessage=await message(a,'delivered'),b=await fresh();const revision=await val('select revision from icash_sms_routes');
  // Make the latest-owner-question recovery otherwise capable of selecting the
  // new thread. A NULL quarantined message revision must stop it beforehand.
  await pg.exec(`create or replace function icash_sms_recent_owner_question(text,text,timestamptz default now()) returns jsonb language sql as $$select '{"accountId":"${account}","threadId":"${b.thread}","questionId":"${oldMessage}"}'::jsonb$$`);
  for(const text of ['yes','no','100 Test Lane','offer 100000']){const m=await incoming(text);assert.equal(m.thread_id,null);assert.equal(m.state,'needs_review');assert.equal(m.account_id,account);assert.equal(m.route_revision,null);assert.equal(await call('icash_resolve_recent_owner_reply',[account,m.id]),null);assert.equal(await call('icash_prepare_seller_text_event',[m.event_id]),null);assert.equal(await val('select thread_id from icash_text_messages where id=$1',[m.id]),null);}
  assert.equal(await val('select revision from icash_sms_routes'),revision);assert.equal(await val('select needs_review from icash_sms_routes'),false);
  const opBefore=await val('select count(*) from icash_operation_spend');await incoming('STOP',true);assert.equal(await val('select count(*) from icash_text_suppressions'),1);assert.equal(await val('select count(*) from icash_operation_spend'),opBefore);
  const event={id:randomUUID(),type:'text.delivery.confirmed',timestamp:Date.now()/1000,data:{message_id:'provider-'+oldMessage,from:sender,to:phone}};await call('icash_ingest_text_event_before_operational',[event,false]);
  assert.equal(await val('select thread_id from icash_text_messages where id=$1',[oldMessage]),a.thread);assert.equal(await val('select revision from icash_sms_routes'),revision);assert.equal(await val('select retired_at is null from icash_text_threads where id=$1',[b.thread]),true);
 });
 await scenario('ordinary foreign role ambiguity remains pair hold',async()=>{
  const a=await fresh();await message(a,'delivered');await fresh();
  await q("insert into icash_text_threads(id,account_id,sender,recipient,party,retired_at) values($1,$2,$3,$4,'buyer',now())",[randomUUID(),other,sender,phone]);
  assert.equal(await val('select icash_demo_run_private.isolated_pair($1,$2)',[sender,phone]),false);
  const revision=await val('select revision from icash_sms_routes');const m=await incoming('yes');assert.equal(m.thread_id,null);assert.equal(await val('select needs_review from icash_sms_routes'),true);assert.equal(await val('select revision from icash_sms_routes'),revision+1);
 });
 await scenario('active predecessor serializes then settled end allows original fresh receipt',async()=>{
  const a=await fresh(),record=await voice(a),b=await assign(await submit());assert.equal(await activate(b),false);assert.equal(await val('select retired_at from icash_text_threads where id=$1',[a.thread]),null);
  await q('update icash_call_recordings set call_ended_at=clock_timestamp() where id=$1',[record]);assert.equal(await activate(b),false,'post-request terminal but unsettled still waits');
  await q("update icash_operation_spend set state='settled',settled_at=clock_timestamp() where operation_key=$1",['voice:'+a.job]);assert.equal(await activate(b),true);const c=await contacts(b);
  const expiry=await val('select expires_at from icash_optin_call_requests where lead_id=$1',[b.id]);assert.equal(await call('icash_owner_demo_call_current',[account,c.job]),true);
  await q("insert into icash_customer_phone_calls(id,recipient_phone,state) values($1,$2,'dispatching')",[randomUUID(),phone]);assert.equal(await call('icash_owner_demo_call_current',[account,c.job]),false,'new competing active call rechecked after activation');assert.deepEqual(await val('select expires_at from icash_optin_call_requests where lead_id=$1',[b.id]),expiry);
 });
 await scenario('expired request cannot renew itself',async()=>{
  const a=await fresh(),b=await assign(await submit());await q("update icash_optin_call_requests set requested_at=now()-interval '6 minutes',expires_at=now()-interval '1 minute' where lead_id=$1",[b.id]);assert.equal(await activate(b),false);assert.equal(await val('select retired_at from icash_text_threads where id=$1',[a.thread]),null);
 });
 for(const kind of ['unknown-voice','unknown-text','active-ticket','active-ai','active-ai-ticket','active-signing','optout','wrong-owner','wrong-phone'])await scenario(kind,async()=>{
  const a=await fresh(),b=await assign(await submit());
  if(kind==='unknown-voice')await q("update icash_voice_jobs set state='held',outcome='provider_outcome_unknown_no_retry' where id=$1",[a.job]);
  if(kind==='unknown-text')await message(a,'dispatching');
  if(kind==='active-ticket')await q("insert into icash_automation_tickets(id,account_id,voice_job_id,state,expires_at) values($1,$2,$3,'issued',now()+interval '1 minute')",[randomUUID(),account,a.job]);
  if(kind==='active-ai')await q("insert into icash_text_ai_jobs(id,account_id,thread_id,state) values($1,$2,$3,'analyzing')",[randomUUID(),account,a.thread]);
  if(kind==='active-ai-ticket'){const ai=randomUUID();await q("insert into icash_text_ai_jobs(id,account_id,thread_id,state) values($1,$2,$3,'drafted')",[ai,account,a.thread]);await q("insert into icash_automation_tickets(id,account_id,text_ai_job_id,state,expires_at) values($1,$2,$3,'consumed',now()+interval '1 minute')",[randomUUID(),account,ai]);}
  if(kind==='active-signing')await q("insert into icash_signing_envelopes(id,account_id,deal_id,state) values($1,$2,$3,'creating')",[randomUUID(),account,a.deal]);
  if(kind==='optout')await q('insert into icash_text_suppressions(phone) values($1)',[phone]);
  if(kind==='wrong-owner')await q('update icash_accounts set owner_user_id=$2 where id=$1',[account,randomUUID()]);
  if(kind==='wrong-phone')await q("update icash_seller_intakes set phone='+12025550101' where id=$1",[b.id]);
  const result=await activate(b);if(!kind.startsWith('wrong'))assert.equal(result,false);assert.equal(await val('select retired_at from icash_text_threads where id=$1',[a.thread]),null);
 });
 await scenario('older request cannot reactivate superseded run; source histories immutable',async()=>{
  const a=await fresh(),saved=await one('select request_id,consent_text,consent_version,attribution from icash_seller_intakes where id=$1',[a.id]);const b=await fresh();assert.equal(await activate(a),false);assert.equal(await call('icash_submit_bot_demo_intake',a.args),a.id);assert.equal(await val('select count(*) from icash_demo_run_private.runs'),2);assert.deepEqual(await one('select request_id,consent_text,consent_version,attribution from icash_seller_intakes where id=$1',[a.id]),saved);assert.equal(await call('icash_owner_demo_call_current',[account,a.job]),false);assert.equal(await call('icash_owner_demo_call_current',[account,b.job]),true);
 });
 await scenario('historically terminal call keeps unresolved financial evidence unchanged',async()=>{
  const a=await fresh();await voice(a,{ended:true,old:true});const spend=await one('select * from icash_operation_spend');const b=await assign(await submit());assert.equal(await activate(b),true);assert.deepEqual(await one('select * from icash_operation_spend'),spend);
 });
 await scenario('actual current contact preparation across eight same-address runs',async()=>{
  let prior;for(let i=0;i<8;i++){
   const r=await assign(await submit());await call('icash_prepare_seller_contacts',[account,r.id,r.screen,r.deal]);
   const thread=await one('select * from icash_text_threads where seller_intake_id=$1',[r.id]);const permission=await one('select * from icash_contact_permissions where seller_intake_id=$1',[r.id]);assert(thread?.id);assert(permission?.id);assert.equal(thread.sender,sender);assert.equal(permission.seller_intake_id,r.id);
   if(prior)assert(await val('select retired_at from icash_text_threads where id=$1',[prior]));prior=thread.id;
  }
  assert.equal(await val('select count(*) from icash_text_threads where retired_at is null'),1);assert.equal(await val('select count(distinct sender) from icash_text_threads'),1);
 });
 await scenario('active buyer test retains actual current wrapper priority',async()=>{
  const a=await fresh();await message(a,'delivered');const b=await fresh(),buyer=randomUUID(),test=randomUUID();
  await q("insert into icash_text_threads(id,account_id,deal_id,sender,recipient,party,owner_buyer_test_id) values($1,$2,$3,$4,$5,'buyer',$6)",[buyer,account,b.deal,sender,phone,test]);
  await q("insert into icash_owner_buyer_tests values($1,$2,$3,$4,$5,now(),true)",[test,account,buyer,sender,phone]);
  await q("insert into icash_text_messages(id,thread_id,account_id,direction,state,provider_id,created_at) values($1,$2,$3,'outgoing','delivered',$4,now())",[randomUUID(),buyer,account,randomUUID()]);
  assert.equal((await incoming('yes')).thread_id,buyer);
 });
 await scenario('issued historical agreement remains intact while new demo starts',async()=>{
  const a=await fresh();await q("insert into icash_signing_envelopes(id,account_id,deal_id,state,provider_id,provider_evidence) values($1,$2,$3,'awaiting_counterparty',$4,'{\"status\":\"pending\"}')",[randomUUID(),account,a.deal,randomUUID()]);
  const before=await one('select * from icash_signing_envelopes');const b=await assign(await submit());assert.equal(await activate(b),true);assert.deepEqual(await one('select * from icash_signing_envelopes'),before);
  await q("update icash_signing_envelopes set state='completed',provider_evidence='{\"status\":\"completed\"}' where id=$1",[before.id]);assert.equal(await val('select deal_id from icash_signing_envelopes'),a.deal);assert.equal(await val('select state from icash_screening_jobs where id=$1',[a.screen]),'archived');assert.equal(await val('select state from icash_screening_jobs where id=$1',[b.screen]),'complete');
 });
 await scenario('completed signed demo preserves agreement and can restart',async()=>{
  const a=await fresh();await q("update icash_deal_files set stage='under_contract' where id=$1",[a.deal]);await q("insert into icash_signing_envelopes(id,account_id,deal_id,state,terms,provider_evidence) values($1,$2,$3,'completed','{\"priceCents\":12300}','{\"signed\":true}')",[randomUUID(),account,a.deal]);
  await q('update icash_signing_envelopes set provider_id=gen_random_uuid()');const before=await one('select * from icash_signing_envelopes'),deal=await one('select * from icash_deal_files where id=$1',[a.deal]);const b=await assign(await submit());assert.equal(await activate(b),true);assert.deepEqual(await one('select * from icash_signing_envelopes'),before);assert.deepEqual(await one('select * from icash_deal_files where id=$1',[a.deal]),deal);
 });
 await scenario('unique new address routes; repeated old address does not',async()=>{
  const a=await fresh();await message(a,'delivered');const b=await fresh();await q("update icash_deal_files set terms='{\"address\":\"200 New Street, Dallas, TX 75201\"}' where id=$1",[b.deal]);
  assert.equal((await incoming('yes')).thread_id,null);assert.equal((await incoming('100 Test Lane')).thread_id,null);assert.equal((await incoming('200 New Street')).thread_id,b.thread);
 });
 await scenario('predial row retains original unknown-recording fence',async()=>{
  const a=await fresh();await q("insert into icash_call_recordings(id,account_id,voice_job_id,to_phone,state) values($1,$2,$3,$4,'failed')",[randomUUID(),account,a.job,phone]);const b=await assign(await submit());assert.equal(await activate(b),false,'no invented terminal receipt or automatic replay');
 });
 for(const role of ['anon','authenticated'])for(const fn of ['source(uuid,uuid)','activate(uuid,uuid)','register(uuid,uuid,uuid,uuid)','current(uuid)','calls_settled(uuid,uuid)','isolated_pair(text,text)'])assert.equal(await val('select has_function_privilege($1,$2,\'execute\')',[role,'icash_demo_run_private.'+fn]),false);
 const def=await val("select pg_get_functiondef('public.icash_submit_bot_demo_intake(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text)'::regprocedure)");assert(def.indexOf('from public.icash_operating_budget')<def.indexOf('from public.icash_accounts'));assert(def.indexOf('return prior.id')<def.indexOf('icash_demo_run_private.register'));
 console.log(`PASS ${scenarios} offline demo lifecycle scenarios: exact retries, 8 fresh runs/one sender, retirement, source/owner/STOP isolation, active/unknown fences, original five-minute serial queue, late replies/webhooks, immutable history and private ACLs.`);
}catch(error){console.error(error.message);console.error(error.cause||error);process.exitCode=1;}finally{await pg.close();}
