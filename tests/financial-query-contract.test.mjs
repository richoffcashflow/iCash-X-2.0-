import assert from 'node:assert/strict';
import {checkFinancialQueryContract} from '../scripts/check-financial-query-contract.mjs';
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/daily-funded-outreach',SUPABASE_URL:'https://database.invalid',SUPABASE_SECRET_KEY:'private-db-secret',DEALMACHINE_API_KEY:'private-provider-secret'};
assert.equal((await checkFinancialQueryContract({},()=>{throw Error('network');})).status,'outside_review');
assert.equal((await checkFinancialQueryContract({...env,VERCEL_ENV:'production'},()=>{throw Error('network');})).status,'outside_review');
let paid=0,estimates=0;
const transport=async(url,options)=>{
 if(url.includes('icash_discovery_configs?'))return Response.json([{account_id:'account',revision:'revision',next_page:1,zip:'75216',per_page:5}]);
 if(url.endsWith('icash_targeting_query_context'))return Response.json({ready:true,policy:{version:'financial-prefilter-v1',exclusionListId:'fixture-list',asOf:'2026-11-10',tier:0}});
 if(url.endsWith('icash_take_dealmachine_request'))return Response.json(true);
 if(url.endsWith('icash_finish_dealmachine_request'))return Response.json(true);
 assert.equal(url,'https://api.v2.dealmachine.com/v1/properties/search');assert.equal(options.redirect,'error');
 const body=JSON.parse(options.body);if(body.estimate_cost!==true)paid++;estimates++;
 return Response.json({error:{code:'validation_error',message:'Invalid request',details:{issues:[{path:'fields[2]',message:'private-db-secret private-provider-secret'}]}}},{status:400});
};
const result=await checkFinancialQueryContract(env,transport);
assert.equal(result.status,'rejected');assert.equal(result.httpStatus,400);assert.equal(result.paidRequests,0);assert.equal(paid,0);assert.equal(estimates,1);
assert.equal(JSON.stringify(result).includes('private-'),false);
console.log('PASS scoped financial query diagnostic: one admitted free estimate, no purchase path, production exclusion and secret redaction.');
