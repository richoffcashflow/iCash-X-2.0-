// Isolated PostgreSQL simulation. No real signatures, recipients or provider calls.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createOperationalContactFixture} from '../tests/helpers/operational-contact-fixture.mjs';
import {databaseAdapter,loadService} from '../tests/helpers/simulated-journey-services.mjs';
import {buyerAskingPrice,buyerPackageText,renderBuyerPackage} from '../lib/buyer-disposition.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
const originalFetch=globalThis.fetch,originalReady=process.env.ICASH_LIVE_WORK_READY;
globalThis.fetch=async()=>{throw Error('NETWORK BLOCKED: buyer test is local only');};
process.env.ICASH_LIVE_WORK_READY='true';
const f=await createOperationalContactFixture(process.argv[2]);
const {pg,q,one,rpc,account,other,user,screening,deal}=f;
try{
 await q('alter table icash_text_threads add column if not exists retired_at timestamptz');
 await pg.exec(readFileSync('supabase/migrations/20261005215816_contract_text_delivery.sql','utf8'));
 await pg.exec(readFileSync('config/buyer-disposition-workflow.sql','utf8'));
 await pg.exec(readFileSync('config/buyer-sms-review.sql','utf8'));
 await pg.exec(readFileSync('config/buyer-introduction-calls.sql','utf8'));
 const terms={seller:'Synthetic seller',buyer:'SIMULATION business',address:'123 Main Street',state:'TX',priceCents:3893700,assignmentFeeCents:null,priceSource:'seller_reported'};
 await q('update icash_deal_files set terms=$2 where id=$1',[deal,terms]);
 await q('update icash_screening_jobs set snapshot=$2 where id=$1',[screening,{propertyId:'prop_1001',propertyType:'house',fetchedAt:new Date().toISOString(),raw:{data:{city:'Dallas',zip:'75215',estimated_value:90000,estimated_repair_cost:20090}}}]);
 const template=(await one("insert into icash_signing_templates(state_code,kind,signer_count,provider_template_id,placeholder_names,field_map,reviewed_until,review_reference,test_mode,enabled,provider,template_scope) values('TX','purchase',1,'777','[\"Seller\",\"Customer\"]','{}',now()+interval '1 day','SIMULATION only',false,true,'docuseal','standard') returning id")).id;
 const envelope=(await one("insert into icash_signing_envelopes(account_id,deal_id,kind,template_id,terms,terms_hash,recipients,test_mode,consent_version,requested_by,provider_id,state) values($1,$2,'purchase',$3,$4,$5,'[]',false,'SIMULATION',$6,'777','awaiting_counterparty') returning id",[account,deal,template,terms,'a'.repeat(64),user])).id;
 const prep=()=>rpc('icash_prepare_buyer_disposition',{p_account:account,p_deal:deal});
 const link=()=>rpc('icash_ensure_buyer_package',{p_account:account,p_deal:deal});
 assert.equal(await prep(),false);assert.equal(await link(),null);
 await rpc('icash_save_signing_status',{p_id:envelope,p_state:'customer_signature_needed',p_evidence:{id:'777',test_mode:false,status:'pending'}});
 assert.equal(await prep(),false);assert.equal((await one('select count(*) n from icash_fulfillment_jobs')).n,0);
 await rpc('icash_save_signing_status',{p_id:envelope,p_state:'completed',p_evidence:{id:'777',test_mode:false,status:'completed'}});
 assert.equal((await one('select stage from icash_deal_files where id=$1',[deal])).stage,'under_contract');
 assert.equal((await one('select asking_price_cents from icash_disposition_authorities where deal_id=$1',[deal])).asking_price_cents,4893700);
 assert.equal((await one('select count(*) n from icash_fulfillment_jobs where deal_id=$1',[deal])).n,1);
 const l=await link();assert.match(l.url,/\/d\/[a-f0-9]{32}$/);assert.deepEqual(await link(),l);assert.equal(buyerAskingPrice(3893700),4893700);
 const token=l.url.split('/').at(-1),data=()=>rpc('icash_read_buyer_package',{p_token:token});
 assert.equal((await data()).askingPriceCents,4893700);
 assert.equal(await rpc('icash_ensure_buyer_package',{p_account:other,p_deal:deal}),null);
 assert.equal(await rpc('icash_read_buyer_package',{p_token:'b'.repeat(32)}),null);
 const html=renderBuyerPackage(await data());assert(html.includes('$48,937.00'));assert(!html.includes('Synthetic seller'));assert(!html.includes(envelope));
 const reviewer=randomUUID();await q('insert into auth.users(id,email) values($1,$2)',[reviewer,'buyer-reviewer@example.invalid']);
 await q("insert into icash_trusted_operators(user_id,scopes,provisioned_by,expires_at) values($1,array['authority_review'],'SIMULATION authorization only',now()+interval '1 day')",[reviewer]);
 const market=(await one("insert into icash_authority_market_reviews(account_id,screening_id,state_code,kind,channel,source_reference,reviewed_by,reviewed_at,expires_at) values($1,$2,'TX','contact_permission','sms','SIMULATION buyer channel review','Fixture review',now()-interval '1 minute',now()+interval '1 day') returning id",[account,screening])).id;
 const buyer=(await one("insert into icash_buyer_profiles(account_id,entity_key,display_name,criteria,source_ref) values($1,'fixture','Synthetic buyer','{}','SIMULATION recipient') returning id",[account])).id;
 const payload={kind:'contact_permission',channel:'sms',screeningId:screening,party:'buyer',buyerId:buyer,phone:f.phone,timezone:f.timezone,localStartHour:9,localEndHour:20,stateCode:'TX',purpose:'SIMULATION buyer deal package',sourceName:'SIMULATION explicit recipient source',evidenceReference:'SIMULATION actual business SMS permission',evidenceObservedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()};
 const request=await rpc('icash_submit_authority_review',{p_account:account,p_user:user,p_key:randomUUID(),p_payload:payload});
 const verification={marketReviewId:market,reviewReference:'SIMULATION dated reviewer evidence',reviewedAt:new Date().toISOString(),validUntil:payload.expiresAt,consentReference:'SIMULATION verified recipient SMS permission',consentObservedAt:payload.evidenceObservedAt,dncReceiptId:f.dnc,smsSender:f.sender,smsConsentConfirmed:true,smsConsentBusiness:'SIMULATION business',smsPriorContactReference:'SIMULATION existing business contact'};
 await assert.rejects(rpc('icash_decide_authority_review',{p_reviewer:reviewer,p_request:request.id,p_decision:'approved',p_note:'SIMULATION reviewer decision',p_verification:{...verification,smsConsentConfirmed:false}}));
 await rpc('icash_decide_authority_review',{p_reviewer:reviewer,p_request:request.id,p_decision:'approved',p_note:'SIMULATION reviewer decision',p_verification:verification});
 const thread=await one("select id,party from icash_text_threads where sms_review_request_id=$1",[request.id]);assert.equal(thread.party,'buyer');
 assert.equal(await rpc('icash_sms_thread_review_current',{p_account:account,p_thread:thread.id,p_check_hour:true}),true);
 await q("update icash_text_threads set paused=false,sms_intake_pending=false where id=$1",[thread.id]);
 const packageBody=buyerPackageText(l.askingPriceCents,l.url);
 const message=await rpc('icash_queue_buyer_package_text',{p_account:account,p_thread:thread.id,p_body:packageBody});assert(message);
 assert.equal(await rpc('icash_queue_buyer_package_text',{p_account:account,p_thread:thread.id,p_body:packageBody}),message);
 // Install the real manual send entry point, then test the same hold on every
 // final SMS/email claim. No provider transport is permitted in this fixture.
 const manualSql=readFileSync('supabase/migrations/20261006001029_manual_property_contacts_and_texting.sql','utf8');
 const manualStart=manualSql.indexOf('create or replace function public.icash_claim_customer_text(');
 await pg.exec(manualSql.slice(manualStart,manualSql.indexOf('end $$;',manualStart)+7));
 await pg.exec(readFileSync('config/buyer-outreach-hold.sql','utf8'));
 const emailRate=(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) select 'manual_email','SIMULATION buyer hold',charge_cents,costs_micros,'SIMULATION email costs',verified_at,expires_at,true from icash_operation_rates where id=$1 returning id",[f.sms])).id;
 const incomingEmail=(await one("insert into icash_text_messages(account_id,thread_id,direction,body,state) values($1,$2,'incoming','Please email the package to buyer@example.invalid','received') returning id",[account,thread.id])).id;
 const email=await rpc('icash_queue_deal_email',{p_account:account,p_actor:user,p_deal:deal,p_contact:'buyer-request:'+incomingEmail,p_key:randomUUID(),p_subject:'SIMULATION buyer package',p_body:'Synthetic package only',p_rate:emailRate});
 const hold=(held,p_actor=user,p_account=account)=>rpc('icash_set_buyer_outreach_hold',{p_account,p_deal:deal,p_actor,p_held:held,p_reason:'Owner requested local test without buyer outreach'});
 await assert.rejects(hold(true,f.otherUser),/Owned deal/);
 await assert.rejects(hold(true,f.otherUser,other),/Owned deal/);
 assert.equal(await hold(true),true);assert.equal(await hold(true),true);
 assert.equal((await one('select count(*) n from icash_buyer_outreach_holds where deal_id=$1',[deal])).n,1);
 const heldAt=(await one('select held_at from icash_buyer_outreach_holds where deal_id=$1',[deal])).held_at;
 assert.equal(await rpc('icash_buyer_outreach_held',{p_account:other,p_deal:deal}),false);
 assert.equal(await rpc('icash_buyer_outreach_held',{p_account:account,p_deal:randomUUID()}),false);
 const spendBefore=(await one('select count(*) n from icash_operation_spend')).n;
 for(const name of ['icash_claim_text','icash_claim_customer_text'])assert.equal(await rpc(name,{p_account:account,p_message:message,p_sender:f.sender}),null);
 assert.equal(await rpc('icash_claim_deal_email',{p_account:account,p_id:email}),null);
 assert.equal((await one('select state from icash_text_messages where id=$1',[message])).state,'ready');
 assert.equal((await one('select state from icash_deal_emails where id=$1',[email])).state,'ready');
 assert.equal((await one('select count(*) n from icash_operation_spend')).n,spendBefore,'held outreach incurs no spend claim');
 assert.deepEqual(await rpc('icash_buyer_package_text_targets',{p_account:account,p_deal:deal}),[]);
 assert.equal(await rpc('icash_queue_buyer_package_text',{p_account:account,p_thread:thread.id,p_body:packageBody}),null);
 assert(!(await rpc('icash_deal_email_contacts',{p_account:account,p_deal:deal})).some(c=>c.party==='buyer'));
 assert.equal((await data()).askingPriceCents,4893700,'hold preserves prepared package');
 const {db}=databaseAdapter(pg);
 let transportCalls=0;const noTransport=async()=>{transportCalls++;throw Error('Unexpected buyer transport');};
 const textService=await loadService('lib/buyer-outreach-service.ts',{db,buyerPackageText,dispatchTextMessage:noTransport});
 const emailService=await loadService('lib/buyer-package-email.ts',{db,createHash,dealTermsSchema,dealEmailConfigured:()=>true,dispatchDealEmail:noTransport});
 assert.equal((await textService.sendBuyerPackageTexts(account,deal)).accepted,0);
 assert.equal((await emailService.sendRequestedBuyerPackages(account,deal)).accepted,0);
 assert.equal(transportCalls,0,'actual package services do not reach either provider transport while held');
 // A seller claim on the same deal still delegates to the existing authority
 // chain; this transaction discards the explicit sentinel used to observe it.
 await q('begin');try{
  await q("update icash_text_threads set party='seller' where id=$1",[thread.id]);
  for(const name of ['icash_claim_text_before_buyer_hold','icash_claim_customer_text_before_buyer_hold'])await pg.exec(`create or replace function public.${name}(p_account uuid,p_message uuid,p_sender text) returns jsonb language sql as $$select '{"sellerDelegated":true}'::jsonb$$;`);
  for(const name of ['icash_claim_text','icash_claim_customer_text'])assert.deepEqual(await rpc(name,{p_account:account,p_message:message,p_sender:f.sender}),{sellerDelegated:true});
 }finally{await q('rollback');}
 // Repeated signature polling cannot silently remove the owner's test hold.
 await rpc('icash_save_signing_status',{p_id:envelope,p_state:'completed',p_evidence:{id:'777',test_mode:false,status:'completed'}});
 assert.equal(await rpc('icash_buyer_outreach_held',{p_account:account,p_deal:deal}),true);
 assert.equal(String((await one('select held_at from icash_buyer_outreach_holds where deal_id=$1',[deal])).held_at),String(heldAt));
 for(const role of ['anon','authenticated']){
  assert.equal((await one("select has_function_privilege($1,'icash_set_buyer_outreach_hold(uuid,uuid,uuid,boolean,text)','execute') allowed",[role])).allowed,false);
  assert.equal((await one("select has_table_privilege($1,'icash_buyer_outreach_holds','select') allowed",[role])).allowed,false);
 }
 assert.equal(await hold(false),false);
 assert((await rpc('icash_deal_email_contacts',{p_account:account,p_deal:deal})).some(c=>c.party==='buyer'));
 assert.equal((await rpc('icash_claim_deal_email',{p_account:account,p_id:email})).to,'buyer@example.invalid');
 assert.equal(await rpc('icash_claim_deal_email',{p_account:account,p_id:email}),null,'released email still claims only once');
 console.log('PASS buyer test hold: no SMS/email transport or spend, queued sends blocked, package preserved, seller path preserved, exact owner/deal scope, no automatic expiry, explicit fixture-only release.');
 await q("update icash_screening_jobs set completed_at=now()-interval '2 days' where id=$1",[screening]);
 const claimed=await rpc('icash_claim_text',{p_account:account,p_message:message,p_sender:f.sender});assert.equal(claimed.message,packageBody);
 assert.equal(await rpc('icash_claim_text',{p_account:account,p_message:message,p_sender:f.sender}),null);
 await q('begin');await q("insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[f.phone]);assert.equal(await rpc('icash_sms_thread_review_current',{p_account:account,p_thread:thread.id,p_check_hour:false}),false);await q('rollback');
 const sms=buyerPackageText(l.askingPriceCents,l.url);assert(sms.length<=160);assert(sms.includes('Under contract'));assert.equal(await rpc('icash_queue_buyer_package_text',{p_account:other,p_thread:deal,p_body:sms}),null);
 await q('begin');await q("update icash_deal_files set stage='closed' where id=$1",[deal]);assert.equal(await data(),null);await q('rollback');
 await q('begin');await q("update icash_deal_files set terms=jsonb_set(terms,'{assignmentFeeCents}','2000000') where id=$1",[deal]);assert.equal(await data(),null);assert.equal(await link(),null);await q('rollback');
 await q('begin');await q("update icash_disposition_authorities set expires_at=now()-interval '1 second' where deal_id=$1",[deal]);assert.equal(await prep(),false);assert.equal(await data(),null);await q('rollback');
 await q('begin');await q("update icash_buyer_package_links set revoked_at=now() where id=$1",[l.id]);assert.equal(await data(),null);assert.equal(await link(),null);await q('rollback');
 // First buyer conversations need real contact evidence, not completed funds qualification.
 const voiceMarket=(await one("insert into icash_authority_market_reviews(account_id,screening_id,state_code,kind,channel,source_reference,reviewed_by,reviewed_at,expires_at) values($1,$2,'TX','contact_permission','voice','SIMULATION buyer voice review','Fixture review',now()-interval '1 minute',now()+interval '1 day') returning id",[account,screening])).id;
 const voiceRequest=await rpc('icash_submit_authority_review',{p_account:account,p_user:user,p_key:randomUUID(),p_payload:{...payload,channel:'voice'}});
 const {smsSender,smsConsentConfirmed,smsConsentBusiness,smsPriorContactReference,...voiceVerification}=verification;
 await rpc('icash_decide_authority_review',{p_reviewer:reviewer,p_request:voiceRequest.id,p_decision:'approved',p_note:'SIMULATION voice review',p_verification:{...voiceVerification,marketReviewId:voiceMarket}});
 const permission=(await one('select id from icash_contact_permissions where review_request_id=$1',[voiceRequest.id])).id;
 await q('update icash_buyer_profiles set discovery=$2 where id=$1',[buyer,{phones:[{number:f.phone,doNotCall:false}]}]);
 await q("insert into icash_buyer_candidates(deal_id,buyer_id,rights_until) values($1,$2,now()+interval '1 day')",[deal,buyer]);
 await q("update icash_fulfillment_jobs set state='complete' where deal_id=$1",[deal]);
 await q("insert into icash_deal_documents(deal_id,kind,html,terms,fulfillment_job_id) select $1,'buyer_package','SIMULATION',$2,id from icash_fulfillment_jobs where deal_id=$1",[deal,terms]);
 const voiceContext=await rpc('icash_buyer_voice_context',{p_permission:permission});assert.equal(voiceContext.qualificationStatus,'unconfirmed');assert.equal(voiceContext.askingPriceCents,4893700);
 await q('begin');await q('update icash_contact_permissions set revoked_at=now() where id=$1',[permission]);assert.equal(await rpc('icash_buyer_voice_context',{p_permission:permission}),null);await q('rollback');
 // Isolated incoming-session fixture: exercises the actual routing SQL without provider calls.
 await pg.exec(`create schema icash_recorded_reception_private;
 create function icash_recorded_reception_private.clock_now() returns timestamptz language sql stable as 'select now()';
 create table icash_recorded_reception_private.configs(id uuid primary key,owner_user_id uuid,enabled boolean,approved_at timestamptz,reviewed_until timestamptz,context_policy text constraint configs_context_policy_check check(context_policy in ('message_only','property_intake_v1')),context_policy_hash text,context_approval_reference text,constraint configs_check1 check(context_policy='message_only' or context_policy_hash is not null));
 create table icash_recorded_reception_private.sessions(id uuid primary key,config_id uuid,account_id uuid,operation_key text,nonce_hash text,state text,consent_at timestamptz,recording_sid text,register_claimed_at timestamptz,conversation_id text,end_requested_at timestamptz,call_ended_at timestamptz,from_phone text,call_deadline_at timestamptz,rate_id uuid,charge_cap_cents bigint);
 create function public.icash_recorded_reception_property_context(uuid,text) returns jsonb language sql stable as 'select null::jsonb';`);
 await pg.exec(readFileSync('config/buyer-inbound-context.sql','utf8'));
 const reception=randomUUID(),session=randomUUID();
 await q("insert into icash_recorded_reception_private.configs values($1,$2,true,now()-interval '1 minute',now()+interval '1 day','buyer_seller_v1','06b4040c9d2b788ac204479d1179173f9acbd59172a7e930bac0b189438fde57','SIMULATION policy binding')",[reception,user]);
 await q("insert into icash_recorded_reception_private.sessions(id,config_id,account_id,operation_key,nonce_hash,state,consent_at,recording_sid,from_phone,call_deadline_at,rate_id,charge_cap_cents) select $1,$2,$3,operation_key,'fixture-nonce','recording',now(),'REfixture',$4,now()+interval '10 minutes',rate_id,charge_cap_cents from icash_operation_spend where operation_key=$5",[session,reception,account,f.phone,'text:'+message]);
 await q("update icash_text_messages set state='accepted',provider_id='fixture-provider-receipt' where id=$1",[message]);
 const incoming=()=>rpc('icash_recorded_reception_property_context',{p_id:session,p_nonce_hash:'fixture-nonce'});
 assert.deepEqual(await incoming(),{status:'buyer',address:'123 Main Street',purchasePriceCents:3893700,assignmentFeeCents:1000000,askingPriceCents:4893700,buyerPaysClosingCosts:true});
 assert.equal(await rpc('icash_recorded_reception_property_context',{p_id:session,p_nonce_hash:'wrong'}),null);
 await q('begin');await q('update icash_recorded_reception_private.sessions set account_id=$2 where id=$1',[session,other]);assert.equal(await incoming(),null);await q('rollback');
 await q('begin');await q("update icash_text_threads set party='seller' where id=$1",[thread.id]);assert.deepEqual(await incoming(),{status:'matched',address:'123 Main Street'});await q('rollback');
 await q('begin');await q("update icash_recorded_reception_private.sessions set from_phone='+12145550199' where id=$1",[session]);assert.equal(await incoming(),null);await q('rollback');
 await q('begin');await q("update icash_recorded_reception_private.sessions set call_ended_at=now() where id=$1",[session]);assert.equal(await incoming(),null);await q('rollback');
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'icash_read_buyer_package(text)','execute') allowed",[role])).allowed,false);
 // Apply the complete channel restriction over the same functioning buyer
 // package/SMS/inbound fixture. Never execute an outbound provider request.
 const buyerJob=(await one("insert into icash_voice_jobs(account_id,permission_id) values($1,$2) returning id",[account,permission])).id;
 await pg.exec('set check_function_bodies=off;');
 await pg.exec(readFileSync('supabase/migrations/20261008181246_buyer_written_outreach_only.sql','utf8'));
 await pg.exec('set check_function_bodies=on;');
 assert.equal((await one('select state,outcome from icash_voice_jobs where id=$1',[buyerJob])).outcome,'buyer_outbound_calls_disabled');
 assert.equal((await incoming()).status,'buyer','inbound buyer routing remains available');
 await pg.exec(`create table if not exists icash_timezone_names(name text primary key);insert into icash_timezone_names values('America/Chicago') on conflict do nothing;`);
 const incomingOperation='SIMULATION:incoming-buyer',incomingReservation=(await one("insert into icash_credit_reservations(account_id,operation_key,amount_cents) values($1,$2,100) returning id",[account,incomingOperation])).id;
 await q("insert into icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until) values($1,$2,$3,$4,100,1000,'dispatched',now()+interval '1 hour')",[incomingOperation,account,f.incoming,incomingReservation]);
 await q("insert into icash_live_conversations(account_id,screening_id,party,agent_id,conversation_id,operation_key,contact_key,strategy_key,tool_token_hash,tool_expires_at) values($1,$2,'buyer','agent_fixture','conv_buyercallback',$3,repeat('d',64),'buyer_followup',repeat('e',64),now()+interval '1 hour')",[account,screening,incomingOperation]);
 const callback=await rpc('icash_live_callback_tool',{p_hash:'e'.repeat(64),p_conversation:'conv_buyercallback',p_due:new Date(Date.now()+600000).toISOString(),p_timezone:'America/Chicago',p_readback:'SIMULATION confirmed future time',p_confirmation:'yes'});
 assert.equal(callback.saved,false);assert.equal(callback.reason,'buyer_outbound_calls_disabled');assert.equal((await one('select count(*) n from icash_live_callbacks')).n,0);
 assert.equal((await data()).askingPriceCents,4893700,'buyer package survives channel change');
 console.log('PASS buyer written-only migration: untouched queued calls retired, callback denied, inbound buyer calls and signed-price package retained.');
 console.log('PASS: seller-only signature held; all signatures trigger one research job; signed price + $10000; share link without private seller data; tenant isolation; cancellation, changed price, revocation and expiry invalidate package. Synthetic evidence only.');
}catch(e){console.error('BUYER SIMULATION FAILED:',e.message,e.where??'',e.stack?.split('\n').slice(1,4).join('\n'));process.exitCode=1;}
finally{await pg.close();globalThis.fetch=originalFetch;if(originalReady===undefined)delete process.env.ICASH_LIVE_WORK_READY;else process.env.ICASH_LIVE_WORK_READY=originalReady;}
