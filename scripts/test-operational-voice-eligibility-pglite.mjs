// SIMULATION ONLY. Real SQL functions with synthetic evidence, no network/provider calls.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {databaseAdapter} from '../tests/helpers/simulated-journey-services.mjs';
import {settleBoundVoiceUsage} from '../lib/voice-usage-service.ts';
import {runOutboundBilling} from '../lib/outbound-billing-service.ts';
import {costCategories} from '../lib/cost-guard.ts';
import {createOperationalContactFixture} from '../tests/helpers/operational-contact-fixture.mjs';
const f=await createOperationalContactFixture(process.argv[2]);
const {pg,q,rpc,one,isolated,account,user,newOwner,other,phone,timezone,screening,source,dnc,prepare}=f;
try{
 await pg.exec(readFileSync(new URL('../config/outbound-billing-queue.sql',import.meta.url),'utf8'));
 const {db}=databaseAdapter(pg);
 await q('delete from icash_outreach_campaigns where account_id=$1',[account]); // Fixture selects voice channel, not SMS-to-inbound.
 const costs={dealmachine:0,elevenlabs:1000,twilio:0,messaging:0,email:0,llm:0,vercel:0,railway:0,supabase:0,github:0,payments:0,title_and_signing:0,support_and_overhead:0,acquisition:0,refund_and_dispute_reserve:0,other:0};
 const rate=(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) values('seller_call','SIMULATION operational voice',100,$1,'SIMULATION all components',now()-interval '1 minute',now()+interval '1 day',true,600) returning id",[costs])).id;
 await q("insert into icash_voice_configs(account_id,enabled,agent_id,phone_number_id,agent_config_hash,reviewed_until,seller_rate_id,max_duration_seconds,required_tool_ids) values($1,true,'agent_simulation','simulation-number',$2,now()+interval '1 day',$3,600,array['callback','handoff'])",[account,'b'.repeat(64),rate]);
 await q('set role service_role');
 assert.equal(await prepare(),2);
 await assert.rejects(q('update icash_dnc_verification_receipts set clear=true'),/permission denied/);
 await q('reset role');
 const op=await one("select * from icash_operational_contacts where account_id=$1 and channel='voice'",[account]);
 assert.equal(op.consent_verification,'not_performed');
 assert.equal((await one('select count(*)::int n from icash_contact_permissions')).n,0);
 assert.equal((await one('select count(*)::int n from icash_authority_review_requests')).n,0);
 assert.equal(await rpc('icash_operational_contact_current',{p_account:account,p_contact:op.id,p_channel:'voice',p_check_hour:true}),true);
 const now=(await one('select now() t')).t;

 for(const [sql,args] of [
  ['update icash_dnc_verification_sources set enabled=false where id=$1',[source]],
  ["update icash_dnc_verification_sources set expires_at=now()-interval '1 second' where id=$1",[source]],
  ['update icash_dnc_verification_receipts set clear=false where id=$1',[dnc]],
  ["update icash_dnc_verification_receipts set checked_at=now()+interval '1 minute' where id=$1",[dnc]],
  ["update icash_dnc_verification_receipts set checked_at=now()-interval '31 days' where id=$1",[dnc]],
  ['update icash_accounts set owner_user_id=$1 where id=$2',[newOwner,account]],
  ["update icash_customer_identities set company_name='Changed business' where account_id=$1",[account]],
  ["update icash_owner_contacts set result=jsonb_set(result,'{contacts,0,phones,0,doNotCall}','true') where screening_id=$1",[screening]],
  ["insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[phone]],
 ])await isolated(async()=>{await q(sql,args);assert.equal(await rpc('icash_operational_contact_current',{p_account:account,p_contact:op.id,p_channel:'voice',p_check_hour:true}),false,sql);});
 assert.equal(await rpc('icash_operational_contact_current',{p_account:other,p_contact:op.id,p_channel:'voice',p_check_hour:true}),false);
 assert.equal(await rpc('icash_operational_contact_current',{p_account:account,p_contact:op.id,p_channel:'sms',p_check_hour:true}),false);
 await rpc('icash_queue_voice_jobs',{});
 await rpc('icash_queue_voice_jobs',{});
 const job=await one('select * from icash_voice_jobs where account_id=$1',[account]);
 assert.equal(job.permission_id,null);assert.equal(job.operational_contact_id,op.id);
 await q("update icash_voice_jobs set state='issued' where id=$1",[job.id]);
 const reserve=()=>rpc('icash_reserve_paced_voice',{p_account:account,p_job:job.id,p_rate:rate,p_permission_until:op.eligibility_until,p_financial_checked_at:now,p_financial_eligible:true});
 assert.equal(await reserve(),true);
 const claim=()=>rpc('icash_claim_reviewed_voice_job',{p_job:job.id,p_offer_snapshot:null,p_buyer_snapshot:null});
 for(const [sql,args] of [
  ['update icash_dnc_verification_sources set enabled=false where id=$1',[source]],
  ["update icash_dnc_verification_receipts set revoked_at=now() where id=$1",[dnc]],
  ["insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP before claim')",[phone]],
  ['update icash_accounts set bot_paused=true where id=$1',[account]],
  ["insert into icash_property_controls(account_id,property_id,manual) values($1,'prop_1001',true)",[account]],
  ["update icash_voice_configs set enabled=false where account_id=$1",[account]],
 ])await isolated(async()=>{await q(sql,args);assert.equal(await claim(),false,sql);assert.equal((await one('select state from icash_voice_jobs where id=$1',[job.id])).state,'issued');});
 // Uncertain jobs from the new source remain in the mutual-exclusion check across tenants.
 await isolated(async()=>{
  const old=await one("select * from icash_operational_contacts where channel='sms' and account_id=$1",[account]);
  await assert.rejects(q("insert into icash_voice_jobs(account_id,operational_contact_id) values($1,$2)",[account,old.id]),/channel mismatch/);
 });
 await isolated(async()=>{await assert.rejects(q('update icash_voice_jobs set account_id=$1 where id=$2',[other,job.id]),/mismatch|immutable/);});
 await isolated(async()=>{await assert.rejects(q('update icash_operational_contacts set phone=$1 where id=$2',['+12145550124',op.id]),/immutable/);});
 // Final SQL boundaries for BOTH legacy and operational sources, after a real reserve.
 for(const hour of [8,9,17,18])for(const kind of ['legacy','operational'])await isolated(async()=>{
  const zone=(await one('select name from pg_timezone_names where extract(hour from now() at time zone name)=$1 limit 1',[hour])).name;
  let target;
  if(kind==='legacy')target=(await one("insert into icash_contact_permissions(account_id,screening_id,party,phone,contact_key,timezone,permission_evidence,permission_until,dnc_checked_at,dnc_clear) values($1,$2,'seller',$3,encode(sha256(convert_to($3,'UTF8')),'hex'),$4,'SIMULATION independently sourced legacy record',now()+interval '1 day',now(),true) returning id",[account,screening,phone,zone])).id;
  else{
   const receipt=(await one("insert into icash_dnc_verification_receipts(source_id,phone,contact_key,provider_reference,receipt_hash,checked_at,expires_at,clear,contact_timezone,timezone_source_reference) select source_id,phone,contact_key,'SIMULATION boundary '||$2,receipt_hash,checked_at,expires_at,clear,$3,timezone_source_reference from icash_dnc_verification_receipts where id=$1 returning id",[dnc,String(hour),zone])).id;
   target=(await one("insert into icash_operational_contacts(account_id,screening_id,channel,phone,contact_key,timezone,timezone_basis,local_start_hour,local_end_hour,owner_user_id,sending_principal,source_hash,dnc_receipt_id,eligibility_until) select account_id,screening_id,channel,phone,contact_key,$2,'source_record',9,18,owner_user_id,sending_principal,source_hash,$3,eligibility_until from icash_operational_contacts where id=$1 returning id",[op.id,zone,receipt])).id;
   assert.equal(await rpc('icash_operational_contact_current',{p_account:account,p_contact:target,p_channel:'voice',p_check_hour:false}),true);
  }
  const column=kind==='legacy'?'permission_id':'operational_contact_id';
  const boundary=(await one(`insert into icash_voice_jobs(account_id,${column},state) values($1,$2,'issued') returning id`,[account,target])).id;
  await rpc('icash_reserve_operation',{p_account:account,p_operation:'voice:'+boundary,p_rate:rate,p_permission_until:op.eligibility_until,p_financial_checked_at:now,p_financial_eligible:true});
  const allowed=await rpc('icash_claim_reviewed_voice_job',{p_job:boundary,p_offer_snapshot:null,p_buyer_snapshot:null});
  assert.equal(allowed,hour>=9&&hour<18,kind+' final voice hour '+hour);
 });
 assert.equal(await claim(),true);
 assert.equal(await claim(),false,'A successful final claim is one-use');
 assert.equal((await one('select state from icash_voice_jobs where id=$1',[job.id])).state,'dispatching');
 assert.equal((await one('select state from icash_operation_spend where operation_key=$1',['voice:'+job.id])).state,'dispatched');
 assert.equal((await one('select count(*)::int n from icash_contact_permissions')).n,0);
 // Complete the NORMAL operational job, queue it, collect authenticated provider
 // fixtures, persist its exact-number tariff snapshot, and use the actual financial settler.
 const conv='conv_operational',sid='CA'+'b'.repeat(32),ac='AC'+'a'.repeat(32),operation='voice:'+job.id;
 await q("update icash_voice_jobs set state='dispatched',provider_call_sid=$2,conversation_id=$3 where id=$1",[job.id,sid,conv]);
 const live=(await one("insert into icash_live_conversations(account_id,screening_id,party,agent_id,conversation_id,operation_key,contact_key,strategy_key) values($1,$2,'seller','agent_simulation',$3,$4,$5,'cash_interest') returning *",[account,screening,conv,operation,op.contact_key]));
 await rpc('icash_record_cost_observation',{p_provider:'elevenlabs',p_event:conv,p_source:operation,p_amount:0.001,p_units:'USD'});
 await rpc('icash_save_live_result',{p_call:live.id,p_result:{party:'seller',transcript:[],summary:'SIMULATION complete',durationSeconds:30,optedOut:false,humanRequested:false}});
 const policyTime=new Date(Date.now()-60000).toISOString(),until=new Date(Date.now()+86400000).toISOString();
 const carrier={kind:'outbound_carrier_estimate',evidenceRef:'SIMULATION reviewed carrier evidence',snapshotId:'SIMULATION snapshot v1',accountScope:'operation_owner',agentId:'agent_simulation',twilioAccountSid:ac,from:f.sender,reviewedAt:policyTime,validFrom:policyTime,validUntil:until,voice:{microsPerMinute:1000,rounding:'up',minimumMinutes:0},stream:{microsPerMinute:0,rounding:'exact',minimumMinutes:0,assumption:'SIMULATION zero stream allocation'},source:{kind:'twilio_pricing_api',allowedCountries:['US'],maxMicrosPerMinute:10000,policyVersion:'SIMULATION pricing policy',maxPricingLagSeconds:86400}};
 const policy={enabled:true,version:'SIMULATION settlement v1',rateId:rate,operation:'seller_call',reviewedAt:policyTime,validFrom:policyTime,validUntil:until,evidenceRef:'SIMULATION complete rate policy',components:Object.fromEntries(costCategories.filter(k=>k!=='elevenlabs').map(k=>[k,k==='twilio'?carrier:{kind:'fixed_estimate',amountMicros:0,evidenceRef:'SIMULATION explicit allocation'}]))};
 let providerReads=0;const fetcher=async(url,init)=>{assert.equal(init.method,'GET');providerReads++;if(url.startsWith('https://api.elevenlabs.io/'))return Response.json({conversation_id:conv,agent_id:'agent_simulation',status:'done',metadata:{phone_call:{call_sid:sid}}});if(url.startsWith('https://api.twilio.com/'))return Response.json({sid,account_sid:ac,to:phone,from:f.sender,direction:'outbound-api',status:'completed',duration:'30',end_time:new Date(Date.now()-1000).toISOString(),price:null});if(url.startsWith('https://pricing.twilio.com/'))return Response.json({destination_number:phone,origination_number:f.sender,price_unit:'USD',iso_country:'US',outbound_call_prices:[{current_price:'0.001000',origination_prefixes:['ALL']}]});throw Error('Unexpected fixture provider URL');};
 await q('set role service_role');
 const billing=await runOutboundBilling(true,db,async(a,c)=>({billing:await settleBoundVoiceUsage(db,a,c,[policy],{env:{TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'fixture-token',ELEVENLABS_API_KEY:'fixture-key'},fetcher})}));
 assert.equal(billing.status,'completed');assert.equal(billing.ledgerConfirmed,true);assert.equal(providerReads,3);
 assert.equal((await rpc('icash_get_outbound_usage_settlement',{p_account:account,p_call:live.id})).settled,true);
 assert.equal((await rpc('icash_get_outbound_usage_settlement',{p_account:other,p_call:live.id})),null);
 await q('reset role');
 const priceSnapshot=await one('select snapshot from icash_outbound_price_snapshots where operation_key=$1',[operation]);
 assert.equal(priceSnapshot.snapshot.destinationHash,op.contact_key);assert.equal(priceSnapshot.snapshot.callSid,sid);assert.equal(priceSnapshot.snapshot.conversationId,conv);
 const settled=await one('select * from icash_operation_spend where operation_key=$1',[operation]);
 assert.equal(settled.state,'settled');assert.equal(settled.charged_cents,Math.ceil((1000*settled.elevenlabs_cost_multiplier+1000*settled.standard_cost_multiplier)/10000));
 assert.equal((await one('select count(*)::int n from icash_credit_ledger where event_key=$1',['usage:'+operation])).n,1);
 assert.equal((await one('select count(*)::int n from icash_contact_permissions')).n,0);
 assert.equal((await runOutboundBilling(true,db,async()=>{throw Error('Must not collect twice')})).status,'idle');
 // A later legacy permission must not create a second first call after operational dispatch.
 await q("insert into icash_contact_permissions(account_id,screening_id,party,phone,contact_key,timezone,permission_evidence,permission_until,dnc_checked_at,dnc_clear) values($1,$2,'seller',$3,encode(sha256(convert_to($3,'UTF8')),'hex'),$4,'SIMULATION actual independent legacy record',now()+interval '1 day',now(),true)",[account,screening,phone,timezone]);
 await rpc('icash_queue_voice_jobs',{});
 assert.equal((await one('select count(*)::int n from icash_voice_jobs where account_id=$1',[account])).n,1,'Cross-source first-call deduplication');
 await q("insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION final STOP')",[phone]);
 assert.equal((await one('select revoked_at from icash_operational_contacts where id=$1',[op.id])).revoked_at!==null,true);
 assert.equal((await one('select state from icash_voice_jobs where id=$1',[job.id])).state,'dispatched','STOP does not pretend an already-dispatched provider call was canceled/refunded');
 console.log('PASS operational voice: actual DNC/source/account checks, separate FK/provenance, no fabricated permissions, pacing/inventory/spend/final claims, one-use, STOP, cross-source dedupe. No provider calls.');
}catch(e){console.error(e.message,e.where??'');process.exitCode=1;}finally{await pg.close();}
