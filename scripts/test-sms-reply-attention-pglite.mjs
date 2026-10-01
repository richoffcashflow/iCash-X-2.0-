// SIMULATION ONLY: isolated real PostgreSQL functions, synthetic source permissions.
// No customer data, production writes, payments, messages or calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {createJourneyDb} from '../tests/helpers/simulated-journey-db.mjs';
import {databaseAdapter} from '../tests/helpers/simulated-journey-services.mjs';
import {outreachCampaignPolicy} from '../lib/outreach-campaign.ts';
const {pg}=await createJourneyDb(process.argv[2]);
const {q,rpc}=databaseAdapter(pg);const one=async(s,p=[])=>{const r=await q(s,p);assert.equal(r.rows.length,1);return r.rows[0];};
try{
 for(const name of ['text-ai','seller-workflow-continuity','reply-signals','market-expansion','seller-opener-experiments','seller-opener-delivery-order','sms-inbound-campaign','sms-campaign-reply-attention'])await pg.exec(readFileSync(new URL('../config/'+name+'.sql',import.meta.url),'utf8'));
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
 const sms=(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) values('sms_send','SIMULATION SMS',10,$1,'SIMULATION permitted pricing',now()-interval '1 minute',now()+interval '1 day',true) returning id",[costs])).id;
 const incoming=(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) values('incoming_call','SIMULATION incoming',100,$1,'SIMULATION incoming pricing',now()-interval '1 minute',now()+interval '1 day',true,600) returning id",[{...costs,messaging:0,elevenlabs:100000}])).id;
 const expiredRate=async id=>(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) select operation,version||' expired',charge_cents,costs_micros,evidence_ref,now()-interval '1 day',now()-interval '1 second',true,voice_max_duration_seconds from icash_operation_rates where id=$1 returning id",[id])).id;
 const expiredSms=await expiredRate(sms),expiredIncoming=await expiredRate(incoming);
 await q("update icash_operating_budget set enabled=true,funded_micros=1000000000,protected_micros=0,reserved_micros=0,spent_micros=0,daily_limit_micros=null where id=1");
 const phone='+12145550123',sender='+14243948384',called='+17816093521',hash='a'.repeat(64);
 const timezone=(await one("select name from pg_timezone_names where extract(hour from now() at time zone name)=12 limit 1")).name;
 const screening=(await one("insert into icash_screening_jobs(account_id,event_key,snapshot,state,result,completed_at) values($1,'SIMULATION SMS property','{\"propertyId\":\"prop_1001\"}','complete','{\"financialCheck\":{\"status\":\"eligible\"}}',now()) returning id",[account])).id;
 const deal=(await one("insert into icash_deal_files(account_id,screening_id,stage,terms) values($1,$2,'draft','{\"address\":\"SIMULATION ONLY\",\"practice\":false}') returning id",[account,screening])).id;
 const thread=(await one("insert into icash_text_threads(account_id,deal_id,sender,recipient,permission_until,permission_evidence,timezone,dnc_checked_at,dnc_clear,sms_rate_id,paused) values($1,$2,$3,$4,now()+interval '1 day','SIMULATION genuine prior SMS permission only',$5,now(),true,$6,false) returning id",[account,deal,sender,phone,timezone,sms])).id;
 await q('insert into icash_inbound_voice_routes(called_number,business_number,agent_id,rate_id,max_duration_seconds,enabled,reviewed_until,agent_config_hash) values($1,$2,$3,$4,600,true,now()+interval \'1 day\',$5)',[called,sender,'agent_fixture',incoming,hash]);
 const opener=await rpc('icash_queue_seller_opener',{p_account:account,p_thread:thread});assert(opener);
 assert(await rpc('icash_claim_text',{p_account:account,p_message:opener,p_sender:sender}));
 await rpc('icash_accept_text',{p_account:account,p_message:opener,p_provider:'SIMULATION accepted opener'});
 const inboundArgs={p_caller:phone,p_called:called,p_agent:'agent_fixture',p_call_sid:'CA'+'1'.repeat(32),p_conversation:'conv_fixtureincoming',p_binding_hash:'b'.repeat(64),p_token_hash:'c'.repeat(64),p_agent_hash:hash};
 assert.equal(await rpc('icash_begin_inbound_voice',inboundArgs),null,'No incoming routing before an invitation');
 assert.match((await one('select body from icash_text_messages where id=$1',[opener])).body,/Reply STOP to opt out\./);

 const event=(id,body,timestamp=Date.now()/1000)=>({id,type:'text.incoming.sms',timestamp,data:{from:phone,to:sender,body,message_id:id+':provider'}});
 const ingest=ev=>rpc('icash_ingest_text_event',{p_event:ev,p_optout:ev.data.body==='STOP'});
 const attention=()=>one("select * from icash_text_attention where thread_id=$1 and kind='campaign_reply'",[thread]);
 const count=async()=>Number((await one("select count(*)::int n from icash_text_attention where thread_id=$1 and kind='campaign_reply'",[thread])).n);
 // Ordinary enabled incoming routing creates an invitation and needs no fallback attention.
 await q('begin');try{
  await ingest(event('SIMULATION normal invitation','Yes'));
  const inv=await one('select * from icash_sms_inbound_invitations where thread_id=$1',[thread]);
  assert.equal(await count(),0);
  assert(await rpc('icash_review_sms_campaign_reply',{p_account:account,p_message:inv.reply_id}),'SMS-only dispatch can surface a held invitation');
  assert.equal(await count(),1);
  assert.equal(await rpc('icash_review_sms_campaign_reply',{p_account:other,p_message:inv.reply_id}),null);
 }finally{await q('rollback');}
 await q('update icash_inbound_voice_routes set enabled=false where called_number=$1',[called]);
 const first=event('SIMULATION route held','Yes');await ingest(first);await ingest(first);
 assert.equal(await count(),1,'duplicate webhook cannot duplicate attention');
 const saved=await attention();assert.equal(saved.account_id,account);assert.equal(saved.deal_id,deal);assert.equal(saved.screening_id,screening);assert.equal(saved.quote,'Yes');assert.equal(Number(saved.message_event_at),first.timestamp);
 assert.equal((await one('select count(*)::int n from icash_sms_inbound_invitations')).n,0);
 assert.equal((await one("select count(*)::int n from icash_text_messages where direction='outgoing'")).n,1,'no response queued');
 await q("update icash_text_attention set state='acknowledged' where id=$1",[saved.id]);
 await rpc('icash_review_sms_campaign_reply',{p_account:account,p_message:saved.message_id});assert.equal((await attention()).state,'acknowledged','same reply cannot undo acknowledgment');
 const newer=event('SIMULATION ambiguous','What is the price?',first.timestamp+10);await ingest(newer);
 const latest=await attention();assert.equal(latest.id,saved.id);assert.equal(latest.state,'open');assert.equal(latest.quote,'What is the price?');
 const late=event('SIMULATION late older reply','Maybe',first.timestamp-60);await ingest(late);
 assert.equal((await attention()).message_id,latest.message_id,'late provider event cannot overwrite newer attention');
 await q('begin');try{await q("update icash_text_events set payload=jsonb_set(payload,'{timestamp}','\"invalid\"'::jsonb) where id=$1",[newer.id]);assert(Number.isFinite(Number(await rpc('icash_sms_reply_time',{p_message:latest.message_id}))));}finally{await q('rollback');}
 await rpc('icash_review_sms_campaign_reply',{p_account:account,p_message:saved.message_id});assert.equal((await attention()).message_id,latest.message_id,'late reconciliation cannot replace newer reply');
 for(const body of ['STOP','Not interested','I want a human','Call me']){
  await q('begin');try{await ingest(event('SIMULATION priority '+body,body,first.timestamp+20));assert.equal((await attention()).message_id,latest.message_id,body);if(body==='STOP')assert.equal((await one('select count(*)::int n from icash_text_suppressions where phone=$1',[phone])).n,1);}finally{await q('rollback');}
 }
 await q('begin');try{await q("update icash_deal_files set terms=jsonb_set(terms,'{practice}','true') where id=$1",[deal]);await ingest(event('SIMULATION practice excluded','Yes',first.timestamp+30));assert.equal((await attention()).message_id,latest.message_id);}finally{await q('rollback');}
 await q('begin');try{await q('delete from icash_seller_opener_assignments where thread_id=$1',[thread]);await ingest(event('SIMULATION no sent opener','Yes',first.timestamp+30));assert.equal((await attention()).message_id,latest.message_id);}finally{await q('rollback');}
 assert.equal((await one('select count(*)::int n from icash_contact_permissions')).n,0,'review never creates contact authority');
 assert.equal((await one('select bot_paused from icash_accounts where id=$1',[account])).bot_paused,false,'review does not change account controls');
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'public.icash_review_sms_campaign_reply(uuid,uuid)','execute') allowed",[role])).allowed,false);
 console.log('SIMULATION PASS: route-held positive and ambiguous replies surface in existing attention; accepted opener/tenant/property provenance, duplicate/acknowledgment/late-event safety, STOP/decline priority, no send/authority/control side effects.');
}finally{await pg.close();}
