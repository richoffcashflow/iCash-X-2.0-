// Offline synthetic calls only: actual installed predicates, gate and audit.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {installCarrierFollowupFixture,read,sources} from './helpers/carrier-answer-followup-fixture.mjs';
const pg=await PGlite.create(),q=(s,p=[])=>pg.query(s,p),val=async(s,p=[])=>Object.values((await q(s,p)).rows[0]??{})[0];
const account=randomUUID(),job=randomUUID(),contact=randomUUID(),recording=randomUUID(),screen=randomUUID(),rate=randomUUID();
const operation='voice:'+job,phone='+12145550123',sender='+17205550100',ac='AC'+'a'.repeat(32),call='CA'+'b'.repeat(32);
const categories=['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'];
let cases=0;
const scenario=async(name,fn)=>{await pg.exec('begin');try{await fn();cases++;console.log('PASS '+name);}catch(e){throw new Error(name+': '+e.message,{cause:e});}finally{await pg.exec('rollback');}};
const deny=async(fn,re=/permission denied|append only/)=>{await pg.exec('savepoint rejected');try{await assert.rejects(fn,re);}finally{await pg.exec('rollback to rejected;release rejected;');}};
const eligible=(j=job)=>val('select public.icash_unanswered_seller_call_current($1,$2)',[account,j]);
const queue=()=>val('select public.icash_queue_unanswered_seller_calls()');
const machine=(r=recording,a=account)=>val('select icash_recording_private.carrier_machine_followup($1,$2)',[a,r]);
const definition=s=>val('select pg_get_functiondef($1::regprocedure)',[s]);
const components=(marked=true,status='completed')=>Object.fromEntries(categories.map(k=>[k,{amountMicros:k==='twilio'&&status==='completed'?14000:k==='other'&&marked&&status==='completed'?7500:0,basis:['elevenlabs','llm'].includes(k)?'not_applicable':k==='other'&&marked&&status==='completed'?'estimated':'verified',evidenceRef:'Synthetic original AMD carrier fixture '+k,...(k==='other'?{subitems:{speechGatherMicros:0,recordingMicros:0,storageMicros:0,...(marked?{answerDetectionMicros:status==='completed'?7500:0}:{})}}:{})}]));
const receipt=(status='completed',extra={})=>({providerAccountSid:ac,callSid:call,fromPhone:sender,toPhone:phone,status,durationSeconds:status==='completed'?2:0,priceMicros:status==='completed'?14000:0,currency:'USD',speechGatherUsed:false,...extra});
const settle=(r=recording,j=job,p=receipt(),c=components())=>val('select public.icash_settle_unstarted_recorded_call($1,$2,$3,$4,$5,$6)',[r,account,'voice:'+j,p,c,'Synthetic original AMD carrier terminal receipt']);
async function seed({marked=true,reason='carrier_machine_detected',state='consent_pending'}={}){
 await q("update icash_seller_recovery_private.unanswered_policy set enabled=true,activated_at=now()-interval '12 hours'");
 await q('insert into icash_accounts(id,bot_paused) values($1,false)',[account]);
 await q('insert into icash_wallets(account_id,balance_cents,reserved_cents) values($1,1000,0)',[account]);
 await q("insert into icash_operational_contacts(id,account_id,screening_id,phone,contact_key,channel,eligibility_until) values($1,$2,$3,$4,'fixture-contact','voice',now()+interval '10 hours')",[contact,account,screen,phone]);
 await q('insert into fixture_eligibility values($1,$2,true)',[account,contact]);
 await q("insert into icash_voice_jobs(id,account_id,operational_contact_id,state,created_at) values($1,$2,$3,'dispatching',now()-interval '4 hours')",[job,account,contact]);
 await q("insert into icash_operation_spend(operation_key,account_id,state,standard_cost_multiplier,charge_cap_cents,rate_id) values($1,$2,'dispatched',1.6,100,$3)",[operation,account,rate]);
 await q("insert into icash_call_recordings(id,account_id,voice_job_id,screening_id,party,operation_key,to_phone,from_phone,contact_key,dial_claimed_at,call_sid,provider_account_sid,call_context,entry_policy,state,last_action,row_version,rate_id,charge_cap_cents) values($1,$2,$3,$4,'seller',$5,$6,$7,'fixture-contact',now()-interval '3 hours',$8,$9,$10,'direct_recorded_v1',$11,'bind_call',1,$12,100)",[recording,account,job,screen,operation,phone,sender,call,ac,marked?{answerPolicy:'carrier_amd_enable_v1'}:{},state,rate]);
 await q("update icash_call_recordings set state='failed',last_action='fail',last_error=$1,row_version=row_version+1 where id=$2",[reason,recording]);
}
async function secondAttempt({meta=false,lead=null,age='1 hour',recipient=phone,ck='fixture-contact'}={}){
 const j=randomUUID(),r=randomUUID(),sid='CA'+'c'.repeat(32);
 await q("insert into icash_voice_jobs(id,account_id,operational_contact_id,permission_id,meta_followup_lead_id,seller_followup_of,state,created_at) values($1,$2,$3,$4,$5,$6,'dispatching',now()-$7::interval)",[j,account,meta?null:contact,meta?rate:null,meta?lead:null,meta?null:job,age]);
 await q("insert into icash_operation_spend(operation_key,account_id,state,standard_cost_multiplier,charge_cap_cents,rate_id) values($1,$2,'dispatched',1.6,100,$3)",['voice:'+j,account,rate]);
 await q("insert into icash_call_recordings(id,account_id,voice_job_id,screening_id,party,operation_key,to_phone,from_phone,contact_key,dial_claimed_at,call_sid,provider_account_sid,call_context,entry_policy,state,last_action,row_version,rate_id,charge_cap_cents) values($1,$2,$3,$4,'seller',$5,$6,$7,$8,now()-$9::interval,$10,$11,'{\"answerPolicy\":\"carrier_amd_enable_v1\"}','direct_recorded_v1','consent_pending','bind_call',1,$12,100)",[r,account,j,screen,'voice:'+j,recipient,sender,ck,age,sid,ac,rate]);
 await q("update icash_call_recordings set state='failed',last_action='fail',last_error='carrier_machine_detected',row_version=row_version+1 where id=$1",[r]);
 assert.equal((await settle(r,j,receipt('completed',{callSid:sid,toPhone:recipient}))).settled,true);
 return{job:j,recording:r};
}
async function legacyCompatibility(phase){
 for(const status of ['no-answer','busy','completed'])await scenario(phase+' retains legacy terminal predicate '+status,async()=>{
  await seed({marked:false,reason:'ordinary_failure'});
  assert.equal((await settle(recording,job,receipt(status),components(false,status))).settled,true);
  assert.equal(await val('select state from icash_voice_jobs where id=$1',[job]),'held','legacy gate job state stays unchanged');
  // Exercise the existing predicate on the same dispatched terminal fixture in
  // both versions; this does not assert or change legacy gate requeue policy.
  await q("update icash_voice_jobs set state='dispatched' where id=$1",[job]);
  assert.equal(await eligible(),status!=='completed');
 });
 for(const evidence of ['no_response','automated_answer','seller_response'])await scenario(phase+' retains existing conversation evidence '+evidence,async()=>{
  await seed({marked:false,reason:'ordinary_failure'});
  await q("update icash_voice_jobs set state='dispatched',conversation_id='conv-legacy' where id=$1",[job]);
  await q("update icash_call_recordings set state='available',conversation_id='conv-legacy',call_ended_at=now()-interval '175 minutes',row_version=row_version+1 where id=$1",[recording]);
  await q("update icash_operation_spend set state='settled' where operation_key=$1",[operation]);
  await q("insert into icash_live_conversations(id,account_id,screening_id,party,operation_key,contact_key,conversation_id,state,completed_at,result) values($1,$2,$3,'seller',$4,'fixture-contact','conv-legacy','complete',now()-interval '175 minutes',$5)",[randomUUID(),account,screen,operation,{contactEvidence:evidence,transcript:[{role:'user',message:evidence==='seller_response'?'I own the property and want to sell it.':'...'}]}]);
  assert.equal(await eligible(),evidence!=='seller_response');
 });
}
try{
 await installCarrierFollowupFixture(pg);
 await legacyCompatibility('old');
 const patch=read('config/carrier-answer-followup.sql');
 const originalSources=await Promise.all([...sources.sources,sources.audit.function].map(async s=>({signature:s.signature,definition:await definition(s.signature)})));
 const policyBefore=await q('select to_jsonb(p) p from icash_seller_recovery_private.unanswered_policy p');
 await scenario('old completed machine gate stays held; migration does not backfill old fail evidence',async()=>{
  await seed();assert.equal((await settle()).settled,true);
  assert.equal(await val('select state from icash_voice_jobs where id=$1',[job]),'held');assert.equal(await eligible(),false);
  await pg.exec(patch.replace('\nbegin;\n','\n').replace(/commit;\n$/,''));
  assert.equal(await val("select failure_reason from icash_recording_private.events where recording_id=$1 and action='fail'",[recording]),null);
  assert.equal(await machine(),false);assert.equal(await eligible(),false);
 });
 for(const [name,drift] of [
  ['function source',async()=>pg.exec((await definition(sources.audit.function.signature)).replace('begin','begin\n -- drift'))],
  ['function access',()=>pg.exec('grant execute on function icash_recording_private.audit() to anon')],
  ['private table access',()=>pg.exec('grant select on icash_recording_private.events to service_role')],
  ['event layout',()=>pg.exec('alter table icash_recording_private.events add unexpected text')],
  ['immutable trigger',()=>pg.exec('drop trigger icash_recording_audit_immutable on icash_recording_private.events')],
  ['receipt immutable trigger',()=>pg.exec('drop trigger icash_recording_costs_immutable on icash_recording_private.terminal_cost_receipts')],
  ['disabled audit',()=>pg.exec('alter table public.icash_call_recordings disable trigger icash_recording_audit')],
 ]){
  await pg.exec('begin');await drift();await assert.rejects(()=>pg.exec(patch),/changed|prerequisite|contract|guard/i);await pg.exec('rollback');
  for(const s of originalSources)assert.equal(await definition(s.signature),s.definition);
 }
 const migrationName=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_carrier_answer_followup.sql'));
 assert(migrationName,'forward migration present');const migration=read('supabase/migrations/'+migrationName);
 assert(!/^\s*(?:begin|commit);/im.test(migration),'runner owns migration and ledger transaction');
 assert.equal(migration,patch.replace('\nbegin;\n','\n-- The migration runner owns the transaction and schema ledger.\n').replace(/commit;\n$/,''));
 await pg.exec('begin');await pg.exec(migration);await pg.exec('create table fixture_followup_ledger(version text)');
 await assert.rejects(()=>pg.exec('select 1/0'),/division by zero/);await pg.exec('rollback');
 assert.equal(await val("select to_regclass('fixture_followup_ledger')"),null);
 assert.equal(await val("select count(*)::int from pg_attribute where attrelid='icash_recording_private.events'::regclass and attname='failure_reason' and not attisdropped"),0);
 await pg.exec(patch);
 await legacyCompatibility('new');
 assert.deepEqual(await q('select to_jsonb(p) p from icash_seller_recovery_private.unanswered_policy p'),policyBefore,'installation never enables or changes existing routine');
 const patched=await Promise.all(originalSources.map(async s=>({signature:s.signature,definition:await definition(s.signature)})));
 await assert.rejects(()=>pg.exec(patch),/changed|prerequisite|contract|guard/i);await pg.exec('rollback');
 for(const s of patched)assert.equal(await definition(s.signature),s.definition);
 await scenario('future exact machine preserves one existing follow-up with no conversation or extra settlement',async()=>{
  await seed();assert.equal(await machine(),false,'unsettled original cannot qualify');assert.equal((await settle()).settled,true);
  assert.equal(await val('select state from icash_voice_jobs where id=$1',[job]),'dispatched');assert.equal(await machine(),true);assert.equal(await eligible(),true);
  assert.equal(await queue(),1);assert.equal(await queue(),0);assert.equal(await eligible(),false);
  assert.equal(await val('select count(*)::int from icash_live_conversations'),0);
  assert.equal(await machine(recording,randomUUID()),false,'other account cannot consume proof');
  await deny(()=>q('update icash_recording_private.terminal_cost_receipts set charged_cents=0'));
  await deny(()=>q('delete from icash_recording_private.terminal_cost_receipts'));
  await deny(()=>q('truncate icash_recording_private.terminal_cost_receipts'));
  assert.equal(await val('select count(*)::int from fixture_settlements'),1);assert.equal((await settle()).settled,true);assert.equal(await val('select count(*)::int from fixture_settlements'),1);
 });
 for(const options of [{marked:false},{reason:'carrier_fax_detected'},{reason:'carrier_answer_unconfirmed'},{reason:'ordinary_failure'},{state:'starting'}])await scenario('unrecognized original never enters follow-up '+JSON.stringify(options),async()=>{
  await seed(options);assert.equal((await settle(recording,job,receipt(),components(options.marked!==false))).settled,true);
  assert.equal(await machine(),false);assert.equal(await eligible(),false);assert.equal(await val('select state from icash_voice_jobs where id=$1',[job]),'held');
 });
 await scenario('reason survives delayed provider price retries and is append only',async()=>{
  await seed();await q("update icash_call_recordings set last_action='retry',last_error='carrier_price_pending',row_version=row_version+1 where id=$1",[recording]);
  assert.equal((await settle()).settled,true);assert.equal(await machine(),true);assert.equal(await eligible(),true);
  const events=(await q('select action,failure_reason from icash_recording_private.events where recording_id=$1 order by row_version',[recording])).rows;
  assert.equal(events.find(e=>e.action==='fail').failure_reason,'carrier_machine_detected');assert.equal(events.find(e=>e.action==='retry').failure_reason,null);
  for(const sql of ['update icash_recording_private.events set failure_reason=null','delete from icash_recording_private.events','truncate icash_recording_private.events'])await deny(()=>pg.exec(sql));
 });
 await scenario('late ordinary retry cannot manufacture original machine evidence',async()=>{
  await seed({reason:'ordinary_failure'});await q("update icash_call_recordings set last_action='retry',last_error='carrier_machine_detected',row_version=row_version+1 where id=$1",[recording]);
  assert.equal((await settle()).settled,true);assert.equal(await machine(),false);
 });
 for(const [name,change] of [
  ['Pause','update icash_accounts set bot_paused=true'],['funds','update icash_wallets set balance_cents=0'],
  ['expired contact',"update icash_operational_contacts set eligibility_until=now()-interval '1 minute'"],['revoked contact','update icash_operational_contacts set revoked_at=now()'],
  ['current eligibility','update fixture_eligibility set allowed=false'],['STOP',`insert into icash_text_suppressions values('${phone}')`],
  ['manual takeover',`insert into icash_property_controls values('${account}','${screen}',true)`],['SMS-only',`insert into icash_outreach_campaigns values('${account}','sms_inbound')`],
  ['2-hour wait',"update icash_call_recordings set dial_claimed_at=now()-interval '1 hour',row_version=row_version+1"],
  ['24-hour window',"update icash_call_recordings set dial_claimed_at=now()-interval '25 hours',row_version=row_version+1"],
  ['cutover',"update icash_seller_recovery_private.unanswered_policy set activated_at=now()-interval '1 hour'"],['disabled','update icash_seller_recovery_private.unanswered_policy set enabled=false'],
  ['later human call',`insert into icash_customer_phone_calls(recipient_phone,child_sid,created_at) values('${phone}','CAhuman',now())`],
  ['human callback',"insert into icash_seller_agreement_private.call_history values('fixture-contact','[{\"role\":\"user\",\"message\":\"I called you back.\"}]')"],
 ])for(const three of [false,true])await scenario('current '+(three?'three-touch':'two-touch')+' guard '+name,async()=>{
  await seed();await settle();if(three)await pg.exec('update icash_seller_recovery_private.unanswered_policy set three_touch_enabled=true');
  assert.equal(await eligible(),true);await pg.exec(change);
  if(three&&['24-hour window','cutover'].includes(name))assert.equal(await eligible(),true,'existing three-touch seven-day window retains original semantics');else assert.equal(await eligible(),false);
 });
 for(const [name,change] of [
  ['wrong receipt account',"update icash_recording_private.terminal_cost_receipts set receipt=jsonb_set(receipt,'{providerAccountSid}','\"ACwrong\"')"],
  ['wrong receipt sender',"update icash_recording_private.terminal_cost_receipts set receipt=jsonb_set(receipt,'{fromPhone}','\"+12145550199\"')"],
  ['wrong receipt recipient',"update icash_recording_private.terminal_cost_receipts set receipt=jsonb_set(receipt,'{toPhone}','\"+12145550199\"')"],
  ['wrong receipt call',"update icash_recording_private.terminal_cost_receipts set receipt=jsonb_set(receipt,'{callSid}','\"CAwrong\"')"],
  ['missing receipt','delete from icash_recording_private.terminal_cost_receipts'],['unsettled','update icash_operation_spend set state=\'dispatched\''],
  ['different policy',"update icash_call_recordings set call_context='{}',row_version=row_version+1"],
  ['started recording',"update icash_call_recordings set start_claimed_at=now(),row_version=row_version+1"],
  ['authorized recording',"update icash_call_recordings set recording_authorized_at=now(),row_version=row_version+1"],
  ['conversation binding',"update icash_call_recordings set conversation_id='conv-unexpected',row_version=row_version+1"],
  ['wrong AMD fee',"update icash_recording_private.terminal_cost_receipts set components=jsonb_set(components,'{other,subitems,answerDetectionMicros}','0')"],
  ['unverified carrier fee',"update icash_recording_private.terminal_cost_receipts set components=jsonb_set(components,'{twilio,basis}','\"estimated\"')"],
 ])await scenario('exact original machine proof rejects '+name,async()=>{
  await seed();await settle();assert.equal(await machine(),true);
  // Synthetic corruption only: production receipt updates/deletes are blocked by
  // the real immutable trigger separately asserted above. Restore via rollback.
  if(/^(update|delete from) icash_recording_private\.terminal_cost_receipts/.test(change))await pg.exec('alter table icash_recording_private.terminal_cost_receipts disable trigger icash_recording_costs_immutable');
  await pg.exec(change);assert.equal(await machine(),false);assert.equal(await eligible(),false);
 });
 await scenario('three-touch remains disabled until original policy enables it; finite second/third calls retained',async()=>{
  await seed();await settle();const second=await secondAttempt({age:'30 minutes'});
  assert.equal(await eligible(second.job),false);
  await pg.exec('update icash_seller_recovery_private.unanswered_policy set three_touch_enabled=true');assert.equal(await eligible(second.job),false,'existing two-hour wait');
  await q("update icash_call_recordings set dial_claimed_at=now()-interval '6 hours',row_version=row_version+1 where id=$1",[recording]);
  await q("update icash_call_recordings set dial_claimed_at=now()-interval '3 hours',row_version=row_version+1 where id=$1",[second.recording]);
  assert.equal(await eligible(second.job),true);assert.equal(await queue(),1);assert.equal(await queue(),0);
 });
 await scenario('Meta third-call exact original machine receipts retain existing policy, spacing and response checks',async()=>{
  await seed();const lead=randomUUID(),ck=await val("select encode(sha256(convert_to($1,'UTF8')),'hex')",[phone]);
  await q('insert into icash_contact_permissions(id,account_id,seller_intake_id,screening_id,phone) values($1,$2,$3,$4,$5)',[rate,account,lead,screen,phone]);
  await q("insert into icash_seller_intakes(id,phone,contact_consent_scope) values($1,$2,'seller_contact')",[lead,phone]);
  await q("insert into icash_meta_leads(lead_id,account_id,screening_id,voice_job_id,first_outreach_at) values($1,$2,$3,$4,now()-interval '30 hours')",[lead,account,screen,job]);
  await q('update icash_voice_jobs set operational_contact_id=null,permission_id=$1 where id=$2',[rate,job]);
  await q("update icash_call_recordings set contact_key=$1,dial_claimed_at=now()-interval '8 hours',row_version=row_version+1 where id=$2",[ck,recording]);await settle();
  await secondAttempt({meta:true,lead,age:'4 hours',ck});
  const meta=()=>val('select icash_seller_recovery_private.meta_third_call_current($1,null)',[lead]);
  assert.equal(await meta(),false);await pg.exec('update icash_seller_recovery_private.unanswered_policy set three_touch_enabled=true');assert.equal(await meta(),true);
  await q("insert into icash_customer_phone_calls(recipient_phone,child_sid,created_at) values($1,'CAhuman',now())",[phone]);assert.equal(await meta(),false);
 });
 for(const role of ['anon','authenticated','service_role','untrusted_test_role']){
  assert.equal(await val("select has_function_privilege($1,'icash_recording_private.carrier_machine_followup(uuid,uuid)','execute')",[role]),false);
  assert.equal(await val("select has_table_privilege($1,'icash_recording_private.events','select')",[role]),false);
 }
 console.log(`PASS carrier-answer follow-up: ${cases} scenarios; actual old/new audit, settlement, queue, two/three-touch and Meta predicates; immutable prospective proof, unchanged current authority and no replay.`);
}catch(e){console.error(e.message,e.where??'',e.cause?.message??'',e.cause?.where??'');process.exitCode=1;}finally{await pg.close();}
