// Local fixtures only: no provider traffic or production credentials.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {makeLeadConfig,makeLeadAuthorized,parseMakeLead,readMakeLeadBody,processMakeLead} from '../lib/meta-make-intake.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
const key='f'.repeat(64),now=Date.now();
const config={pageId:'111111111',formId:'222222222',tokenSha256:createHash('sha256').update(key).digest('hex'),testLeadIds:['333333334']};
const env={VERCEL_ENV:'production',META_MAKE_RECEIVER_JSON:JSON.stringify(config),META_INSTANT_LEADS_ENABLED:'true',META_LEAD_LINK_SECRET:'FIXTURE_ONLY_'.repeat(4)};
const body={lead_id:'333333333',page_id:config.pageId,form_id:config.formId,created_time:new Date(now-2000).toISOString(),full_name:'Fixture Seller',phone_number:'(214) 555-0123',ad_id:'',custom_disclaimer_responses:[]};
assert.deepEqual(makeLeadConfig(env),config);
assert.equal(makeLeadConfig({...env,META_MAKE_RECEIVER_JSON:'malformed'}),null);
assert(makeLeadAuthorized('Bearer '+key,config));
for(const header of [null,'Bearer wrong','Bearer '+'é'.repeat(64),'Bearer '+'a'.repeat(64)])assert.equal(makeLeadAuthorized(header,config),false);
const parsed=parseMakeLead(body,config,now);
assert.equal(parsed.test,false);assert(!('ad_id' in parsed.payload));
assert.deepEqual(parsed.payload.custom_disclaimer_responses,[],'missing receipts stay empty; no consent is invented');
assert.equal(parseMakeLead({...body,lead_id:'333333334'},config,now).test,true,'known test stays excluded even with a real-looking phone');
const dummy={...body,full_name:'<test lead: dummy data for full_name>',phone_number:'<test lead: dummy data for phone_number>'};
assert.equal(parseMakeLead(dummy,config,now).test,true);
assert.throws(()=>parseMakeLead({...body,form_id:'999999999'},config,now),/SOURCE_MISMATCH/);
assert.throws(()=>parseMakeLead({...body,created_time:'October 18, 2026 6:05 PM'},config,now),/SUBMISSION_TIME/);
assert.throws(()=>parseMakeLead({...body,created_time:new Date(now+120000).toISOString()},config,now),/SUBMISSION_TIME/);
assert.throws(()=>parseMakeLead({...body,custom_disclaimer_responses:[{checkbox_key:'contact',is_checked:'true'}]},config,now));
const formRequest=new Request('https://fixture.invalid',{method:'POST',body:new URLSearchParams({...body,custom_disclaimer_responses:'[]'})});
assert.equal(parseMakeLead(await readMakeLeadBody(formRequest),config,now).payload.id,body.lead_id);
await assert.rejects(readMakeLeadBody(new Request('https://fixture.invalid',{method:'POST',body:'a=1&a=2',headers:{'content-type':'application/x-www-form-urlencoded'}})),/DUPLICATE/);
await assert.rejects(readMakeLeadBody(new Request('https://fixture.invalid',{method:'POST',body:'x'.repeat(16385),headers:{'content-type':'application/json'}})),/TOO_LARGE/);

let stored=0,scheduled=0;
const route=await loadService('app/api/webhooks/make-leads/route.ts',{process:{env},makeLeadConfig,makeLeadAuthorized,parseMakeLead,readMakeLeadBody,processMakeLead,
 db:async(path,method,args)=>{assert.equal(path,'rpc/icash_make_receive_lead');assert.equal(args.p_test,true);stored++;return {status:'test_received',duplicate:false,outreach:'test_excluded'};},
 after:()=>{scheduled++;},processInstantLead:()=>assert.fail('test cannot dispatch'),dispatchTextMessage:()=>assert.fail('no SMS'),dispatchLiveVoice:()=>assert.fail('no calls')});
const request=(payload=dummy,authorization='Bearer '+key)=>new Request('https://homeoffernetwork.com/api/webhooks/make-leads',{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(payload)});
assert.equal((await route.POST(request(dummy,'Bearer wrong'))).status,401);assert.equal(stored,0);
assert.equal((await route.POST(request({...dummy,page_id:'999999999'}))).status,403);assert.equal(stored,0);
const result=await route.POST(request());assert.equal(result.status,200);assert.equal((await result.json()).outreach,'test_excluded');assert.equal(stored,1);assert.equal(scheduled,0);
env.VERCEL_ENV='preview';assert.equal((await route.POST(request())).status,503);env.VERCEL_ENV='production';

const source={id:'00000000-0000-4000-8000-000000000001',page_id:config.pageId,form_id:config.formId,account_id:null,routing_mode:'network_pool',enabled:true,consent_key:'ai_contact',call_now_key:null,consent_text:'FIXTURE explicit requested calls and texts from HomeOffer Network.',consent_version:'fixture-v1',timezone:'America/Chicago'};
let saved=0,dispatched=0,updates=[];
let claim={metaId:body.lead_id,sourceId:source.id,token:'fixture',payload:parsed.payload,isTest:false};
const db=async(path,method,args)=>{
 if(path==='rpc/icash_make_claim_lead')return claim;
 if(path.startsWith('icash_meta_lead_sources?'))return [source];
 if(path==='rpc/icash_meta_accept_lead'){saved++;assert.equal(args.p_payload.phone,'+12145550123');return {leadId:'fixture-lead'};}
 if(path.startsWith('icash_make_lead_inbox?')){updates.push(args);return null;}
 assert.fail('Unexpected database operation '+path);
};
const deps={db,env,onAccepted:async()=>{dispatched++;}};
assert.equal((await processMakeLead(deps)).status,'review');assert.equal(saved,0);assert.equal(dispatched,0);assert.equal(updates.at(-1).reason,'META_CONTACT_CONSENT_REQUIRED');
claim={...claim,payload:{...parsed.payload,custom_disclaimer_responses:[{checkbox_key:'ai_contact',is_checked:true}]}};
assert.equal((await processMakeLead(deps)).status,'accepted');assert.equal(saved,1);assert.equal(dispatched,1);assert.equal(updates.at(-1).state,'accepted');
claim={...claim,isTest:true};assert.equal((await processMakeLead(deps)).status,'review');assert.equal(saved,1);assert.equal(dispatched,1);
assert.equal(updates.at(-1).state,'test');
source.contact_basis='form_submission';claim={...claim,isTest:false,payload:parsed.payload};
assert.equal((await processMakeLead(deps)).status,'accepted');assert.equal(saved,2);assert.equal(dispatched,2);
source.test_lead_names=[' fixture   seller '];
assert.equal((await processMakeLead(deps)).status,'review');assert.equal(saved,2);assert.equal(dispatched,2);
assert.equal(updates.at(-1).state,'test');assert.equal(updates.at(-1).reason,'META_TEST_LEAD');
source.test_lead_names=[];
const {parseMetaLead}=await import('../lib/meta-instant-leads.ts');
const submission=parseMetaLead(parsed.payload,{leadgen_id:body.lead_id,page_id:config.pageId,form_id:config.formId,created_time:Math.floor(Date.parse(body.created_time)/1000)},source,now);
assert.deepEqual(submission.consentResponses,[{kind:'form_submission',provider:'meta',metaId:body.lead_id,pageId:config.pageId,formId:config.formId,submittedAt:body.created_time}]);
assert.equal(submission.callNow,false,'a submission does not fabricate an outside-hours call-now choice');
console.log('PASS Make intake: scoped authentication, bounded body, original timestamps, submission-based follow-up, retained checkbox behavior, dummy/known test exclusion, and shared acceptance without Graph API retrieval.');
