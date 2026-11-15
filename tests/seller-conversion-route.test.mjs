import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {validSellerConversionReport} from '../lib/seller-conversion-report.ts';
const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';
const fixture=()=>({version:'seller-conversion-v1',days:7,startAt:'2026-11-08T00:00:00Z',endAt:'2026-11-15T00:00:00Z',sampleLimit:2000,scope:'recent_source_samples',complete:true,
 truncated:{replies:false,calls:false,offerEvents:false,callbacks:false},
 replies:{observed:0,actionable:0,restrictedOrAutomated:0,currentlyAccepted:0,delivered:0,sourceTimeUnknown:0,acceptedDispatchLatencyUnknown:0,dispatchLatencySeconds:{samples:0,p50:null,p90:null,max:null},currentWithoutBoundAutomaticReply:0,laterCustomerReplies:0,currentUnsubmitted:0,currentMissingAiJob:0,customerControlled:0,dueProgressChecks:0,oldestDueSeconds:null,reasons:[]},
 calls:{attempted:0,completed:0,humanResponses:0,humanResponseUnknown:0},
 offers:{observedDeals:0,quoteRecorded:0,acceptanceRecorded:0,currentQuoteSmsDelivered:0,verifiedPurchaseSigned:0,quotedWithoutAcceptance:0,acceptedWithoutVerifiedPurchaseOnDeal:0,voiceQuoteDeliveryUnknown:0,currentOfferAuthority:null},
 callbacks:{observed:0,scheduledReviewsDue:0,oldestDueSeconds:null,heldForHuman:0}});
let user={id:owner},result=fixture(),queries=[];
const mocks={currentUser:async verify=>{assert.equal(verify,true);return user;},ownerInboundTarget:{ownerUserId:owner},validSellerConversionReport,outreachStatuses:[],db:async(path,method,body,signal)=>{queries.push({path,method,body,signal});return result;}};
globalThis.__conversion=mocks;
const source=ts.transpileModule(readFileSync(new URL('../app/api/admin/outreach/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {GET}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(mocks).join(',')+'}=globalThis.__conversion;\n'+source).toString('base64'));
const get=query=>GET(new Request('https://example.invalid/api/admin/outreach?'+query));
user=null;assert.equal((await get('measure=conversion&days=7')).status,401);
user={id:'other',user_metadata:{isOwner:true}};assert.equal((await get('measure=conversion&actor='+owner)).status,403);
user={id:owner};
for(const q of ['measure=invalid','measure=conversion&days=2','measure=conversion&includeOwner=true','measure=conversion&page=2','measure=conversion&q=test','measure=conversion&status=responded'])assert.equal((await get(q)).status,400);
assert.equal(queries.length,0);
let response=await get('measure=conversion&days=7&actor=someone-else');assert.equal(response.status,200);
assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('vary'),'Cookie');
assert.deepEqual(queries[0].body,{p_actor:owner,p_days:7});assert.equal(queries[0].path,'rpc/icash_seller_conversion_report');assert(queries[0].signal instanceof AbortSignal);
for(const bad of [{},null,{...fixture(),days:30},{...fixture(),complete:false},{...fixture(),privateBody:'unexpected'},{...fixture(),replies:{...fixture().replies,currentlyAccepted:1}}]){
 result=bad;response=await get('measure=conversion&days=7');assert.equal(response.status,503);assert.match((await response.json()).error,/could not load/);
}
result={...fixture(),complete:false,truncated:{...fixture().truncated,replies:true}};assert.equal((await get('measure=conversion&days=7')).status,200);
console.log('PASS private seller conversion route: verified owner, trusted actor, bounded inputs, no-store, explicit truncation and fail-closed response validation.');
