// SIMULATION ONLY. In-memory PostgreSQL and synthetic owner/DNC evidence.
// No provider requests, customer data, external writes, or real outreach.
import assert from 'node:assert/strict';
import {createOperationalContactFixture} from '../tests/helpers/operational-contact-fixture.mjs';
const {pg,q,rpc,one,isolated,account,user,otherUser,other,newOwner,phone,sender,called,hash,sms,owners,incoming,timezone,screening,deal,sourceResult,source,dnc,prepare,project}=await createOperationalContactFixture(process.argv[2]);
try{
 assert.equal(await prepare(),2);
 assert.equal(await prepare(),0,'Source preparation is idempotent');
 for(const [sql,args] of [
  ['update icash_accounts set bot_paused=true where id=$1',[account]],
  ['update icash_outreach_campaigns set enabled=false where account_id=$1',[account]],
  ['update icash_dnc_verification_sources set enabled=false where id=$1',[source]],
  ['update icash_dnc_verification_receipts set clear=false where id=$1',[dnc]],
  ["insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[phone]],
  ['update icash_operation_rates set enabled=false where id=$1',[sms]],
 ])await isolated(async()=>{await q(sql,args);assert.equal(await project(),0,sql);});
 await isolated(async()=>{
  const foreignScreen=(await one("insert into icash_screening_jobs(account_id,event_key,snapshot,state,result,completed_at) values($1,'SIMULATION other SMS','{\"propertyId\":\"prop_2002\"}','complete','{\"financialCheck\":{\"status\":\"eligible\"}}',now()) returning id",[other])).id;
  const foreignDeal=(await one("insert into icash_deal_files(account_id,screening_id,stage,terms) values($1,$2,'draft','{\"address\":\"Other Property\",\"practice\":false}') returning id",[other,foreignScreen])).id;
  const existing=await one("insert into icash_text_threads(account_id,deal_id,sender,recipient,paused) values($1,$2,$3,$4,true) returning *",[other,foreignDeal,sender,phone]);
  assert.equal(await project(),0,'Sender/recipient tenant conflict is never reassigned');
  assert.deepEqual(await one('select * from icash_text_threads where id=$1',[existing.id]),existing);
 });
 assert.equal(await project(),1);
 assert.equal(await project(),0);
 const t=await one('select * from icash_text_threads where account_id=$1',[account]),thread=t.id;
 assert(t.operational_contact_id);assert(t.eligibility_until);
 for(const field of ['permission_until','permission_evidence','sms_review_request_id'])assert.equal(t[field],null,field+' is not fabricated');
 assert.equal(t.paused,false);assert.equal(t.sms_intake_pending,false);
 for(const table of ['icash_contact_permissions','icash_authority_review_requests','icash_authority_market_reviews','icash_authority_review_audit'])assert.equal((await one('select count(*)::integer n from '+table)).n,0,table+' remains empty');
 assert.deepEqual((await one('select result from icash_owner_contacts where screening_id=$1',[screening])).result,sourceResult,'Imported unverified data is unchanged');
 const current=()=>rpc('icash_sms_thread_review_current',{p_account:account,p_thread:thread,p_check_hour:true});
 assert.equal(await current(),true);
 assert.equal(await rpc('icash_sms_thread_review_current',{p_account:other,p_thread:thread,p_check_hour:false}),false);
 const opener=()=>rpc('icash_queue_seller_opener',{p_account:account,p_thread:thread});
 const claim=id=>rpc('icash_claim_text',{p_account:account,p_message:id,p_sender:sender});
 const accept=id=>rpc('icash_accept_text',{p_account:account,p_message:id,p_provider:'SIMULATION accepted '+id});
 const start=async()=>{const id=await opener();assert(id);assert(await claim(id));assert.equal(await claim(id),null);await accept(id);return id;};
 let event=0;
 const ingest=async body=>{const id='SIMULATION incoming '+(++event);await rpc('icash_ingest_text_event',{p_event:{id,type:'text.incoming.sms',timestamp:Date.now()/1000,data:{from:phone,to:sender,body,message_id:id}},p_optout:body==='STOP'});return (await one('select id from icash_text_messages where event_id=$1',[id])).id;};
 for(const [sql,args] of [
  ['update icash_accounts set owner_user_id=$1 where id=$2',[newOwner,account]],
  ["update icash_customer_identities set company_name='Different business' where account_id=$1",[account]],
  ['update icash_dnc_verification_sources set enabled=false where id=$1',[source]],
  ["update icash_dnc_verification_receipts set expires_at=now()-interval '1 second' where id=$1",[dnc]],
  ["update icash_dnc_verification_receipts set checked_at=now()+interval '1 minute' where id=$1",[dnc]],
  ['update icash_dnc_verification_receipts set clear=false where id=$1',[dnc]],
  ["update icash_operational_contacts set revoked_at=now() where id=$1",[t.operational_contact_id]],
  ["update icash_owner_contacts set result=jsonb_set(result,'{contacts,0,phones,0,doNotCall}','true') where screening_id=$1",[screening]],
  ['update icash_operation_rates set enabled=false where id=$1',[sms]],
  ["update icash_text_threads set operational_sms_rate_hash=repeat('b',64) where id=$1",[thread]],
  ["update icash_communication_prices set customer_micros=customer_micros+1 where operation='sms_segment'",[]],
  ["update icash_text_senders set enabled=false where phone=$1",[sender]],
  ["insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[phone]],
 ])await isolated(async()=>{const id=await opener();assert(id);await q(sql,args);assert.equal(await current(),false,sql);assert.equal(await claim(id),null,sql);});
 for(const [sql,args] of [
  ['update icash_accounts set bot_paused=true where id=$1',[account]],
  ['update icash_text_threads set paused=true where id=$1',[thread]],
  ['update icash_outreach_campaigns set enabled=false where account_id=$1',[account]],
  ["update icash_screening_jobs set completed_at=now()-interval '2 days' where id=$1",[screening]],
  ["insert into icash_property_controls(account_id,property_id,manual) values($1,'prop_1001',true) on conflict(account_id,property_id) do update set manual=true",[account]],
 ])await isolated(async()=>{const id=await opener();assert(id);await q(sql,args);assert.equal(await claim(id),null,sql);});
 await isolated(async()=>{const id=await opener();await q('update icash_wallets set balance_cents=0 where account_id=$1',[account]);await assert.rejects(claim(id),/credit|balance|fund/i);});
 await isolated(async()=>{await q('update icash_text_threads set paused=true where id=$1',[thread]);await project();await rpc('icash_set_work_control',{p_user:user,p_account:account,p_action:'resume',p_screening:null});assert.equal((await one('select paused from icash_text_threads where id=$1',[thread])).paused,true,'Run cannot clear a later manual pause');});
 // A source-record nighttime clock may route incoming calls, but never outbound SMS.
 await isolated(async()=>{
  const night=(await one("select name from pg_timezone_names where extract(hour from now() at time zone name)=2 limit 1")).name;
  const receipt=(await one("insert into icash_dnc_verification_receipts(source_id,phone,contact_key,provider_reference,receipt_hash,checked_at,expires_at,clear,contact_timezone,timezone_source_reference) select source_id,phone,contact_key,'SIMULATION night receipt',receipt_hash,checked_at,expires_at,clear,$2,timezone_source_reference from icash_dnc_verification_receipts where id=$1 returning id",[dnc,night])).id;
  const target=(await one("insert into icash_operational_contacts(account_id,screening_id,channel,phone,contact_key,timezone,timezone_basis,local_start_hour,local_end_hour,owner_user_id,sending_principal,source_hash,dnc_receipt_id,eligibility_until) select account_id,screening_id,channel,phone,contact_key,$2,'source_record',9,20,owner_user_id,sending_principal,source_hash,$3,eligibility_until from icash_operational_contacts where id=$1 returning id",[t.operational_contact_id,night,receipt])).id;
  await q('update icash_text_threads set operational_contact_id=$2,timezone=$3 where id=$1',[thread,target,night]);
  assert.equal(await current(),false,'Quiet hours prevent outbound eligibility');
  assert.equal(await rpc('icash_sms_thread_review_current',{p_account:account,p_thread:thread,p_check_hour:false}),true,'Inbound eligibility does not impose outbound quiet hours');
  const id=await opener();assert(id);assert.equal(await claim(id),null,'Queued message remains held outside recipient hours');
 });
 await isolated(async()=>{const ticket=await rpc('icash_next_automation');assert(ticket?.token);const work=await rpc('icash_consume_automation',{p_token:ticket.token});assert.equal(work.kind,'seller_opener');assert(work.openerMessageId);assert(await claim(work.openerMessageId));});
 await isolated(async()=>{const id=await start();await ingest('Yes');const opening=await one('select * from icash_sms_seller_openings where thread_id=$1',[thread]);assert(opening.interest_message_id);assert.equal((await one('select count(*)::integer n from icash_sms_inbound_invitations')).n,0);const ticket=await rpc('icash_next_automation');assert(ticket?.token);assert(await claim(opening.interest_message_id));await accept(opening.interest_message_id);await ingest('STOP');assert.equal(await current(),false);assert.equal(await opener(),null);assert(id);});
 // Full three-message route with separate owner confirmation and selling interest.
 await q("insert into icash_inbound_voice_routes(called_number,business_number,agent_id,rate_id,max_duration_seconds,enabled,reviewed_until,agent_config_hash) values($1,$2,'agent_fixture',$3,600,true,now()+interval '1 day',$4)",[called,sender,incoming,hash]);
 await start();await ingest('Yes');
 const opening=await one('select * from icash_sms_seller_openings where thread_id=$1',[thread]);
 assert(await claim(opening.interest_message_id));await accept(opening.interest_message_id);
 await ingest('Yes');
 const invitation=await one('select * from icash_sms_inbound_invitations where thread_id=$1',[thread]);
 assert.equal(invitation.opener_id,opening.interest_message_id);
 assert(await claim(invitation.message_id));await accept(invitation.message_id);
 assert.deepEqual(await rpc('icash_begin_inbound_voice',{p_caller:phone,p_called:called,p_agent:'agent_fixture',p_call_sid:'CA'+'b'.repeat(32),p_conversation:'conv_fixture',p_binding_hash:hash,p_token_hash:'c'.repeat(64),p_agent_hash:hash}),{maxSeconds:600});
 assert.equal((await one('select count(*)::integer n from icash_contact_permissions')).n,0,'SMS/inbound never manufacture voice consent');
 console.log('Operational SMS: real-source projection without permission rows; current DNC, source/business/account, price, STOP, manual pause, fresh property, funds, scheduler, owner question and inbound invitation guards passed. No external calls.');
}finally{await pg.close();}
