// Local fixtures only. Never connects to Meta, SMS, voice, or DealMachine.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyMetaSignature,metaNotices,parseMetaLead,instantLeadToken,hashLeadToken,validInstantLeadToken,confirmedCallAddress,metaLeadAccessToken} from '../lib/meta-instant-leads.ts';
import {queueInstantAddressLink,researchInstantAddress,instantLeadsEnabled,retrieveInstantLead,processInstantLead} from '../lib/meta-instant-lead-service.ts';
import {instantCallAddress} from '../lib/meta-instant-call.ts';
import {instantCrmEvent,deliverInstantCrmEvent} from '../lib/meta-instant-events.ts';
import {smsLength} from '../lib/sms-length.ts';

const now=Date.now(),submitted=new Date(Math.floor(now/1000)*1000).toISOString();
const secret='SIMULATION_ONLY_SECRET_'.repeat(3),notice={leadgen_id:'333333333',page_id:'111111111',form_id:'222222222',ad_id:'444444444',created_time:Date.parse(submitted)/1000};
const source={id:'source',page_id:notice.page_id,form_id:notice.form_id,account_id:'account',consent_key:'ai_contact',call_now_key:'call_now',enabled:true};
const receipt={id:notice.leadgen_id,form_id:notice.form_id,ad_id:notice.ad_id,created_time:submitted,field_data:[{name:'full_name',values:['Fixture Seller']},{name:'phone_number',values:['(214) 555-0123']}],custom_disclaimer_responses:[{checkbox_key:'ai_contact',is_checked:true},{checkbox_key:'call_now',is_checked:true}]};
const raw=Buffer.from(JSON.stringify({object:'page',entry:[{id:notice.page_id,changes:[{field:'leadgen',value:notice}]}]}));
const signature='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
assert(verifyMetaSignature(raw,signature,secret));
assert(!verifyMetaSignature(Buffer.concat([raw,Buffer.from(' ')]),signature,secret));
assert(!verifyMetaSignature(raw,signature,secret+'wrong'));
assert(!verifyMetaSignature(raw,null,secret));
assert.deepEqual(metaNotices(JSON.parse(raw)),[notice]);
assert.throws(()=>metaNotices({object:'page',entry:[{id:'999999999',changes:[{field:'leadgen',value:notice}]}]}),/PAGE_MISMATCH/);
assert.equal(parseMetaLead(receipt,notice,source,now).phone,'+12145550123');
assert.equal(parseMetaLead(receipt,notice,source,now).callNow,true);
assert.equal(parseMetaLead(receipt,notice,source,now+6*60000).callNow,false);
assert.throws(()=>parseMetaLead({...receipt,form_id:'999999999'},notice,source,now),/BINDING/);
assert.throws(()=>parseMetaLead({...receipt,custom_disclaimer_responses:[]},notice,source,now),/CONSENT/);
assert.throws(()=>parseMetaLead({...receipt,custom_disclaimer_responses:[...receipt.custom_disclaimer_responses,{checkbox_key:'ai_contact',is_checked:false}]},notice,source,now),/CONSENT/);
const token=instantLeadToken(notice.leadgen_id,submitted,secret);
assert.equal(token,instantLeadToken(notice.leadgen_id,submitted,secret));assert.equal(token.length,43);
assert.notEqual(token,instantLeadToken('333333334',submitted,secret));
assert(validInstantLeadToken(token,secret));assert(!validInstantLeadToken(token+'x',secret));
assert(!instantLeadsEnabled({META_INSTANT_LEADS_ENABLED:'true',VERCEL_ENV:'preview'}));
const sharedAccess='SIMULATION_ONLY_SHARED_ACCESS_TOKEN',pageAccess='SIMULATION_ONLY_PAGE_ACCESS_TOKEN';
const sharedEnv={META_ADS_READ_ACCESS_TOKEN:sharedAccess,META_LEAD_ADS_READ_PAGE_IDS:notice.page_id};
assert.equal(metaLeadAccessToken(notice.page_id,sharedEnv),sharedAccess);
assert.throws(()=>metaLeadAccessToken('999999999',sharedEnv),/META_PAGE_TOKEN_REQUIRED/,'a shared system token is not an implicit Page allowlist');
assert.throws(()=>metaLeadAccessToken(notice.page_id,{META_ADS_READ_ACCESS_TOKEN:sharedAccess}),/META_PAGE_TOKEN_REQUIRED/);
assert.equal(metaLeadAccessToken(notice.page_id,{...sharedEnv,META_LEAD_PAGE_TOKENS:JSON.stringify({[notice.page_id]:pageAccess})}),pageAccess);
assert.throws(()=>metaLeadAccessToken(notice.page_id,{...sharedEnv,META_LEAD_PAGE_TOKENS:'null'}),/META_PAGE_TOKEN_REQUIRED/);
assert.throws(()=>metaLeadAccessToken(notice.page_id,{...sharedEnv,META_LEAD_PAGE_TOKENS:'{broken'}),/META_PAGE_TOKEN_REQUIRED/);
let retrievalFetches=0;
const retrievalDeps={env:{...sharedEnv,META_INSTANT_LEADS_ENABLED:'true',META_LEAD_LINK_SECRET:secret,META_LEAD_APP_SECRET:secret,META_GRAPH_VERSION:'v26.0'},
 sms:async()=>{throw Error('No outreach in token fixture');},voice:async()=>{throw Error('No outreach in token fixture');},
 db:async(path,method)=>{if(method==='PATCH')return [];if(path==='rpc/icash_meta_claim_notice')return {metaId:notice.leadgen_id,sourceId:source.id,notice,token:'claim'};if(path.startsWith('icash_meta_lead_sources?'))return [source];throw Error('Unexpected retrieval query');},
 fetch:async(url,options)=>{retrievalFetches++;assert.equal(options.headers.Authorization,'Bearer '+sharedAccess);assert.equal(url.searchParams.get('appsecret_proof'),createHmac('sha256',secret).update(sharedAccess).digest('hex'));return new Response('',{status:403});}};
assert.equal((await retrieveInstantLead(retrievalDeps)).status,'retry_pending');
assert.equal(retrievalFetches,1);
assert.equal((await retrieveInstantLead({...retrievalDeps,env:{...retrievalDeps.env,META_LEAD_ADS_READ_PAGE_IDS:'999999999'}})).status,'retry_pending');
assert.equal(retrievalFetches,1,'an unselected Page cannot send the shared token to Graph');
assert.equal((await retrieveInstantLead({...retrievalDeps,env:{...retrievalDeps.env,VERCEL_ENV:'preview'}})).status,'disabled');
assert.equal(retrievalFetches,1,'previews cannot retrieve live leads');
const address='123 Main St, Austin, TX 78701';
const history={transcript:[{role:'user',message:'123 Main Street in Austin, Texas.'},{role:'agent',message:'123 Main Street, Austin, Texas. Is that correct?'},{role:'user',message:"Yes, that's correct."}]};
assert.equal(confirmedCallAddress(address,history),address);
assert.equal(confirmedCallAddress('124 Main St, Austin, TX 78701',history),null);
assert.equal(confirmedCallAddress(address,{transcript:history.transcript.slice(1)}),null,'AI readback alone cannot invent the address');
assert.equal(confirmedCallAddress(address,{transcript:[...history.transcript.slice(0,-1),{role:'user',message:'No, 125 Main Street.'}]}),null);

const lead={lead_id:'lead',account_id:'account',screening_id:'screen',meta_id:notice.leadgen_id,submitted_at:submitted,link_hash:hashLeadToken(token),link_expires_at:new Date(now+86400000).toISOString(),paused:false,declined_at:null,lead:{name:'Fixture',phone:'+12145550123',address:null,state:'awaiting_address'}};
const env={META_INSTANT_LEADS_ENABLED:'true',META_LEAD_LINK_SECRET:secret,DEALMACHINE_API_KEY:'dm_sk_live_FIXTURE_ONLY'};
let poolAssigned=false,poolCalls=0,poolTexts=0,poolReads=[];
const poolDeps={env,sms:async()=>{poolTexts++;throw Error('SIMULATION text provider unavailable');},voice:async(account,id)=>{assert.deepEqual([account,id],['account','pool-call']);poolCalls++;return {status:'call_started'};},db:async(path)=>{
 poolReads.push(path);
 if(path==='rpc/icash_meta_assign_contact')return {status:poolAssigned?'assigned':'waiting_for_funded_buyer'};
 if(path.startsWith('icash_meta_leads?'))return [lead];
 if(path==='rpc/icash_meta_match_address_request')return false;
 if(path.startsWith('icash_customer_identities?'))return [{principal:'Fixture matched buyer'}];
 if(path==='rpc/icash_meta_queue_message')return 'pool-text';
 if(path==='rpc/icash_meta_prepare_voice')return {accountId:'account',voiceJobId:'pool-call'};
 throw Error('Unexpected pool request');
}};
assert.equal((await processInstantLead(poolDeps,'lead')).status,'waiting_for_funded_buyer');assert.deepEqual(poolReads,['rpc/icash_meta_assign_contact']);assert.equal(poolCalls+poolTexts,0);
assert.equal((await queueInstantAddressLink(poolDeps,{...lead,account_id:null,screening_id:null},'initial','initial')).status,'held');assert.equal(poolCalls+poolTexts,0);
poolAssigned=true;const poolWork=await processInstantLead(poolDeps,'lead');assert.equal(poolWork.sms,'pending');assert.equal(poolWork.voice,'call_started');assert.equal(poolCalls,1);assert.equal(poolTexts,1,'the independent call continues when initial SMS fails');
let sent=0,queued=[];
const deps={env,voice:async()=>({status:'fixture'}),sms:async()=>{sent++;return {status:'message_accepted'};},db:async(path,method,body)=>{
 if(path.startsWith('icash_customer_identities'))return [{principal:'Fixture Buyer'}];
 if(path==='rpc/icash_meta_queue_message'){queued.push(body);return 'message';}
 throw Error('Unexpected fixture query: '+path);
}};
for(const purpose of ['initial','address_link','reply']){
 assert.equal((await queueInstantAddressLink(deps,lead,purpose,purpose,'A'.repeat(400))).status,'message_accepted');
 assert(smsLength(queued.at(-1).p_body).fits);assert(queued.at(-1).p_body.includes(token));
 assert(queued.at(-1).p_body.endsWith('STOP to opt out.'));
}
assert.equal((await queueInstantAddressLink(deps,{...lead,paused:true},'initial','initial')).status,'held');assert.equal(sent,3);
assert.equal((await queueInstantAddressLink(deps,{...lead,link_hash:'bad'},'initial','initial')).status,'link_expired');

let complete=false,saved=false,fetches=0,claimAvailable=true;
const db=async(path,method,body)=>{
 if(path==='rpc/icash_meta_call_context')return {leadId:'lead',accountId:'account',screeningId:'screen',state:saved?'received':'awaiting_address',complete};
 if(path.startsWith('icash_meta_leads?'))return [lead];
 if(path==='rpc/icash_meta_save_address'){assert.equal(body.p_address,address);saved=true;return {status:'received'};}
 if(path==='rpc/icash_take_dealmachine_request')return true;
 if(path==='rpc/icash_meta_claim_lookup'){if(!claimAvailable)return null;claimAvailable=false;return {id:'lead',token:'claim',address,assignmentFeeCents:1000000,sellerCostReserveCents:100000};}
 if(path==='rpc/icash_finish_seller_lookup'){assert.equal(body.p_output.status,'qualified');complete=true;return true;}
 if(path==='rpc/icash_meta_promote_property')return {status:complete?'property_ready':'research_required'};
 if(method==='PATCH')return [];
 return deps.db(path,method,body);
};
const matched={data:[{matched:true,dm_property_id:'prop_123',full_address:address,city:'Austin',state:'TX',zip:'78701',property_type:1,estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}],totals:{submitted:1},credits:{used:1,people:0}};
const callDeps={...deps,db,bind:async()=>{throw Error('Already-bound call should not rebind');},history:async()=>history,fetch:async(_url,options)=>{fetches++;assert(options.signal);return Response.json(matched);}};
const result=await instantCallAddress('fixture-capability',{conversationId:'conv_fixture',action:'report_change',sellerStatement:address},callDeps);
assert.equal(result.status,'property_found');assert.equal(result.quoteAllowed,false);assert.equal(fetches,1);
assert.equal(await instantCallAddress('fixture-capability',{conversationId:'conv_fixture',action:'get_offer'},callDeps),null,'after promotion use the normal offer authority');
await researchInstantAddress(callDeps,'lead',{liveCall:true});assert.equal(fetches,1,'duplicate channel cannot purchase another lookup');
complete=false;saved=false;
const fallback=await instantCallAddress('fixture-capability',{conversationId:'conv_fixture',action:'get_offer'},callDeps);
assert.equal(fallback.quoteAllowed,false);assert.equal(fallback.textAccepted,true);assert.equal(fetches,1);
claimAvailable=true;
const failed=await researchInstantAddress({...callDeps,fetch:async()=>{fetches++;throw Error('fixture timeout');}},'lead',{liveCall:true});
assert.equal(failed.status,'lookup_requires_review');
await researchInstantAddress(callDeps,'lead',{liveCall:true});assert.equal(fetches,2,'timeout never repeats an uncertain paid request');

const event={id:'stage',token:'claim',leadId:notice.leadgen_id,name:'SellerResponded',occurredAt:submitted};
const payload=instantCrmEvent(event,now);assert.equal(payload.user_data.lead_id,notice.leadgen_id);assert.equal(payload.event_id,'instant-lead:stage');assert(!JSON.stringify(payload).includes(address));
assert.throws(()=>instantCrmEvent({...event,name:'Delivered'},now),/EVENT_WINDOW/);
let eventCalls=0;
assert.equal((await deliverInstantCrmEvent(async()=>{throw Error('disabled');},{...env,VERCEL_ENV:'preview'})).status,'measurement_setup_required');
const eventEnv={...env,VERCEL_ENV:'production',META_INSTANT_CRM_EVENTS_ENABLED:'true',META_SELLER_DATASET_ID:'123456789',META_CAPI_ACCESS_TOKEN:'fixture',META_GRAPH_VERSION:'v26.0'};
assert.equal((await deliverInstantCrmEvent(async(path,method,body)=>{if(method==='PATCH'){assert.equal(body.state,'delivered');return [];}return event;},eventEnv,async()=>{eventCalls++;return Response.json({events_received:1});})).status,'delivered');
assert.equal(eventCalls,1);
console.log('PASS signed Meta receipts, exact consent/source binding, short private links, spoken address confirmation, SMS limits, same-call lookup and normal-offer handoff, uncertain-result protection, and CRM event privacy.');
