// SIMULATION ONLY: isolated real PostgreSQL functions, synthetic source permissions.
// No customer data, production writes, payments, messages or calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {createJourneyDb} from '../tests/helpers/simulated-journey-db.mjs';
import {databaseAdapter} from '../tests/helpers/simulated-journey-services.mjs';
import {outreachCampaignPolicy} from '../lib/outreach-campaign.ts';
const flatPricing=false;
const {pg}=await createJourneyDb(process.argv[2]);
const {q,rpc}=databaseAdapter(pg);const one=async(s,p=[])=>{const r=await q(s,p);assert.equal(r.rows.length,1);return r.rows[0];};
try{
 for(const name of ['text-ai','market-expansion','seller-opener-experiments','seller-opener-delivery-order','seller-workflow-continuity','reply-signals','manual-handoff-replies','sms-inbound-campaign','sms-contact-intake'])await pg.exec(readFileSync(new URL('../config/'+name+'.sql',import.meta.url),'utf8'));
 if(flatPricing)await pg.exec(readFileSync(new URL('../config/sms-flat-customer-pricing.sql',import.meta.url),'utf8'));
 console.log('SIMULATION schema loaded');
 const user=randomUUID(),account=randomUUID(),otherUser=randomUUID(),other=randomUUID();
 await q('insert into auth.users(id,email) values($1,$2),($3,$4)',[user,'campaign@example.invalid',otherUser,'other@example.invalid']);
 await q("insert into icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values($1,$2,'Fixture',false,100000),($3,$4,'Other Fixture',false,100000)",[account,user,other,otherUser]);
 await q("insert into icash_wallets(account_id,balance_cents,reserved_cents,currency) values($1,100000,0,'USD'),($2,100000,0,'USD')",[account,other]);
 await q("insert into icash_customer_identities(account_id,first_name,last_name,company_name,voice_id,voice_name) values($1,'SIMULATION','Owner','SIMULATION buying business','fixture_voice','Fixture')",[account]);
 const check=await rpc('icash_sms_inbound_campaign_status',{p_account:account,p_user:user});assert.equal(check.configured,false);
 await assert.rejects(rpc('icash_record_sms_inbound_campaign',{p_account:account,p_user:otherUser,p_version:outreachCampaignPolicy.version,p_accepted:true}),/ownership/);
 await assert.rejects(rpc('icash_record_sms_inbound_campaign',{p_account:account,p_user:user,p_version:'old',p_accepted:true}),/acknowledgment/);
 await assert.rejects(rpc('icash_record_sms_inbound_campaign',{p_account:account,p_user:user,p_version:outreachCampaignPolicy.version,p_accepted:false}),/acknowledgment/);
 const accepted=await rpc('icash_record_sms_inbound_campaign',{p_account:account,p_user:user,p_version:outreachCampaignPolicy.version,p_accepted:true});assert.equal(accepted.configured,true);
 assert.deepEqual(await rpc('icash_record_sms_inbound_campaign',{p_account:account,p_user:user,p_version:outreachCampaignPolicy.version,p_accepted:true}),accepted);
 const ack=await one('select * from icash_campaign_acknowledgments where account_id=$1',[account]);assert.equal(ack.policy_text,outreachCampaignPolicy.text);
 await assert.rejects(q('update icash_campaign_acknowledgments set policy_text=$1 where id=$2',['changed',ack.id]),/Append-only/);
 assert.equal((await one('select count(*)::int n from icash_contact_permissions')).n,0);
 assert.equal(accepted.released,false);
 await q("update icash_outreach_campaigns set enabled=true,reviewed_principal='SIMULATION buying business' where account_id=$1",[account]); // SIMULATION operator release, never customer attestation.
 console.log('SIMULATION acknowledgment: explicit, owner/version bound, immutable, idempotent; no recipient permission created');
 const costs={dealmachine:0,elevenlabs:0,twilio:0,messaging:1000,email:0,llm:0,vercel:0,railway:0,supabase:0,github:0,payments:0,title_and_signing:0,support_and_overhead:0,acquisition:0,refund_and_dispute_reserve:0,other:0};
 if(flatPricing){costs.messaging=10000;costs.llm=20000;await q("update icash_communication_prices set customer_micros=100000 where operation='sms_segment'");}
 const sms=(await one(flatPricing?"insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,buffer_bps,flat_customer_price_cents) values('sms_send','SIMULATION flat SMS',10,$1,'SIMULATION owner flat 10 cents; cost 3 cents',now()-interval '1 minute',now()+interval '1 day',true,2000,10) returning id":"insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) values('sms_send','SIMULATION SMS',10,$1,'SIMULATION permitted pricing',now()-interval '1 minute',now()+interval '1 day',true) returning id",[costs])).id;
 if(flatPricing){
  assert.equal(await rpc('icash_sms_intake_rate_current',{p_rate:sms}),true);
  const copy=async(cost,override,operation='sms_send',charge=10)=>(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,buffer_bps,flat_customer_price_cents) values($1,$2,$3,$4,'SIMULATION pricing boundary',now()-interval '1 minute',now()+interval '1 day',true,2000,$5) returning id",[operation,randomUUID(),charge,cost,override])).id;
  const standard=await copy(costs,null);assert.equal(await rpc('icash_sms_intake_rate_current',{p_rate:standard}),false,'10c cannot silently pass original 5x policy');await q('update icash_operation_rates set enabled=false where id=$1',[standard]);
  for(const bad of [{...costs,llm:80000},{...costs,llm:null}]){const id=await copy(bad,10);assert.equal(await rpc('icash_sms_intake_rate_current',{p_rate:id}),false);await q('update icash_operation_rates set enabled=false where id=$1',[id]);}
  await assert.rejects(copy(costs,10,'incoming_call'),/constraint/);
  await assert.rejects(copy(costs,9),/constraint/);
  await q('begin');try{await assert.rejects(q('update icash_operation_rates set flat_customer_price_cents=null where id=$1',[sms]),/new rate version/);}finally{await q('rollback');}
 }
 const incoming=(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) values('incoming_call','SIMULATION incoming',100,$1,'SIMULATION incoming pricing',now()-interval '1 minute',now()+interval '1 day',true,600) returning id",[{...costs,messaging:0,elevenlabs:100000}])).id;
 const expiredRate=async id=>(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) select operation,version||' expired',charge_cents,costs_micros,evidence_ref,now()-interval '1 day',now()-interval '1 second',true,voice_max_duration_seconds from icash_operation_rates where id=$1 returning id",[id])).id;
 const expiredSms=await expiredRate(sms),expiredIncoming=await expiredRate(incoming);
 await q("update icash_operating_budget set enabled=true,funded_micros=1000000000,protected_micros=0,reserved_micros=0,spent_micros=0,daily_limit_micros=null where id=1");
 const phone='+12145550123',sender='+14243948384',called='+17816093521',hash='a'.repeat(64);
 const timezone=(await one("select name from pg_timezone_names where extract(hour from now() at time zone name)=12 limit 1")).name;
 const screening=(await one("insert into icash_screening_jobs(account_id,event_key,snapshot,state,result,completed_at) values($1,'SIMULATION SMS property','{\"propertyId\":\"prop_1001\"}','complete','{\"financialCheck\":{\"status\":\"eligible\"}}',now()) returning id",[account])).id;
 const deal=(await one("insert into icash_deal_files(account_id,screening_id,stage,terms) values($1,$2,'draft','{\"address\":\"SIMULATION ONLY\",\"practice\":false,\"state\":\"TX\"}') returning id",[account,screening])).id;

 // Synthetic evidence only. The new production writer, not a fixture thread INSERT, creates the thread.
 const reviewer=randomUUID();await q('insert into auth.users(id,email) values($1,$2)',[reviewer,'reviewer@example.invalid']);
 await q("insert into icash_trusted_operators(user_id,scopes,provisioned_by,expires_at) values($1,array['authority_review'],'SIMULATION authorization only',now()+interval '1 day')",[reviewer]);
 const market=(await one("insert into icash_authority_market_reviews(account_id,screening_id,state_code,kind,channel,source_reference,reviewed_by,reviewed_at,expires_at) values($1,$2,'TX','contact_permission','sms','SIMULATION channel review','Fixture legal review',now()-interval '1 minute',now()+interval '1 day') returning id",[account,screening])).id;
 const source=(await one("insert into icash_dnc_verification_sources(name,source_reference,enabled,expires_at) values('SIMULATION DNC','SIMULATION external source',true,now()+interval '1 day') returning id")).id;
 const dnc=(await one("insert into icash_dnc_verification_receipts(source_id,phone,contact_key,provider_reference,receipt_hash,checked_at,expires_at,clear) values($1,$2,encode(sha256(convert_to($2,'UTF8')),'hex'),'SIMULATION receipt','"+'a'.repeat(64)+"',now()-interval '1 minute',now()+interval '1 day',true) returning id",[source,phone])).id;
 const payload={kind:'contact_permission',channel:'sms',screeningId:screening,party:'seller',buyerId:null,phone,timezone,localStartHour:9,localEndHour:20,stateCode:'TX',purpose:'SIMULATION SMS property inquiry',sourceName:'SIMULATION explicit recipient source',evidenceReference:'SIMULATION actual business SMS permission',evidenceObservedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()};
 const key=randomUUID();const submit=()=>rpc('icash_submit_authority_review',{p_account:account,p_user:user,p_key:key,p_payload:payload});
 const request=await submit();assert.equal((await submit()).id,request.id);assert.equal(request.payload.sendingPrincipal,'SIMULATION buying business');assert.equal(request.payload.dealId,deal);
 await assert.rejects(rpc('icash_submit_authority_review',{p_account:account,p_user:otherUser,p_key:randomUUID(),p_payload:payload}),/ownership/i);
 const verification={marketReviewId:market,reviewReference:'SIMULATION dated reviewer evidence',reviewedAt:new Date().toISOString(),validUntil:payload.expiresAt,consentReference:'SIMULATION verified recipient SMS permission',consentObservedAt:payload.evidenceObservedAt,dncReceiptId:dnc,smsSender:sender,smsConsentConfirmed:true,smsConsentBusiness:'SIMULATION buying business',smsPriorContactReference:'SIMULATION existing business contact'};
 const approve=(v=verification,actor=reviewer)=>rpc('icash_decide_authority_review',{p_reviewer:actor,p_request:request.id,p_decision:'approved',p_note:'SIMULATION genuine evidence reviewed',p_verification:v});
 await assert.rejects(approve(verification,otherUser),/operator/i);
 for(const v of [{...verification,smsConsentConfirmed:false},{...verification,smsConsentBusiness:'Wrong business'},{...verification,smsPriorContactReference:''},{...verification,dncReceiptId:randomUUID()},{...verification,smsSender:'+12145550129'}])await assert.rejects(approve(v));
 assert.equal((await one('select count(*)::int n from icash_text_threads')).n,0,'Rejected reviews create no threads');

 for(const [sql,args] of [
  ['update icash_dnc_verification_receipts set clear=false where id=$1',[dnc]],
  ['update icash_dnc_verification_sources set enabled=false where id=$1',[source]],
  ["update icash_authority_market_reviews set channel='voice' where id=$1",[market]],
  ['update icash_operation_rates set enabled=false where id=$1',[sms]],
  ["insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[phone]],
 ]){await q('begin');try{await q(sql,args);await assert.rejects(approve(),undefined,sql);}finally{await q('rollback');}}
 await q('begin');try{await assert.rejects(q('update icash_operation_rates set charge_cents=charge_cents+1 where id=$1',[sms]),/new rate version/i);}finally{await q('rollback');}
 const approved=await approve();assert.equal((await approve()).id,approved.id);
 await assert.rejects(approve({...verification,consentReference:'Conflicting second source'}),/Conflicting/);
 const created=await one('select * from icash_text_threads where account_id=$1',[account]);const thread=created.id;
 const apply=async name=>pg.exec(readFileSync(new URL('../config/'+name+'.sql',import.meta.url),'utf8'));
 const isolated=async action=>{await q('begin');try{return await action();}finally{await q('rollback');}};
 await rpc('icash_set_work_control',{p_user:user,p_account:account,p_action:'resume',p_screening:null});
 assert.equal((await one('select paused from icash_text_threads where id=$1',[thread])).paused,false);

 // Real prepare-deal RPC reproduces erasure; no browser/provider transport is used.
 const practiceScreen=(await one("insert into icash_screening_jobs(account_id,event_key,snapshot,state,result,completed_at) values($1,'SIMULATION practice preservation','{\"propertyId\":\"prop_1099\"}','complete','{}',now()) returning id",[account])).id;
 const practiceDeal=(await one("insert into icash_deal_files(account_id,screening_id,terms) values($1,$2,'{\"practice\":true,\"provenance\":{\"source\":\"synthetic\"},\"seller\":\"Fixture\"}') returning id",[account,practiceScreen])).id;
 const savePractice=terms=>rpc('icash_prepare_deal',{p_account:account,p_screening:practiceScreen,p_terms:terms});
 await isolated(async()=>{await savePractice({seller:'Updated fixture'});assert.equal((await one('select terms from icash_deal_files where id=$1',[practiceDeal])).terms.practice,undefined);});
 console.log('BASELINE reproduced: existing practice/provenance erased by supported deal-save RPC.');
 await apply('deal-term-provenance');
 await isolated(async()=>{
  await savePractice({seller:'Updated fixture'});
  assert.deepEqual((await one('select terms from icash_deal_files where id=$1',[practiceDeal])).terms,{seller:'Updated fixture',practice:true,provenance:{source:'synthetic'}});
  await savePractice({seller:'Updated again',practice:true,provenance:{source:'synthetic'}});
  assert.equal((await one('select terms from icash_deal_files where id=$1',[practiceDeal])).terms.practice,true);
 });
 for(const terms of [{seller:'Fixture',practice:false},{seller:'Fixture',practice:null},{seller:'Fixture',provenance:{source:'real'}},{seller:'Fixture',newProvenance:'fake'}])await assert.rejects(savePractice(terms),/provenance/);
 await assert.rejects(rpc('icash_prepare_deal',{p_account:other,p_screening:practiceScreen,p_terms:{seller:'Other'}}),/property missing/);
 await isolated(async()=>{await q("update icash_deal_files set stage='closed' where id=$1",[practiceDeal]);await assert.rejects(savePractice({seller:'Amended'}),/amendment/);});
 // Editing a real deal does not add a practice marker or erase a stored false marker.
 await isolated(async()=>{await rpc('icash_prepare_deal',{p_account:account,p_screening:screening,p_terms:{seller:'Real fixture',state:'TX'}});assert.equal((await one('select terms from icash_deal_files where id=$1',[deal])).terms.practice,false);});
 console.log('FIXED provenance: omission preserved, explicit promotion/new metadata rejected, tenant and closed-deal guards retained.');

 const openerArgs={p_account:account,p_thread:thread};
 const claim=id=>rpc('icash_claim_text',{p_account:account,p_message:id,p_sender:sender});
 await q('insert into icash_inbound_voice_routes(called_number,business_number,agent_id,rate_id,max_duration_seconds,enabled,reviewed_until,agent_config_hash) values($1,$2,$3,$4,600,true,now()+interval \'1 day\',$5)',[called,sender,'agent_fixture',incoming,hash]);
 async function humanReply({before=false,mutate=null,expected=true,signal='I want a real person'}={}){
  return isolated(async()=>{
   const opener=await rpc('icash_queue_seller_opener',openerArgs);assert(opener);assert(await claim(opener));
   await rpc('icash_accept_text',{p_account:account,p_message:opener,p_provider:'SIMULATION opener receipt'});
   await rpc('icash_ingest_text_event',{p_event:{id:'SIMULATION human request',type:'text.incoming.sms',timestamp:Date.now()/1000,data:{from:phone,to:sender,body:signal,message_id:'SIMULATION incoming human'}},p_optout:false});
   const incomingMessage=(await one("select id from icash_text_messages where thread_id=$1 and direction='incoming'",[thread])).id;
   assert.equal(await rpc('icash_manual_handoff_reply',{p_account:account,p_thread:thread}),true);
   assert.equal((await one("select manual from icash_property_controls where account_id=$1 and property_id='prop_1001'",[account])).manual,true);
   const reply=await rpc('icash_queue_text',{p_account:account,p_thread:thread,p_key:randomUUID(),p_body:'I can help. What would you like to discuss?',p_assets:'{}'});
   if(mutate)await mutate({reply,incomingMessage,opener});
   const result=await claim(reply);
   if(before||!expected)assert.equal(result,null);else{assert(result);assert.equal(await claim(reply),null,'Manual reply has exactly one funded claim');}
   assert.equal((await one("select count(*)::int n from icash_operation_spend where operation_key=$1",['text:'+reply])).n,before||!expected?0:1);
  });
 }
 await humanReply({before:true});
 console.log('BASELINE reproduced: permitted human reply is rejected by outer campaign manual-control gate.');
 await apply('sms-manual-reply-continuity');
 await humanReply();await humanReply({signal:'Can you call me?'});
 for(const mutate of [
  async()=>q('update icash_accounts set bot_paused=true where id=$1',[account]),
  async()=>q('update icash_outreach_campaigns set enabled=false where account_id=$1',[account]),
  async()=>q("insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[phone]),
  async()=>q("update icash_text_threads set permission_until=now()-interval '1 second' where id=$1",[thread]),
  async()=>q('update icash_operation_rates set enabled=false where id=$1',[sms]),
  async()=>q("update icash_screening_jobs set completed_at=now()-interval '2 days' where id=$1",[screening]),
  async({reply})=>q('update icash_seller_opener_assignments set message_id=$1 where thread_id=$2',[reply,thread]),
  async({reply,incomingMessage})=>q("insert into icash_text_ai_jobs(account_id,thread_id,message_id,state,outgoing_id) values($1,$2,$3,'queued',$4)",[account,thread,incomingMessage,reply]),
  async({reply,incomingMessage,opener})=>q("insert into icash_sms_inbound_invitations(account_id,thread_id,deal_id,screening_id,opener_id,reply_id,message_id,called_number,sender,recipient,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '1 hour')",[account,thread,deal,screening,opener,incomingMessage,reply,called,sender,phone]),
 ])await humanReply({mutate,expected:false});
 await humanReply({mutate:async({reply})=>assert.equal(await rpc('icash_claim_text',{p_account:other,p_message:reply,p_sender:sender}),null)});
 await isolated(async()=>{
  const message=await rpc('icash_queue_text',{p_account:account,p_thread:thread,p_key:randomUUID(),p_body:'No human request exists.',p_assets:'{}'});
  await q("insert into icash_property_controls(account_id,property_id,manual) values($1,'prop_1001',true)",[account]);
  assert.equal(await claim(message),null,'Ordinary takeover is not a manual-handoff permission');
 });
 console.log('FIXED manual reply: human/callback replies funded once; pause, release, STOP, expired permission/rate/screening, other tenant and automatic messages held.');

 async function unsentOpener(){
  const message=await rpc('icash_queue_seller_opener',openerArgs);assert(message);
  const previous=await one("insert into icash_automation_tickets(account_id,kind,opener_message_id,state,outcome,issue_attempts,created_at,expires_at,completed_at) values($1,'seller_opener',$2,'held','message_held',1,now()-interval '20 minutes',now()-interval '18 minutes',now()-interval '19 minutes') returning *",[account,message]);
  return {message,previous};
 }
 await isolated(async()=>{await unsentOpener();assert.equal(await rpc('icash_next_automation'),null);});
 console.log('BASELINE reproduced: original ready opener has no new ticket after pre-dispatch hold.');
 await apply('sms-opener-unstarted-recovery');
 await isolated(async()=>{
  const {message,previous}=await unsentOpener();
  const capability=await rpc('icash_next_automation');assert(capability?.token);
  const next=await one('select * from icash_automation_tickets where token=$1',[capability.token]);
  assert.notEqual(next.id,previous.id);assert.notEqual(next.token,previous.token);assert.equal(next.opener_message_id,message);assert.equal(next.issue_attempts,2);
  assert.deepEqual(await one('select * from icash_automation_tickets where id=$1',[previous.id]),previous,'Old capability record remains unchanged');
  assert.equal((await one('select state,provider_id from icash_text_messages where id=$1',[message])).state,'ready');
  assert.equal((await one("select count(*)::int n from icash_operation_spend where operation_key=$1",['text:'+message])).n,0);
  assert.equal(await rpc('icash_next_automation'),null,'One new active capability only');
  await q("update icash_automation_tickets set state='held',outcome='message_held',created_at=now()-interval '10 minutes',expires_at=now()-interval '8 minutes',completed_at=now()-interval '9 minutes' where id=$1",[next.id]);
  const last=await rpc('icash_next_automation');assert(last?.token);
  assert.equal((await one('select issue_attempts from icash_automation_tickets where token=$1',[last.token])).issue_attempts,3);
  await q("update icash_automation_tickets set state='held',outcome='message_held',created_at=now()-interval '5 minutes',expires_at=now()-interval '3 minutes',completed_at=now()-interval '4 minutes' where token=$1",[last.token]);
  assert.equal(await rpc('icash_next_automation'),null,'Three attempts is the hard cap');
 });
 await isolated(async()=>{
  const {previous}=await unsentOpener();await q("update icash_automation_tickets set state='issued',outcome=null,completed_at=null where id=$1",[previous.id]);
  assert((await rpc('icash_next_automation'))?.token,'Expired unconsumed capability can be replaced');
 });
 for(const mutate of [
  async({previous})=>q("update icash_automation_tickets set state='consumed',outcome=null where id=$1",[previous.id]),
  async({previous})=>q("update icash_automation_tickets set outcome='held_for_reconciliation' where id=$1",[previous.id]),
  async({previous})=>q("update icash_automation_tickets set outcome='message_delivery_needs_review' where id=$1",[previous.id]),
  async({message})=>q("update icash_text_messages set state='dispatching' where id=$1",[message]),
  async({message})=>q("update icash_text_messages set state='needs_review' where id=$1",[message]),
  async({message})=>q("update icash_text_messages set provider_id='SIMULATION uncertain receipt' where id=$1",[message]),
  async({message})=>rpc('icash_reserve_operation',{p_account:account,p_operation:'text:'+message,p_rate:sms,p_permission_until:payload.expiresAt}),
  async()=>q('update icash_accounts set bot_paused=true where id=$1',[account]),
  async()=>q('update icash_outreach_campaigns set enabled=false where account_id=$1',[account]),
  async()=>q('update icash_operation_rates set enabled=false where id=$1',[sms]),
  async()=>q("update icash_text_threads set permission_until=now()-interval '1 second' where id=$1",[thread]),
  async()=>q("update icash_screening_jobs set completed_at=now()-interval '2 days' where id=$1",[screening]),
  async()=>q('update icash_dnc_verification_sources set enabled=false where id=$1',[source]),
  async()=>q("update icash_text_threads set timezone='Etc/GMT+12' where id=$1",[thread]),
  async()=>q('update icash_wallets set balance_cents=0 where account_id=$1',[account]),
  async()=>q("insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[phone]),
  async()=>q("insert into icash_property_controls(account_id,property_id,manual) values($1,'prop_1001',true)",[account]),
 ])await isolated(async()=>{const fixture=await unsentOpener();await mutate(fixture);assert.equal(await rpc('icash_next_automation'),null);});
 await isolated(async()=>{
  const {message}=await unsentOpener();const fresh=await rpc('icash_next_automation');assert(fresh?.token);
  const consumed=await rpc('icash_consume_automation',{p_token:fresh.token});assert.equal(consumed.openerMessageId,message);
  assert.equal(await rpc('icash_consume_automation',{p_token:fresh.token}),null);
  assert(await claim(message));assert.equal(await claim(message),null,'Recovered opener still has exactly one atomic provider claim');
 });
 console.log('FIXED opener recovery: new bounded ticket, unchanged original identity, no active/uncertain/provider/reserved replay, fresh gates and one atomic claim.');
 console.log('All three SMS/deal integrity regressions reproduced on actual old functions and passed after schema-only fixes. No external calls or writes.');
}finally{await pg.close();}
