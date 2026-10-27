import assert from 'node:assert/strict';
import {inspectPhoneContract} from '../scripts/check-dealmachine-phone-contract.mjs';
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/dealmachine-active-phone-contract-20261027',DEALMACHINE_API_KEY:'fixture-secret'};
let calls=[];
const transport=async(url,options)=>{
 calls.push(url);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
 assert.equal(options.headers.Authorization,'Bearer fixture-secret');
 if(url.includes('/fields?'))return Response.json({data:[
  {field_id:'phones',type:'STRING',billing_category:'people',name:'ignored name',description:'ignored private text'},
  {field_id:'person_id',type:'STRING',billing_category:'people'},
  {field_id:'estimated_income',type:'NUMBER',billing_category:'people'},
 ],pagination:{has_next_page:false}});
 assert.equal(url,'https://api.v2.dealmachine.com/v1/exports?limit=5&status=completed');
 return Response.json({data:[{export_id:'private-export-id',name:'private export name',record_count:3,credits:{used:2,people:3},download_urls:[{filename:'people_export_fixture.csv.gz',url:'https://example.invalid/private-download',size:234}]}],pagination:{total:1}});
};
const result=await inspectPhoneContract(env,transport);
assert.equal(result.status,'checked');assert.equal(result.paidRequests,0);assert.equal(calls.length,2);
assert.deepEqual(result.fields.map(x=>x.fieldId),['phones','person_id']);
assert.deepEqual(result.existingExports.samples[0].creditsKeys,['people','used']);
assert.deepEqual(result.existingExports.samples[0].files,[{size:234,people:true,gzip:true}]);
assert.doesNotMatch(JSON.stringify(result),/fixture-secret|private-export-id|private export name|private-download|ignored private text/);
calls=[];
for(const overrides of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'},{DEALMACHINE_API_KEY:''}])await inspectPhoneContract({...env,...overrides},transport);
assert.equal(calls.length,0);
let pages=0;
const bounded=await inspectPhoneContract(env,async url=>{
 if(url.includes('/fields?')){pages++;return Response.json({data:[],pagination:{has_next_page:true}});}
 return Response.json({data:[],pagination:{total:0}});
});
assert.equal(pages,4);assert.equal(bounded.status,'catalog_incomplete');
console.log('PASS phone contract inspection: bounded free GET metadata, preview-only, no contacts, downloads, exports, credits or secret output.');
