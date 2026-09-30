/**
 * SIMULATION ONLY: synthetic accounts, properties, authority evidence, signatures,
 * provider receipts and title confirmations inside one ephemeral PostgreSQL DB.
 * No real payment, contact, email, signature, title instruction or closing occurs.
 * node --experimental-strip-types scripts/test-customer-journey-pglite.mjs /absolute/path/to/pglite/dist/index.js
 */
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {createJourneyDb} from '../tests/helpers/simulated-journey-db.mjs';
import {databaseAdapter,loadService} from '../tests/helpers/simulated-journey-services.mjs';
import {discoverPage} from '../lib/discovery-pipeline.ts';
import {runScreeningJob} from '../lib/screening-job.ts';
import {tick} from '../worker/runner.mjs';
import {contractCapability,reviewedContractCoverage} from '../lib/contract-coverage.ts';
import {costCategories} from '../lib/cost-guard.ts';
import {validateCostManifest} from '../lib/cost-manifest.ts';
import {sameBusinessNumber,consistentTextSenders} from '../lib/number-continuity.ts';
import {boundedVoiceSmsContext,voiceSmsInstructions} from '../lib/voice-sms-context.ts';
import {contactEligibility,callEligibility,verifiedOfferCeiling} from '../lib/live-dispatch-policy.ts';
import {buyerCallInstructions} from '../lib/buyer-call-policy.ts';
import {productionDealInstructions,acquisitionOpeners,liveConversationResult} from '../lib/deal-conversation.ts';
import {readVoiceUsagePolicies,settleBoundVoiceUsage} from '../lib/voice-usage-service.ts';
import {dealTermsSchema,renderDealDocument} from '../lib/deal-documents.ts';
import {contractPreparation,fillEmptyTerms} from '../lib/contract-preparation.ts';
import {normalizeDocuseal as normalize} from '../lib/docuseal-policy.ts';
import {signingReadiness,signingDocumentReadiness,signingTermsHash,signingFields,verifiedSigningStatus} from '../lib/signing-policy.ts';
import {discoverBuyerPage} from '../lib/buyer-discovery.ts';
import {planBuyerOutreach} from '../lib/buyer-engine.ts';
import {titleEmailAddress} from '../lib/title-inbound-policy.ts';
import {emailFromName} from '../lib/deal-email-policy.ts';
import {titleConfirmationInstructions} from '../lib/title-confirmation-instructions.ts';

const titleFirstStage=process.argv.find(x=>x.startsWith('--title-first='))?.split('=')[1]??null;
assert(titleFirstStage===null||['title_open','closing'].includes(titleFirstStage),'Invalid title-first stage');
const {pg,files,notices}=await createJourneyDb(process.argv[2]);
const {db:baseDb,rpc,q,calls}=databaseAdapter(pg);
// Reproduce the one PostgREST embedded relation used by actual coverage service.
const db=async(path,...args)=>{const rows=await baseDb(path,...args);if(path.includes('rate:icash_operation_rates'))for(const row of rows)row.rate=(await q('select * from icash_operation_rates where id=$1',[row.rate_id])).rows[0]??null;return rows;};
const originalFetch=globalThis.fetch,originalEnv={...process.env};
const report=[],external=[];
const pass=(stage,detail)=>{report.push({stage,status:'SIMULATED PASS',detail});console.log('SIMULATED PASS:',stage,'—',detail);};
const note=(stage,status,detail)=>{report.push({stage,status,detail});console.log(status+':',stage,'—',detail);};
const one=async(sql,args=[])=>{const r=await q(sql,args);assert.equal(r.rows.length,1);return r.rows[0];};
const future=(days=1)=>new Date(Date.now()+days*86400000).toISOString();
const past=(days=1)=>new Date(Date.now()-days*86400000).toISOString();
const phone='+12145550123',businessNumber='+12145550199';
const providerAgent={conversation_config:{tts:{voice_id:'fixture_voice'},conversation:{max_duration_seconds:600},agent:{prompt:{tool_ids:['fixture_callback','fixture_handoff']}}}};
let titleFailure=false,callFailure=false,callComplete=false,signatureMode='waiting',signatureFailure=false,signatures=new Map(),nextSignature=100;
let propertyRequests=0,buyerRequests=0,voiceWrites=0,signatureWrites=0,titleWrites=0;
const property={dm_property_id:'prop_10001',full_address:'100 Simulation Lane, Dallas, TX 75217',address:'100 Simulation Lane',city:'Dallas',state:'TX',zip:'75217',legal_description:'SIMULATION ONLY LOT 1',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000,estimated_equity_percentage:75};
const providerFetch=async(url,options={})=>{
 const u=new URL(url);external.push({host:u.hostname,path:u.pathname,method:options.method??'GET'});
 if(u.hostname==='api.v2.dealmachine.com'&&u.pathname==='/v1/properties/search'){
  const body=JSON.parse(options.body),buyer=body.anchor==='people';
  if(body.estimate_cost)return Response.json({estimated_credits:{this_page:1,breakdown:buyer?{properties:0,people:1}:{people:0}}});
  if(buyer){buyerRequests++;return Response.json({data:[{dm_person_id:'per_fixture1',full_name:'SIMULATION Buyer LLC',property:{dm_property_id:'prop_10002',full_address:'SIMULATION buyer property'},phones:[{number:'+12145550124',do_not_call:false}],emails:[]}],credits:{used:1,people:1,properties:0},pagination:{has_next_page:false}});}
  propertyRequests++;return Response.json({data:[property],credits:{used:1,people:0},pagination:{has_next_page:false}});
 }
 if(u.hostname==='api.docuseal.com'){
  if(u.pathname==='/submissions'&&options.method==='POST'){
   signatureWrites++;if(signatureFailure)throw Error('SIMULATION ambiguous signature send timeout');
   const body=JSON.parse(options.body),id=++nextSignature;
   signatures.set(String(id),{id,submitters_order:'preserved',completed_at:null,submitters:body.submitters.map((s,i)=>({...s,id:id*10+i,submission_id:id,status:'awaiting',completed_at:null,slug:'simulation_only',values:(s.fields??[]).map(f=>({field:f.name,value:f.default_value}))}))});
   return Response.json(body.submitters.map(()=>({submission_id:id})));
  }
  const match=/^\/submissions\/(\d+)(\/documents)?$/.exec(u.pathname);assert(match,`Unimplemented signing fixture ${u.pathname}`);
  const submission=structuredClone(signatures.get(match[1]));assert(submission,'Unknown simulated submission');
  if(match[2])return Response.json([{url:'https://docuseal.com/blobs/simulation-only.pdf'}]);
  if(signatureMode==='out_of_order'){submission.submitters[1].status='completed';submission.submitters[1].completed_at=new Date().toISOString();}
  if(signatureMode==='seller_signed'||signatureMode==='completed')Object.assign(submission.submitters[0],{status:'completed',completed_at:new Date().toISOString()});
  if(signatureMode==='completed'){Object.assign(submission.submitters[1],{status:'completed',completed_at:new Date().toISOString()});submission.completed_at=new Date().toISOString();}
  return Response.json(submission);
 }
 if(u.hostname==='docuseal.com'&&u.pathname==='/blobs/simulation-only.pdf')return new Response('%PDF-1.4\nSIMULATION ONLY; not a signed agreement',{headers:{'Content-Type':'application/pdf'}});
 if(u.hostname==='api.resend.com'&&u.pathname==='/emails'){titleWrites++;if(titleFailure)throw Error('SIMULATION title send timeout');return Response.json({id:randomUUID()});}
 throw Error(`NETWORK BLOCKED: no fixture for ${url}`);
};
const elevenRequest=async(path,body)=>{
 external.push({host:'elevenlabs-fixture',path,method:body?'POST':'GET'});
 if(path==='/v1/convai/phone-numbers/fixture_number')return {phone_number:businessNumber};
 if(path==='/v1/convai/agents/agent_fixture')return providerAgent;
 if(path==='/v1/convai/twilio/outbound-call'){voiceWrites++;assert.equal(body.to_number,phone);assert.equal(body.call_recording_enabled,false);if(callFailure)throw Error('SIMULATION dial timeout');return {success:true,conversation_id:'conv_fixture1',callSid:'CA'+'1'.repeat(32)};}
 if(path==='/v1/convai/conversations/conv_fixture1')return {conversation_id:'conv_fixture1',agent_id:'agent_fixture',status:callComplete?'done':'processing',metadata:{call_duration_secs:3,cost:1,cost_fiat:0.01},transcript:[{role:'user',message:'I am interested in selling.'},{role:'user',message:'I accept $90,000.'}],analysis:{transcript_summary:'SIMULATION seller interest only',data_collection_results:{interested:{value:true},interest_quote:{value:'I am interested in selling.'}}}};
 throw Error('Unknown ElevenLabs fixture '+path);
};
try{await (async()=>{
 globalThis.fetch=providerFetch;
 Object.assign(process.env,{DEALMACHINE_API_KEY:'dm_sk_live_SIMULATION_NO_NETWORK',ELEVENLABS_API_KEY:'SIMULATION_NO_NETWORK',CONTIGUITY_FROM:businessNumber,DOCUSEAL_API_KEY:'SIMULATION_NO_NETWORK',DOCUSEAL_MODE:'live',RESEND_API_KEY:'SIMULATION_NO_NETWORK',RESEND_RECEIVING_WEBHOOK_SECRET:'SIMULATION_NO_NETWORK',ICASH_TITLE_FROM_EMAIL:'simulation@example.invalid',ICASH_TITLE_REPLY_EMAIL:'simulation-reply@example.invalid'});
 const costs=Object.fromEntries(costCategories.map(c=>[c,0]));
 await q('update icash_operation_rates set enabled=false');
 await q('update icash_signing_templates set enabled=false');
 const rates={};
 for(const operation of ['property_search','owner_enrichment','buyer_discovery','seller_call','buyer_call','contract_signing','title_email']){
  const category=operation.includes('call')?'elevenlabs':operation==='contract_signing'?'title_and_signing':operation==='title_email'?'email':'dealmachine';
  rates[operation]=(await one(`insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) values($1,'SIMULATION ONLY '||$1,1000,$2,'Synthetic cost evidence, no real quote',now()-interval '1 minute',now()+interval '7 days',true,$3) returning id`,[operation,{...costs,[category]:250000},operation.includes('call')?600:null])).id;
 }
 const draft=dealTermsSchema.parse({seller:'SIMULATION Seller',buyer:'SIMULATION Customer',address:property.full_address,legalDescription:property.legal_description,state:'TX',priceCents:9000000,priceSource:'seller_reported',earnestCents:0,closingDate:future(30).slice(0,10),escrowAgent:'SIMULATION Escrow',titleEmail:'escrow@example.invalid'});
 for(const kind of ['purchase','assignment'])await q(`insert into icash_signing_templates(state_code,kind,signer_count,provider_template_id,placeholder_names,field_map,reviewed_until,review_reference,test_mode,enabled,rate_id,provider) values('TX',$1,1,'123',$2,$3,now()+interval '7 days','SIMULATION template approval',false,true,$4,'docuseal') on conflict(state_code,kind,signer_count,test_mode) do update set enabled=true,field_map=excluded.field_map,reviewed_until=excluded.reviewed_until,rate_id=excluded.rate_id,provider='docuseal',provider_template_id='123'`,[kind,[kind==='purchase'?'Seller':'Assignee','Customer'],Object.fromEntries(Object.keys(signingFields(draft,kind)).map(k=>[k,k])),rates.contract_signing]);
 await q(`insert into icash_voice_production_template(id,enabled,agent_id,phone_number_id,agent_config_hash,required_tool_ids,seller_rate_id,buyer_rate_id,max_duration_seconds,reviewed_at,reviewed_until,evidence_ref) values(1,true,'agent_fixture','fixture_number',$1,ARRAY['fixture_callback','fixture_handoff'],$2,$3,600,now()-interval '1 minute',now()+interval '7 days','SIMULATION provider config review')`,[createHash('sha256').update(JSON.stringify(providerAgent.conversation_config)).digest('hex'),rates.seller_call,rates.buyer_call]);
 await q(`update icash_operating_budget set enabled=true,require_company_reserve=false,daily_limit_micros=1000000000`);
 const user=randomUUID(),otherUser=randomUUID(),operator=randomUUID();
 await q(`insert into auth.users(id,email,email_confirmed_at) values($1,'customer@example.invalid',now()),($2,'other@example.invalid',now()),($3,'operator@example.invalid',now())`,[user,otherUser,operator]);
 const guest='a'.repeat(64);
 const setup=await rpc('icash_init_bot_setup',{p_guest:guest});
 const saved=await rpc('icash_save_bot_setup',{p_setup:setup.id,p_revision:0,p_profile:{displayName:'Simulation Bot',marketMode:'nationwide'},p_stage:4});
 assert.equal(saved.stage,4);assert.equal(await rpc('icash_save_bot_setup',{p_setup:setup.id,p_revision:0,p_profile:{displayName:'Stale'},p_stage:1}),null);
 const order=(await one(`insert into icash_funding_orders(mode,guest_hash,pack_code,price_cents,credit_cents) values('live',$1,'work',10000,10000) returning id`,[guest])).id;
 const paid={p_order:order,p_mode:'live',p_session:'cs_live_SIMULATION',p_payment:'pi_SIMULATION',p_amount:10000,p_email:'customer@example.invalid',p_phone:null};
 await assert.rejects(rpc('icash_claim_funding',{p_user:user,p_mode:'live'}),/Fund account first/);
 await rpc('icash_settle_funding',paid);await rpc('icash_settle_funding',paid);
 await assert.rejects(rpc('icash_settle_funding',{...paid,p_amount:10001}),/Payment mismatch/);
 const account=await rpc('icash_claim_funding',{p_user:user,p_mode:'live'});
 assert.equal(await rpc('icash_claim_funding',{p_user:user,p_mode:'live'}),account);
 assert.equal(Number((await one('select balance_cents from icash_wallets where account_id=$1',[account])).balance_cents),10000);
 assert.equal(Number((await one('select count(*) n from icash_credit_ledger where account_id=$1',[account])).n),1);
 await rpc('icash_claim_bot_setup',{p_account:account});
 await rpc('icash_save_customer_identity',{p_user:user,p_first:'SIMULATION',p_last:'Customer',p_company:'',p_voice:'fixture_voice',p_voice_name:'Synthetic voice'});
 const provision=await rpc('icash_provision_funded_account',{p_account:account});assert.equal(provision.status,'configured');assert.equal(provision.zip,'75217');
 assert.equal((await one('select bot_paused from icash_accounts where id=$1',[account])).bot_paused,true);
 assert.equal(Number((await one('select count(*) n from icash_contact_permissions')).n),0);
 const otherAccount=await rpc('icash_create_account',{p_user:otherUser});
 await assert.rejects(rpc('icash_set_work_control',{p_user:otherUser,p_account:account,p_action:'resume'}),/ownership/);
 await q(`insert into icash_spend_activations(account_id,enabled,customer_cap_cents) values($1,true,10000)`,[account]);
 await q('update icash_accounts set daily_limit_cents=10000 where id=$1',[account]);
 await rpc('icash_set_work_control',{p_user:user,p_account:account,p_action:'resume'});
 pass('Setup → simulated payment receipt → confirmed identity → funded account', 'real setup/funding/credit/identity/provisioning RPCs; duplicate payment and claim produce one credit; paused and no contact permission by default');
 note('External sign-in and payment','NOT RUN','Supabase OTP/session verification and Stripe charge are fixture boundaries; auth.users is synthetic and funding receipt is not a real payment');
 const operating=await loadService('lib/operating-costs.ts',{db,validateCostManifest});
 const coverage=await loadService('lib/contract-coverage-service.ts',{db,contractCapability,reviewedContractCoverage});
 const discovery=await loadService('lib/discovery-service.ts',{db,dispatchReservedOperation:operating.dispatchReservedOperation,discoverPage,acquisitionContractCoverage:coverage.acquisitionContractCoverage});
 assert.equal((await coverage.acquisitionContractCoverage('38118')).supported,false);
 assert.equal((await discovery.discoverForAccount(account)).status,'screening_queued');assert.equal(propertyRequests,1);
 assert.equal(await tick(rpc),true);
 const screen=await one('select * from icash_screening_jobs where account_id=$1',[account]);assert.equal(screen.state,'complete');assert.equal(screen.result.financialCheck.status,'eligible');assert.equal(screen.result.outreachAuthorized,false);
 assert.equal((await discovery.discoverForAccount(account)).status,'not_ready');assert.equal(propertyRequests,1);
 pass('Covered market → reserved discovery → worker underwriting','actual discovery service, real spend reserve/claim/save RPCs, real worker tick; unsupported market rejected and repeated completed discovery makes no second provider request');
 // Continue below only through genuine implemented functions, with explicit synthetic evidence.
 await rpc('icash_queue_voice_jobs',{});
 assert.equal(Number((await one('select count(*) n from icash_voice_jobs')).n),0);
 const utcHour=new Date().getUTCHours(),offset=utcHour-12,zone=offset===0?'Etc/GMT':`Etc/GMT${offset>0?'+':'-'}${Math.abs(offset)}`;
 const reviewBase={screeningId:screen.id,stateCode:'TX',purpose:'SIMULATION property transaction only',sourceName:'SIMULATION evidence',evidenceReference:'SIMULATION ONLY, no contact permission outside ephemeral DB',evidenceObservedAt:past(0.01),expiresAt:future(1)};
 const contactPayload={...reviewBase,kind:'contact_permission',channel:'voice',party:'seller',buyerId:null,phone,timezone:zone,localStartHour:9,localEndHour:20};
 const requestKey=randomUUID();
 const contactReview=await rpc('icash_submit_authority_review',{p_account:account,p_user:user,p_key:requestKey,p_payload:contactPayload});
 assert.equal(contactReview.state,'submitted');assert.equal(Number((await one('select count(*) n from icash_contact_permissions')).n),0);
 assert.equal((await rpc('icash_submit_authority_review',{p_account:account,p_user:user,p_key:requestKey,p_payload:contactPayload})).id,contactReview.id);
 await assert.rejects(rpc('icash_submit_authority_review',{p_account:account,p_user:otherUser,p_key:randomUUID(),p_payload:contactPayload}),/ownership/);
 await assert.rejects(rpc('icash_decide_authority_review',{p_reviewer:user,p_request:contactReview.id,p_decision:'approved',p_note:'SIMULATION self approval rejected',p_verification:{}}),/operator/i);
 // These are explicit synthetic operator/legal/DNC fixture inputs. No live authority is created.
 await q(`insert into icash_trusted_operators(user_id,scopes,provisioned_by,expires_at) values($1,ARRAY['authority_review'],'SIMULATION ONLY provisioner',now()+interval '1 day')`,[operator]);
 const market=async(kind,channel)=>(await one(`insert into icash_authority_market_reviews(account_id,screening_id,state_code,kind,channel,source_reference,reviewed_by,reviewed_at,expires_at) values($1,$2,'TX',$3,$4,'SIMULATION reviewed market','SIMULATION reviewer',now()-interval '1 minute',now()+interval '2 days') returning id`,[account,screen.id,kind,channel])).id;
 const contactMarket=await market('contact_permission','voice');
 const verification={marketReviewId:contactMarket,reviewReference:'SIMULATION reviewed evidence',reviewedAt:past(0.001),validUntil:future(1),consentReference:'SIMULATION voice consent only',consentObservedAt:past(0.001)};
 const decide=(id,v)=>rpc('icash_decide_authority_review',{p_reviewer:operator,p_request:id,p_decision:'approved',p_note:'SIMULATION evidence approval only',p_verification:v});
 await assert.rejects(decide(contactReview.id,verification),/External DNC verification required/);
 const source=(await one(`insert into icash_dnc_verification_sources(name,source_reference,enabled,expires_at) values('SIMULATION DNC','SIMULATION isolated source',true,now()+interval '1 day') returning id`)).id;
 const receipt=(await one(`insert into icash_dnc_verification_receipts(source_id,phone,contact_key,provider_reference,receipt_hash,checked_at,expires_at,clear) values($1,$2,$3,'SIMULATION isolated receipt',$4,now()-interval '1 minute',now()+interval '1 day',true) returning id`,[source,phone,createHash('sha256').update(phone).digest('hex'),'b'.repeat(64)])).id;
 await decide(contactReview.id,{...verification,dncReceiptId:receipt});
 const permission=await one('select * from icash_contact_permissions where review_request_id=$1',[contactReview.id]);
 const offerReview=await rpc('icash_submit_authority_review',{p_account:account,p_user:user,p_key:randomUUID(),p_payload:{...reviewBase,kind:'offer_ceiling',channel:'offer',maxCents:9000000}});
 await decide(offerReview.id,{marketReviewId:await market('offer_ceiling','offer'),reviewReference:'SIMULATION reviewed offer limit',reviewedAt:past(0.001),validUntil:future(1),underwritingReference:'SIMULATION seller ceiling evidence',underwritingMaxCents:9000000});
 const voice=await loadService('lib/live-dispatch-service.ts',{createHash,randomBytes,db,elevenRequest,sameBusinessNumber,consistentTextSenders,boundedVoiceSmsContext,voiceSmsInstructions,buyerCallInstructions,contactEligibility,callEligibility,verifiedOfferCeiling,productionDealInstructions,acquisitionOpeners});
 const ticket=await rpc('icash_next_automation',{});assert(ticket?.token,'Voice job was not issued');
 const work=await rpc('icash_consume_automation',{p_token:ticket.token});assert.equal(work.kind,'voice_dispatch');assert.equal(await rpc('icash_consume_automation',{p_token:ticket.token}),null);
 assert.equal((await voice.dispatchLiveVoice(otherAccount,work.voiceJobId)).status,'held');assert.equal(voiceWrites,0);
 // Alternate timeout branch: discard the entire fixture transaction afterward.
 await q('begin');
 const branchClock=Date.now,branchTime=Number((await one('select floor(extract(epoch from now())*1000) as ms')).ms);
 Date.now=()=>branchTime;
 try{
  callFailure=true;
  assert.equal((await voice.dispatchLiveVoice(account,work.voiceJobId)).status,'provider_outcome_unknown_no_retry');
  assert.equal((await one('select state from icash_voice_jobs where id=$1',[work.voiceJobId])).state,'held');
  assert.equal((await one('select state from icash_operation_spend where operation_key=$1',['voice:'+work.voiceJobId])).state,'dispatched');
  const heldWallet=await one('select reserved_cents from icash_wallets where account_id=$1',[account]);assert(Number(heldWallet.reserved_cents)>=1000);
  assert.equal((await voice.dispatchLiveVoice(account,work.voiceJobId)).status,'held');assert.equal(voiceWrites,1);
 }finally{Date.now=branchClock;callFailure=false;voiceWrites=0;await q('rollback');}
 assert.equal((await voice.dispatchLiveVoice(account,work.voiceJobId)).status,'call_started');assert.equal(voiceWrites,1);
 assert.equal((await voice.dispatchLiveVoice(account,work.voiceJobId)).status,'held');assert.equal(voiceWrites,1);
 const live=await one('select * from icash_live_conversations where account_id=$1',[account]);
 assert.equal((await settleBoundVoiceUsage(db,account,live.id,[])).reason,'conversation_incomplete');
 const recon=await loadService('lib/live-conversation-service.ts',{database:db,elevenRequest,readVoiceUsagePolicies,settleBoundVoiceUsage,liveConversationResult});
 assert.equal((await recon.reconcileLiveConversation(account,live.id)).status,'awaiting_conversation');
 callComplete=true;
 const held=await recon.reconcileLiveConversation(account,live.id);assert.equal(held.billing.reason,'reviewed_policy_missing');
 const savedCall=await one('select * from icash_live_conversations where id=$1',[live.id]);assert.equal(savedCall.state,'complete');assert.equal(savedCall.result.underContract,false);
 const policy={enabled:true,version:'SIMULATION usage policy v1',rateId:rates.seller_call,operation:'seller_call',reviewedAt:past(1),validFrom:past(1),validUntil:future(1),evidenceRef:'SIMULATION complete cost basis',components:Object.fromEntries(costCategories.filter(c=>c!=='elevenlabs').map(c=>[c,c==='twilio'?{kind:'duration_estimate',unitSeconds:60,microsPerUnit:14000,rounding:'up',minimumUnits:0,durationSource:'conversation_proxy',assumption:'SIMULATION duration approximation',evidenceRef:'SIMULATION carrier price'}:{kind:'fixed_estimate',amountMicros:c==='support_and_overhead'?1000:0,evidenceRef:'SIMULATION explicit component'}]))};
 process.env.VOICE_USAGE_POLICIES_JSON=JSON.stringify([policy]);
 const settled=await recon.reconcileLiveConversation(account,live.id);assert.equal(settled.billing.status,'settled');
 const debitCount=Number((await one('select count(*) n from icash_credit_ledger where account_id=$1 and kind=\'usage\'',[account])).n);
 await recon.reconcileLiveConversation(account,live.id);assert.equal(Number((await one('select count(*) n from icash_credit_ledger where account_id=$1 and kind=\'usage\'',[account])).n),debitCount);
 const spend=await one('select * from icash_operation_spend where operation_key=$1',['voice:'+work.voiceJobId]);assert.equal(spend.state,'settled');assert.equal(spend.cost_basis,'estimated');assert(Number(spend.charged_cents)<1000);
 assert.equal((await recon.reconcileLiveConversation(otherAccount,live.id)).status,'not_found');
 pass('Reviewed contact/offer → one voice dispatch → transcript → usage ledger','real intake/reviewer/DNC checks, scheduler one-use ticket, voice service and SQL dispatch, provider-result reconciliation, held missing usage policy then resumed one debit; cross-account access and duplicate call blocked');
 note('Calling and permissions','SIMULATED EVIDENCE ONLY','Operator membership, legal/consent/DNC evidence and provider voice/audio results are local fixtures. No live phone call or valid real-world contact authority established');

 const prep=contractPreparation(savedCall.result.transcript.map((t,i)=>({id:'transcript-'+i,party:'seller',partyKey:permission.contact_key,body:t.message})),'draft',{...draft,priceCents:null});
 assert.equal(prep.patch.priceCents,9000000);assert.equal(prep.requiresReview,true);
 const reviewedTerms=fillEmptyTerms({...draft,priceCents:null},prep.patch);
 const dealId=await rpc('icash_prepare_deal',{p_account:account,p_screening:screen.id,p_terms:reviewedTerms});
 await assert.rejects(rpc('icash_prepare_deal',{p_account:otherAccount,p_screening:screen.id,p_terms:reviewedTerms}),/property missing/);
 const signing=await loadService('lib/signing-service.ts',{normalize,z,db,dispatchReservedOperation:operating.dispatchReservedOperation,signingReadiness,signingDocumentReadiness,signingTermsHash,signingFields,verifiedSigningStatus,dealTermsSchema});
 const signInput={accountId:account,userId:user,customerEmail:'customer@example.invalid',dealId,kind:'purchase',signers:[{name:'SIMULATION Seller',email:'seller@example.invalid'}]};
 await rpc('icash_prepare_deal',{p_account:account,p_screening:screen.id,p_terms:{...reviewedTerms,earnestCents:null}});
 await assert.rejects(signing.sendForSignatures(signInput),/earnest/);assert.equal(signatureWrites,0);
 await rpc('icash_prepare_deal',{p_account:account,p_screening:screen.id,p_terms:reviewedTerms});
 const purchase=await signing.sendForSignatures(signInput);assert.equal(signatureWrites,1);
 await assert.rejects(signing.sendForSignatures(signInput),/unique constraint/);assert.equal(signatureWrites,1);
 signatureMode='out_of_order';await assert.rejects(signing.refreshSigning(account,purchase.id),/Signing order mismatch/);
 assert.equal((await one('select stage from icash_deal_files where id=$1',[dealId])).stage,'draft');
 const advancePoll=async id=>q(`update icash_signing_envelopes set last_poll_at=now()-interval '2 minutes' where id=$1`,[id]);
 await advancePoll(purchase.id);signatureMode='seller_signed';
 assert.equal((await signing.refreshSigning(account,purchase.id)).status,'customer_signature_needed');
 assert.equal((await one('select stage from icash_deal_files where id=$1',[dealId])).stage,'draft');
 assert.equal(Number((await one('select count(*) n from icash_signature_authorizations')).n),0);
 await advancePoll(purchase.id);signatureMode='completed';
 assert.equal((await signing.refreshSigning(account,purchase.id)).status,'completed');
 assert.equal((await signing.refreshSigning(account,purchase.id)).status,'completed');
 assert.equal((await one('select stage from icash_deal_files where id=$1',[dealId])).stage,'under_contract');
 assert.equal((await signing.refreshSigning(otherAccount,purchase.id)).status,'needs_review');
 pass('Transcript → reviewed draft → seller-first purchase signatures','real preparation policy and deal/signing services/RPCs; incomplete earnest blocks send; duplicate send cannot replay; out-of-order signatures rejected; seller signature alone cannot create a contract; synthetic completed provider evidence advances stage exactly once');
 const buyerService=await loadService('lib/buyer-discovery-service.ts',{db,discoverBuyerPage});
 const titleService=await loadService('lib/title-service.ts',{db,titleConfirmationInstructions,reserveOperation:operating.reserveOperation,completedSigningPdf:signing.completedSigningPdf});
 const titleDirectory=await loadService('lib/title-directory-service.ts',{db,reserveOperation:operating.reserveOperation});
 const titleSearch=await loadService('lib/title-search-service.ts',{db});
 const emailService=await loadService('lib/deal-email-service.ts',{db,titleEmailAddress,emailFromName});
 const buyerPackage=await loadService('lib/buyer-package-email.ts',{db,createHash,dealTermsSchema,...emailService});
 const fulfillment=await loadService('lib/fulfillment-service.ts',{db,z,planBuyerOutreach,dealTermsSchema,renderDealDocument,...buyerService,...titleService,...titleDirectory,...titleSearch,...buyerPackage});
 // Optional clean title-first order uses actual sent title request and authenticated
 // milestone handling before any buyer discovery, qualification or marketing review.
 if(titleFirstStage){
  await q(`insert into icash_title_contacts(account_id,deal_id,email,verified_until,evidence_ref,rate_id,enabled) values($1,$2,'escrow@example.invalid',now()+interval '1 day','SIMULATION reviewed title contact',$3,true)`,[account,dealId,rates.title_email]);
  const early=await rpc('icash_prepare_title_request',{p_account:account,p_deal:dealId});
  assert.equal((await titleService.dispatchTitleRequest(account,early.id)).status,'title_request_sent');
  const earlyReply=(kind,date='none')=>rpc('icash_record_title_reply',{p_email:randomUUID(),p_kind:'T',p_reference:early.id,p_sender:'escrow@example.invalid',p_subject:'SIMULATION title before sourcing',p_text:`ICASH CONFIRMATION\nStatus: ${kind}\nDate: ${date}\nAmount cents: none\nFile: SIMULATION-EARLY\nEND ICASH CONFIRMATION`,p_authenticated:true});
  await earlyReply('title_opened');
  if(titleFirstStage==='closing')await earlyReply('closing_scheduled',(await one("select (now() at time zone 'America/Chicago')::date::text as day")).day);
  assert.equal((await one('select stage from icash_deal_files where id=$1',[dealId])).stage,titleFirstStage);
  assert.equal(Number((await one('select count(*) n from icash_buyer_profiles')).n),0);
  pass('Title milestone before any buyer discovery',`actual title dispatch and milestone establish ${titleFirstStage}; no buyer business state injected`);
 }
 const fulfilTicket=await rpc('icash_next_automation',{});const fulfilWork=await rpc('icash_consume_automation',{p_token:fulfilTicket.token});assert.equal(fulfilWork.kind,'fulfillment');
 assert.equal((await fulfillment.prepareFulfillment(account,fulfilWork.fulfillmentJobId)).status,'fulfillment_prepared');
 const prepared=await one('select * from icash_fulfillment_jobs where id=$1',[fulfilWork.fulfillmentJobId]);
 assert.equal(prepared.state,'complete');assert.equal(prepared.result.buyerStatus,'marketing_review_required');
 assert.equal(prepared.result.buyerDiscovery.status,'buyers_saved');assert.equal(buyerRequests,1);
 assert.equal(prepared.result.titleStatus,'title_automation_paused');assert.equal(prepared.result.closed,false);assert.equal(prepared.result.depositReceived,false);
 assert.equal(Number((await one('select count(*) n from icash_deal_documents where fulfillment_job_id=$1',[prepared.id])).n),2);
 const buyer=await one('select * from icash_buyer_profiles where account_id=$1',[account]);assert.deepEqual(buyer.criteria,{});
 assert.equal(Number((await one("select count(*) n from icash_contact_permissions where party='buyer'")).n),0);
 assert.equal((await buyerService.discoverBuyersForDeal(account,dealId)).status,'buyer_search_complete');assert.equal(buyerRequests,1);
 pass('Signed purchase → fulfillment → buyer discovery and document preparation','actual fulfillment service/scheduler with real dependent services and database: two documents saved, buyer discovery bounded/idempotent, no invented buyer criteria, contact permission, marketing release, deposit or close');
 // Exercise a normal customer action: adding assignment-specific terms after the purchase.
 const assignmentTerms={...reviewedTerms,assignee:'SIMULATION Buyer LLC',assignmentFeeCents:1000000,assignmentDepositCents:500000};
 assert.equal(await rpc('icash_prepare_deal',{p_account:account,p_screening:screen.id,p_terms:assignmentTerms}),dealId);
 const marketingPayload={...reviewBase,kind:'marketing_release',channel:'buyer_marketing',dealId,purchaseEnvelopeId:purchase.id,termsHash:signingTermsHash(reviewedTerms),market:'Dallas',propertyType:'house',repairsCents:4000000,maxCents:10000000,marketingScope:'assignment_interest'};
 const marketingReview=await rpc('icash_submit_authority_review',{p_account:account,p_user:user,p_key:randomUUID(),p_payload:marketingPayload});
 const pdf=await signing.completedSigningPdf(account,purchase.id);
 const marketingVerification={marketReviewId:await market('marketing_release','buyer_marketing'),reviewReference:'SIMULATION marketing verification',reviewedAt:past(0.001),validUntil:future(1),marketingRightsReference:'SIMULATION assignment rights',signedDocumentHash:createHash('sha256').update(Buffer.from(pdf)).digest('hex'),signedDocumentCheckedAt:past(0.00001)};
 // Tamper each purchase-bound field in an isolated rollback branch. No business
 // state is repaired manually: each branch is discarded before the main path.
 const assignmentOnly=new Set(['assignee','assignmentFeeCents','assignmentDepositCents','payoutMethod','payoutHandle']);
 let materialRejections=0;
 for(const [field,value] of Object.entries(reviewedTerms).filter(([field])=>!assignmentOnly.has(field))){
  await q('begin');
  try{
   const changed={...reviewedTerms,[field]:typeof value==='number'?value+1:value===null?1:'DIFFERENT '+value};
   await q('update icash_signing_envelopes set terms=$1 where id=$2',[changed,purchase.id]);
   await assert.rejects(decide(marketingReview.id,marketingVerification),/Current actual purchase and terms hash required/);materialRejections++;
  }finally{await q('rollback');}
 }
 assert.equal(Number((await one('select count(*) n from icash_disposition_authorities')).n),0);
 assert.equal((await decide(marketingReview.id,marketingVerification)).state,'approved');
 const approvedRelease=await one('select * from icash_disposition_authorities where deal_id=$1',[dealId]);assert.equal(Number(approvedRelease.asking_price_cents),10000000);assert.equal(approvedRelease.terms_hash,signingTermsHash(reviewedTerms));
 // A later allowed fee edit still revokes the prior grant and requires a new exact review.
 const updatedFeeTerms={...assignmentTerms,assignmentFeeCents:1000001};
 await rpc('icash_prepare_deal',{p_account:account,p_screening:screen.id,p_terms:updatedFeeTerms});
 assert.equal((await one('select state from icash_authority_review_requests where id=$1',[marketingReview.id])).state,'revoked');
 const staleReview=await rpc('icash_submit_authority_review',{p_account:account,p_user:user,p_key:randomUUID(),p_payload:marketingPayload});
 await assert.rejects(decide(staleReview.id,marketingVerification),/Exact asking price and assignment fee required/);
 // Restore customer-requested terms using the real permitted edit API, then obtain
 // a new review. Never rewrite the signed purchase or resurrect the prior grant.
 await rpc('icash_prepare_deal',{p_account:account,p_screening:screen.id,p_terms:assignmentTerms});
 const freshMarketing=await rpc('icash_submit_authority_review',{p_account:account,p_user:user,p_key:randomUUID(),p_payload:marketingPayload});
 assert.equal((await decide(freshMarketing.id,marketingVerification)).state,'approved');
 pass('Purchase-bound marketing approval after assignment additions',`narrow fix verified: ${materialRejections} purchase-material field changes rejected; assignment-only additions allowed with fresh review; later fee change revokes approval; stale asking price rejected; original signed terms/hash unchanged`);

 // Advance scheduler fairness timestamps only; never write a completed business state.
 await q("update icash_fulfillment_jobs set updated_at=now()-interval '2 days' where id=$1",[prepared.id]);
 await q("update icash_automation_tickets set created_at=now()-interval '2 minutes' where kind='fulfillment'");
 const againTicket=await rpc('icash_next_automation',{}),againWork=await rpc('icash_consume_automation',{p_token:againTicket.token});assert.equal(againWork.kind,'fulfillment');
 await fulfillment.prepareFulfillment(account,againWork.fulfillmentJobId);
 const afterReview=await one('select * from icash_fulfillment_jobs where id=$1',[prepared.id]);assert.equal(afterReview.result.buyerStatus,'buyer_sourcing_required');assert.equal(afterReview.result.buyerCount,0);
 assert.equal(Number((await one('select count(*) n from icash_deal_documents where fulfillment_job_id=$1',[prepared.id])).n),2);
 const buyerPhone='+12145550124';
 const buyerPayload={buyerId:buyer.id,dealId,markets:['Dallas'],propertyTypes:['house'],maxPriceCents:12000000,maxRepairCents:5000000,criteriaObservedAt:past(0.01),expiresAt:future(1),sourceName:'SIMULATION buyer statement',sourceReference:'SIMULATION buyer criteria source',buyerStatement:'SIMULATION ONLY: buyer reports Dallas houses up to the stated budgets.'};
 const qualificationKey=randomUUID();
 const options=await rpc('icash_buyer_qualification_options',{p_account:account,p_deal:dealId});assert.equal(options[0].buyerId,buyer.id);
 const qualification=await rpc('icash_submit_buyer_qualification',{p_account:account,p_user:user,p_key:qualificationKey,p_payload:buyerPayload});
 assert.equal(qualification.state,'submitted');assert.deepEqual((await one('select criteria from icash_buyer_profiles where id=$1',[buyer.id])).criteria,{});
 assert.equal((await rpc('icash_submit_buyer_qualification',{p_account:account,p_user:user,p_key:qualificationKey,p_payload:buyerPayload})).id,qualification.id);
 await assert.rejects(rpc('icash_submit_buyer_qualification',{p_account:account,p_user:user,p_key:qualificationKey,p_payload:{...buyerPayload,maxPriceCents:12000001}}),/Idempotency payload conflict/);
 await assert.rejects(rpc('icash_submit_buyer_qualification',{p_account:otherAccount,p_user:otherUser,p_key:randomUUID(),p_payload:buyerPayload}),/Owned current buyer candidate/);
 await assert.rejects(rpc('icash_submit_buyer_qualification',{p_account:account,p_user:user,p_key:randomUUID(),p_payload:{...buyerPayload,permitted:true,proofOfFundsVerifiedAt:Date.now()}}),/Unsupported buyer claim/);
 const buyerVerification={criteriaConfirmed:true,fundsVerified:true,signatoryVerified:true,reviewReference:'SIMULATION explicit human review',validUntil:future(1),fundsReference:'SIMULATION reviewed bank-source reference',fundsObservedAt:past(0.001),fundsAmountCents:12000000,currency:'USD',signatoryName:'SIMULATION Authorized Buyer',authorityReference:'SIMULATION reviewed entity-signatory source',authorityObservedAt:past(0.001)};
 const qualify=(id,verification=buyerVerification)=>rpc('icash_decide_buyer_qualification',{p_reviewer:operator,p_request:id,p_decision:'approved',p_note:'SIMULATION reviewed source evidence only',p_verification:verification});
 await assert.rejects(rpc('icash_decide_buyer_qualification',{p_reviewer:user,p_request:qualification.id,p_decision:'approved',p_note:'SIMULATION self approval attempt',p_verification:buyerVerification}),/Trusted authority reviewer required/);
 await assert.rejects(qualify(qualification.id,{}),/Actual human review/);
 await assert.rejects(qualify(qualification.id,{...buyerVerification,fundsAmountCents:11999999}),/Verified funds must cover/);
 await assert.rejects(qualify(qualification.id,{...buyerVerification,authorityObservedAt:future(1)}),/Dated funds and authority evidence/);
 await q('begin');try{await q("update icash_trusted_operators set scopes=ARRAY['support'] where user_id=$1",[operator]);await assert.rejects(qualify(qualification.id),/Trusted authority reviewer/);}finally{await q('rollback');}
 assert.deepEqual(await rpc('icash_reviewed_buyers',{p_account:account,p_deal:dealId}),[]);
 const approvedBuyer=await qualify(qualification.id);assert.equal(approvedBuyer.state,'approved');
 assert.equal((await qualify(qualification.id)).id,qualification.id);
 await assert.rejects(qualify(qualification.id,{...buyerVerification,fundsAmountCents:12000001}),/Conflicting review retry/);
 const qualified=await one('select * from icash_buyer_profiles where id=$1',[buyer.id]);
 assert.equal(qualified.criteria.permitted,false);assert.equal(qualified.criteria.completedDeals,null);assert.equal(qualified.criteria.failedDeals,null);assert.equal(qualified.criteria.estimatedContactChargeCents,1000);
 assert.equal(Number((await one("select count(*) n from icash_contact_permissions where party='buyer'")).n),0);
 assert.deepEqual(await rpc('icash_reviewed_buyers',{p_account:otherAccount,p_deal:dealId}),[]);
 const reviewedBuyers=await rpc('icash_reviewed_buyers',{p_account:account,p_deal:dealId});assert.equal(reviewedBuyers.length,1);assert.equal(reviewedBuyers[0].criteria.permitted,false);
 await q("update icash_automation_tickets set created_at=now()-interval '2 minutes' where kind='fulfillment'");
 const qualifiedTicket=await rpc('icash_next_automation',{}),qualifiedWork=await rpc('icash_consume_automation',{p_token:qualifiedTicket.token});assert.equal(qualifiedWork.kind,'fulfillment');
 await fulfillment.prepareFulfillment(account,qualifiedWork.fulfillmentJobId);
 const matched=await one('select * from icash_buyer_matches where deal_id=$1 and buyer_id=$2',[dealId,buyer.id]);assert.equal(matched.ready,true);assert.equal(matched.score,70);
 assert.equal((await one('select result from icash_fulfillment_jobs where id=$1',[prepared.id])).result.buyerStatus,'matches_ready_outreach_not_sent');
 assert.equal(voiceWrites,1,'Qualification never dials a buyer');
 // Expiry is enforced at query/context time, independent of scheduler cleanup.
 await q('begin');try{await q("update icash_buyer_profiles set qualification_expires_at=now()-interval '1 second' where id=$1",[buyer.id]);assert.deepEqual(await rpc('icash_reviewed_buyers',{p_account:account,p_deal:dealId}),[]);}finally{await q('rollback');}
 // A failure at the final audit insert rolls back profile replacement and prior revocation.
 const replacement=await rpc('icash_submit_buyer_qualification',{p_account:account,p_user:user,p_key:randomUUID(),p_payload:buyerPayload});
 await q(`create function pg_temp.fail_buyer_approval() returns trigger language plpgsql as $$begin if new.event='approved' then raise exception 'SIMULATION final approval audit failure';end if;return new;end$$`);
 await q('create trigger simulation_buyer_failure before insert on icash_buyer_qualification_audit for each row execute function pg_temp.fail_buyer_approval()');
 await assert.rejects(qualify(replacement.id),/SIMULATION final approval audit failure/);
 await q('drop trigger simulation_buyer_failure on icash_buyer_qualification_audit');
 assert.equal((await one('select qualification_request_id from icash_buyer_profiles where id=$1',[buyer.id])).qualification_request_id,qualification.id);
 assert.equal((await one('select state from icash_buyer_qualification_requests where id=$1',[qualification.id])).state,'approved');
 assert.equal((await one('select state from icash_buyer_qualification_requests where id=$1',[replacement.id])).state,'submitted');
 await assert.rejects(rpc('icash_withdraw_buyer_qualification',{p_account:otherAccount,p_user:otherUser,p_request:qualification.id}),/query returned no rows/);
 await rpc('icash_withdraw_buyer_qualification',{p_account:account,p_user:user,p_request:qualification.id});
 assert.deepEqual(await rpc('icash_reviewed_buyers',{p_account:account,p_deal:dealId}),[]);
 assert.equal(Number((await one('select count(*) n from icash_buyer_matches where buyer_id=$1',[buyer.id])).n),0);
 assert.equal((await qualify(replacement.id)).state,'approved');
 // Contact is a separate genuine reviewed-authority flow, not a qualification flag.
 const buyerContactPayload={...contactPayload,party:'buyer',buyerId:buyer.id,phone:buyerPhone};
 const buyerContactReview=await rpc('icash_submit_authority_review',{p_account:account,p_user:user,p_key:randomUUID(),p_payload:buyerContactPayload});
 const buyerDnc=(await one(`insert into icash_dnc_verification_receipts(source_id,phone,contact_key,provider_reference,receipt_hash,checked_at,expires_at,clear) values($1,$2,$3,'SIMULATION buyer DNC receipt',$4,now()-interval '1 minute',now()+interval '1 day',true) returning id`,[source,buyerPhone,createHash('sha256').update(buyerPhone).digest('hex'),'c'.repeat(64)])).id;
 await decide(buyerContactReview.id,{...verification,dncReceiptId:buyerDnc});
 const buyerPermission=await one('select id from icash_contact_permissions where review_request_id=$1',[buyerContactReview.id]);
 assert.equal(await rpc('icash_buyer_contact_current',{p_account:account,p_buyer:buyer.id,p_screening:screen.id,p_phone:buyerPhone}),true);
 assert.equal((await rpc('icash_reviewed_buyers',{p_account:account,p_deal:dealId}))[0].criteria.permitted,true);
 assert.equal((await one('select criteria from icash_buyer_profiles where id=$1',[buyer.id])).criteria.permitted,false);
 await q("update icash_automation_tickets set created_at=now()-interval '2 minutes' where kind='fulfillment'");
 const rematchTicket=await rpc('icash_next_automation',{}),rematchWork=await rpc('icash_consume_automation',{p_token:rematchTicket.token});assert.equal(rematchWork.kind,'fulfillment');
 await fulfillment.prepareFulfillment(account,rematchWork.fulfillmentJobId);
 assert((await rpc('icash_buyer_voice_context',{p_permission:buyerPermission.id}))?.dealId===dealId);
 await q('begin');try{
  await q("insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION opt-out')",[buyerPhone]);
  assert.equal(await rpc('icash_buyer_contact_current',{p_account:account,p_buyer:buyer.id,p_screening:screen.id,p_phone:buyerPhone}),false);
  assert.equal(await rpc('icash_buyer_voice_context',{p_permission:buyerPermission.id}),null);
 }finally{await q('rollback');}
 assert.equal((await one("select has_table_privilege('authenticated','public.icash_buyer_qualification_requests','SELECT') as exposed")).exposed,false);
 assert.equal((await one("select has_function_privilege('anon','public.icash_decide_buyer_qualification(uuid,uuid,text,text,jsonb)','EXECUTE') as exposed")).exposed,false);
 const currentBuyerContext=await rpc('icash_buyer_voice_context',{p_permission:buyerPermission.id});assert.equal(currentBuyerContext.qualificationRequestId,replacement.id);
 for(const invalidate of [
  ()=>q('update icash_operation_rates set enabled=false where id=$1',[rates.buyer_call]),
  ()=>q("update icash_buyer_candidates set rights_until=now()-interval '1 second' where buyer_id=$1 and deal_id=$2",[buyer.id,dealId]),
  ()=>q("update icash_buyer_profiles set criteria=jsonb_set(criteria,'{authorityVerified}','false') where id=$1",[buyer.id]),
 ]){
  await q('begin');try{await invalidate();assert.deepEqual(await rpc('icash_reviewed_buyers',{p_account:account,p_deal:dealId}),[]);assert.equal(await rpc('icash_buyer_voice_context',{p_permission:buyerPermission.id}),null);}finally{await q('rollback');}
 }
 await q('begin');try{await q('update icash_buyer_matches set qualification_request_id=null where deal_id=$1 and buyer_id=$2',[dealId,buyer.id]);assert.equal(await rpc('icash_buyer_voice_context',{p_permission:buyerPermission.id}),null);}finally{await q('rollback');}
 const unrelatedPending=await rpc('icash_submit_buyer_qualification',{p_account:account,p_user:user,p_key:randomUUID(),p_payload:buyerPayload});
 await rpc('icash_withdraw_buyer_qualification',{p_account:account,p_user:user,p_request:unrelatedPending.id});
 assert.equal((await one('select qualification_request_id from icash_buyer_matches where deal_id=$1 and buyer_id=$2',[dealId,buyer.id])).qualification_request_id,replacement.id);
 // Reject a stale planner snapshot at the actual atomic persistence boundary.
 await q('begin');try{
  await q("update icash_fulfillment_jobs set updated_at=now()-interval '2 days' where id=$1",[prepared.id]);
  await q("update icash_automation_tickets set created_at=now()-interval '2 minutes' where kind='fulfillment'");
  const t=await rpc('icash_next_automation',{}),w=await rpc('icash_consume_automation',{p_token:t.token});assert.equal(w.kind,'fulfillment');
  await rpc('icash_withdraw_buyer_qualification',{p_account:account,p_user:user,p_request:replacement.id});
  assert.equal(Number((await one('select count(*) n from icash_buyer_matches where deal_id=$1 and buyer_id=$2',[dealId,buyer.id])).n),0);
  await assert.rejects(rpc('icash_save_fulfillment',{p_job:w.fulfillmentJobId,p_result:{},p_documents:[],p_matches:[{id:buyer.id,score:70,ready:true,rank:1,sourceRef:buyer.source_ref,qualificationRequestId:replacement.id}]}),/Current buyer qualification required/);
 }finally{await q('rollback');}
 // Reject withdrawal after context planning/reservation but before the final claim.
 await q('begin');try{
  await q("update icash_voice_scheduler set last_dispatch_at=now()-interval '1 minute' where id=1");
  const t=await rpc('icash_next_automation',{}),w=await rpc('icash_consume_automation',{p_token:t.token});assert.equal(w.kind,'voice_dispatch');
  assert.equal(await rpc('icash_reserve_paced_voice',{p_account:account,p_job:w.voiceJobId,p_rate:rates.buyer_call,p_permission_until:future(1),p_financial_checked_at:null,p_financial_eligible:false}),true);
  await rpc('icash_withdraw_buyer_qualification',{p_account:account,p_user:user,p_request:replacement.id});
  assert.equal(await rpc('icash_claim_reviewed_voice_job',{p_job:w.voiceJobId,p_offer_snapshot:null,p_buyer_snapshot:currentBuyerContext}),false);
  assert.equal((await one('select state from icash_voice_jobs where id=$1',[w.voiceJobId])).state,'issued');
 }finally{await q('rollback');}
 pass('Discovered buyer → genuine human-reviewed qualification → existing match','real immutable tenant intake and authority-review writer; claims cannot verify themselves; current funds/signatory evidence, server quote, unknown history, expiry/revoke/atomic rollback all checked; fulfillment creates ready match; contact remains separate and derived from actual approved permission with suppression rechecked');
 note('Buyer evidence','SIMULATED HUMAN REVIEW ONLY','The writer is real; buyer statements, fund-source reference and signatory review are synthetic. No bank account, proof-of-funds document, real buyer or consent was verified');
 if(titleFirstStage){
  // Exercise the actual atomic final claim; no provider dial is made by this branch.
  await q('begin');try{
   await q("update icash_voice_scheduler set last_dispatch_at=now()-interval '1 minute' where id=1");
   const t=await rpc('icash_next_automation',{}),w=await rpc('icash_consume_automation',{p_token:t.token});assert.equal(w.kind,'voice_dispatch');
   assert.equal(await rpc('icash_reserve_paced_voice',{p_account:account,p_job:w.voiceJobId,p_rate:rates.buyer_call,p_permission_until:future(1),p_financial_checked_at:null,p_financial_eligible:false}),true);
   assert.equal(await rpc('icash_claim_reviewed_voice_job',{p_job:w.voiceJobId,p_offer_snapshot:null,p_buyer_snapshot:currentBuyerContext}),true);
   assert.equal(await rpc('icash_claim_reviewed_voice_job',{p_job:w.voiceJobId,p_offer_snapshot:null,p_buyer_snapshot:currentBuyerContext}),false);
   assert.equal((await one('select stage from icash_deal_files where id=$1',[dealId])).stage,titleFirstStage);
   assert.equal(voiceWrites,1,'SQL claim simulation does not dial buyer');
  }finally{await q('rollback');}
  pass('Title-first discovery → reviewed marketing/qualification → final buyer claim',`clean ${titleFirstStage} order reaches real atomic buyer dispatch claim once; all stale source, quote, revision, withdrawal, suppression and cross-account checks above also pass`);
  console.log(`\nSIMULATION SUMMARY (${titleFirstStage} before sourcing): ${report.filter(x=>x.status==='SIMULATED PASS').length} stages passed; ${files.length} actual schema/config files; ${calls.filter(x=>x.rpc).length} real RPC calls; ${external.length} intercepted provider fixture requests. Buyer provider dial and later close are not run in this variant.`);
  return;
 }
 const assignmentInput={...signInput,kind:'assignment',signers:[{name:'SIMULATION Buyer LLC',email:'buyer@example.invalid'}]};
 // Both title-first orders start from the same real signed purchase in separate
 // discarded fixture transactions; no completed business stage is injected.
 for(const titleStage of ['title_open','closing']){
  await q('begin');
  try{
   await q(`insert into icash_title_contacts(account_id,deal_id,email,verified_until,evidence_ref,rate_id,enabled) values($1,$2,'escrow@example.invalid',now()+interval '1 day','SIMULATION reviewed title contact',$3,true)`,[account,dealId,rates.title_email]);
   const earlyTitle=await rpc('icash_prepare_title_request',{p_account:account,p_deal:dealId});
   assert.equal((await titleService.dispatchTitleRequest(account,earlyTitle.id)).status,'title_request_sent');
   const day=(await one("select (now() at time zone 'America/Chicago')::date::text as day")).day;
   const earlyReply=(kind,date='none',amount='none')=>rpc('icash_record_title_reply',{p_email:randomUUID(),p_kind:'T',p_reference:earlyTitle.id,p_sender:'escrow@example.invalid',p_subject:'SIMULATION early title',p_text:`ICASH CONFIRMATION\nStatus: ${kind}\nDate: ${date}\nAmount cents: ${amount}\nFile: SIMULATION-EARLY\nEND ICASH CONFIRMATION`,p_authenticated:true});
   await earlyReply('title_opened');if(titleStage==='closing')await earlyReply('closing_scheduled',day);
   assert.equal((await one('select stage from icash_deal_files where id=$1',[dealId])).stage,titleStage);
   const titleTerms={...assignmentTerms,assignmentDepositCents:500001};
   assert.equal(await rpc('icash_prepare_deal',{p_account:account,p_screening:screen.id,p_terms:titleTerms}),dealId);
   assert.equal((await one('select stage from icash_deal_files where id=$1',[dealId])).stage,titleStage);
   const titleAssignment=await signing.sendForSignatures(assignmentInput);
   signatureMode='out_of_order';await assert.rejects(signing.refreshSigning(account,titleAssignment.id),/Signing order mismatch/);
   assert.equal((await one('select assignment_signed_at from icash_deal_files where id=$1',[dealId])).assignment_signed_at,null);
   await advancePoll(titleAssignment.id);signatureMode='seller_signed';assert.equal((await signing.refreshSigning(account,titleAssignment.id)).status,'customer_signature_needed');
   await advancePoll(titleAssignment.id);signatureMode='completed';assert.equal((await signing.refreshSigning(account,titleAssignment.id)).status,'completed');
   const completedAssignment=await one('select stage,assignment_signed_at from icash_deal_files where id=$1',[dealId]);assert.equal(completedAssignment.stage,titleStage);assert(completedAssignment.assignment_signed_at);
   assert.equal((await signing.refreshSigning(account,titleAssignment.id)).status,'completed');
   await earlyReply('deposit_received','none','500001');await earlyReply('closed',day);
   assert.equal((await one('select stage from icash_deal_files where id=$1',[dealId])).stage,'closed');
   await assert.rejects(signing.sendForSignatures(assignmentInput),/signed purchase agreement, buyer, fee, deposit and escrow company are required/);
   // SQL also blocks a caller bypassing JS readiness after close.
   await assert.rejects(rpc('icash_begin_signing',{p_user:user,p_account:account,p_deal:dealId,p_kind:'assignment',p_template:(await one("select id from icash_signing_templates where kind='assignment' and enabled and not test_mode")).id,p_hash:signingTermsHash(titleTerms),p_recipients:[{id:'1',name:'SIMULATION Buyer LLC',email:'buyer@example.invalid'},{id:'2',name:'SIMULATION Customer',email:'customer@example.invalid'}]}),/Executed purchase required/);
  }finally{signatureMode='completed';await q('rollback');}
 }
 pass('Title-first assignment ordering','narrow fix verified in both title_open and closing: real permitted assignment edit/send/ordered signatures stamp assignment_signed_at without regressing title stage, duplicates/out-of-order rejected; both branches reach close and JS/SQL reject signing after close');
 // An unknown signature send is held, not resent. Rollback discards this entire
 // alternate simulation branch; it is not a product recovery implementation.
 await q('begin');
 try{
  const before=signatureWrites;signatureFailure=true;
  await assert.rejects(signing.sendForSignatures(assignmentInput),/SIMULATION ambiguous/);
  const unknown=await one("select * from icash_signing_envelopes where deal_id=$1 and kind='assignment'",[dealId]);assert.equal(unknown.state,'needs_review');
  assert.equal((await signing.refreshSigning(account,unknown.id)).status,'needs_review');assert.equal(signatureWrites,before+1);
 }finally{signatureFailure=false;await q('rollback');}
 const assignment=await signing.sendForSignatures(assignmentInput);signatureMode='completed';
 assert.equal((await signing.refreshSigning(account,assignment.id)).status,'completed');
 assert.equal((await one('select stage from icash_deal_files where id=$1',[dealId])).stage,'buyer_selected');
 assert.equal((await signing.refreshSigning(account,assignment.id)).status,'completed');
 await assert.rejects(rpc('icash_prepare_deal',{p_account:account,p_screening:screen.id,p_terms:{...assignmentTerms,priceCents:9000001}}),/amendment|frozen/);
 pass('Customer-supplied assignee → assignment signatures','actual assignment service/RPC; unknown provider send remains needs_review with no replay; successful independent branch verifies exact parties/signatures and advances buyer_selected; purchase terms stay frozen');
 // Verified title-contact provisioning remains explicit external review evidence.
 await q(`insert into icash_title_contacts(account_id,deal_id,email,verified_until,evidence_ref,rate_id,enabled) values($1,$2,'escrow@example.invalid',now()+interval '1 day','SIMULATION reviewed title contact',$3,true)`,[account,dealId,rates.title_email]);
 const title=await rpc('icash_prepare_title_request',{p_account:account,p_deal:dealId});
 assert.equal((await rpc('icash_prepare_title_request',{p_account:account,p_deal:dealId})).id,title.id);
 await assert.rejects(rpc('icash_prepare_title_request',{p_account:otherAccount,p_deal:dealId}),/Verified title contact/);
 await q('begin');
 try{
  titleFailure=true;const before=titleWrites;
  assert.equal((await titleService.dispatchTitleRequest(account,title.id)).status,'title_delivery_needs_reconciliation');
  assert.equal((await one('select state from icash_title_requests where id=$1',[title.id])).state,'needs_review');
  await titleService.dispatchTitleRequest(account,title.id);assert.equal(titleWrites,before+1);
  assert.equal((await one('select stage from icash_deal_files where id=$1',[dealId])).stage,'buyer_selected');
  assert.equal((await one('select state from icash_operation_spend where operation_key=$1',['title:'+title.id])).state,'dispatched');
 }finally{titleFailure=false;await q('rollback');}
 const titleBefore=titleWrites;assert.equal((await titleService.dispatchTitleRequest(account,title.id)).status,'title_request_sent');
 await titleService.dispatchTitleRequest(account,title.id);assert.equal(titleWrites,titleBefore+1);
 assert.equal((await one('select stage from icash_deal_files where id=$1',[dealId])).stage,'buyer_selected');
 const today=(await one("select (now() at time zone 'America/Chicago')::date::text as day")).day;
 const titleReply=async(kind,{authenticated=true,sender='escrow@example.invalid',date='none',amount='none',id=randomUUID(),prefix=''}={})=>{
  await rpc('icash_record_title_reply',{p_email:id,p_kind:'T',p_reference:title.id,p_sender:sender,p_subject:'SIMULATION confirmation',p_text:prefix+`ICASH CONFIRMATION\nStatus: ${kind}\nDate: ${date}\nAmount cents: ${amount}\nFile: SIMULATION-ONLY\nEND ICASH CONFIRMATION`,p_authenticated:authenticated});return id;
 };
 await titleReply('title_opened',{authenticated:false});await titleReply('title_opened',{sender:'attacker@example.invalid'});await titleReply('title_opened',{prefix:'Quoted previous email:\n'});
 assert.equal(Number((await one('select count(*) n from icash_closing_updates where deal_id=$1',[dealId])).n),0);
 await titleReply('closed',{date:today});assert.equal((await one('select stage from icash_deal_files where id=$1',[dealId])).stage,'buyer_selected');
 const openedEmail=await titleReply('title_opened');await titleReply('title_opened',{id:openedEmail});
 assert.equal((await one('select stage from icash_deal_files where id=$1',[dealId])).stage,'title_open');
 assert.equal(Number((await one("select count(*) n from icash_closing_updates where deal_id=$1 and kind='title_opened'",[dealId])).n),1);
 const opened=await one('select * from icash_title_replies where provider_email_id=$1',[openedEmail]);
 await assert.rejects(rpc('icash_confirm_closing_update',{p_account:otherAccount,p_actor:otherUser,p_deal:dealId,p_reply:opened.id,p_kind:'closed',p_date:today}),/Signed deal|required/);
 await assert.rejects(rpc('icash_confirm_closing_update',{p_account:account,p_actor:user,p_deal:dealId,p_reply:opened.id,p_kind:'closed',p_date:today}),/deposit still needs confirmation/);
 await titleReply('deposit_received',{amount:'500000'});
 await titleReply('closed',{date:future(1).slice(0,10)});assert.notEqual((await one('select stage from icash_deal_files where id=$1',[dealId])).stage,'closed');
 await titleReply('closing_scheduled',{date:today});assert.equal((await one('select stage from icash_deal_files where id=$1',[dealId])).stage,'closing');
 const closedEmail=await titleReply('closed',{date:today});await titleReply('closed',{date:today,id:closedEmail});
 assert.equal((await one('select stage from icash_deal_files where id=$1',[dealId])).stage,'closed');
 assert.equal(Number((await one("select count(*) n from icash_closing_updates where deal_id=$1 and kind='closed'",[dealId])).n),1);
 // A closed deal never regains discovery, marketing or buyer-call eligibility.
 assert.equal((await buyerService.discoverBuyersForDeal(account,dealId)).status,'buyer_search_held');
 assert.equal(await rpc('icash_buyer_voice_context',{p_permission:buyerPermission.id}),null);
 assert.deepEqual(await rpc('icash_reviewed_buyers',{p_account:account,p_deal:dealId}),[]);
 const closedMarketing=await rpc('icash_submit_authority_review',{p_account:account,p_user:user,p_key:randomUUID(),p_payload:marketingPayload});
 await assert.rejects(decide(closedMarketing.id,marketingVerification),/Executed active purchase required/);
 const searchConfig=await one('select revision from icash_buyer_search_configs where account_id=$1',[account]);
 assert.equal(await rpc('icash_claim_buyer_search',{p_account:account,p_deal:dealId,p_revision:searchConfig.revision,p_operation:'SIMULATION:closed-search'}),false);

 const preFunds=Number((await one('select balance_cents from icash_wallets where account_id=$1',[account])).balance_cents);
 await titleReply('funds_disbursed',{date:today,amount:'1000000'});
 assert.equal(Number((await one('select balance_cents from icash_wallets where account_id=$1',[account])).balance_cents),preFunds,'Title confirmation never fabricates wallet proceeds');
 pass('Verified title request → authenticated milestones → close','real PDF verification/title dispatch + inbound routing/closing RPCs and triggers; timeout hold/no resend, duplicate mail ignored, sender spoof/quoted/out-of-order/future closing rejected, deposit required; title-reported disbursement never becomes a bank/wallet receipt');
 note('Signing/title/closing evidence','SIMULATED EVIDENCE ONLY','DocuSeal submission and PDF bytes, customer/seller/buyer signatures, title recipient verification and authenticated title replies are synthetic. No live agreement, email, deposit, closing, fund transfer or investment result verified');

 const available=Number((await one('select balance_cents-reserved_cents as available from icash_wallets where account_id=$1',[account])).available);
 await assert.rejects(rpc('icash_reserve_credit',{p_account:account,p_operation:'SIMULATION:insufficient',p_amount:available+1}),/Insufficient credits/);
 await assert.rejects(rpc('icash_reserve_credit',{p_account:otherAccount,p_operation:'voice:'+work.voiceJobId,p_amount:1000}),/Idempotency conflict/);
 const expiryRate=(await one(`insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) values('property_search','SIMULATION expiring rate',1000,$1,'SIMULATION transient current rate',now()-interval '1 minute',now()+interval '1 second',true) returning id`,[{...costs,dealmachine:10000}])).id;
 const expiryKey='SIMULATION:expiry-before-dispatch';
 await operating.reserveOperation({accountId:account,operationKey:expiryKey,rateId:expiryRate,permissionUntil:future(1)});
 await rpc('icash_set_work_control',{p_user:user,p_account:account,p_action:'pause'});
 assert.equal(await rpc('icash_claim_operation',{p_operation:expiryKey}),false);
 await rpc('icash_set_work_control',{p_user:user,p_account:account,p_action:'resume'});
 await new Promise(resolve=>setTimeout(resolve,1100));
 assert.equal(await rpc('icash_claim_operation',{p_operation:expiryKey}),false,'A rate expiring after reservation cannot dispatch');
 await assert.rejects(operating.reserveOperation({accountId:account,operationKey:'SIMULATION:new-expired-rate',rateId:expiryRate,permissionUntil:future(1)}),/Verified rate required/);
 await rpc('icash_settle_operation',{p_operation:expiryKey,p_charge:0,p_actual_micros:0,p_evidence:'SIMULATION expired undispatched reservation cancelled'});
 assert.equal((await one('select state from icash_operation_spend where operation_key=$1',[expiryKey])).state,'cancelled');
 assert.equal((await one('select status from icash_credit_reservations where operation_key=$1',[expiryKey])).status,'released');
 pass('Money, pause and rate-expiry safety','real credit reservation rejects insufficient funds/cross-account reuse; paused and newly expired rates block final claim; undispatched expired reservation releases without debit; ambiguous voice branch retains its reserve and never redials');

 console.log(`\nSIMULATION SUMMARY: ${report.filter(x=>x.status==='SIMULATED PASS').length} stages passed; ${files.length} actual schema/config files; ${calls.filter(x=>x.rpc).length} real RPC calls; ${external.length} intercepted provider fixture requests.`);
 assert(!notices.some(n=>n.includes('Funded account provisioning deferred')), 'Provisioning trigger hid a database failure');
})();}catch(error){console.error('SIMULATED_JOURNEY_FAILED:',error.message,error.detail??'',error.where??'',error.stack?.split('\n').slice(1,4).join('\n'));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;for(const key of Object.keys(process.env))if(!(key in originalEnv))delete process.env[key];Object.assign(process.env,originalEnv);await pg.close();}
