import test from 'node:test';
import assert from 'node:assert/strict';
import {testAutomaticOfferProvider} from '../scripts/test-automatic-offer-provider.mjs';
test('stored role, criteria and all-tool mocks must match before any simulation runs',async()=>{
 for(const patch of [null,b=>{b.dynamic_variables.icash_role_instructions='changed';},b=>{b.dynamic_variables.icash_property_context='{}';},b=>{b.success_conditions=[];},b=>{b.tool_mock_config.fallback_strategy='execute';},b=>{b.tool_mock_config.mocked_tool_ids=[];}]){
  let body,runs=0;
  const agent={agent_id:'agent_fixture',branch_id:'agtbrch_fixture',version_id:'agtvrsn_fixture',conversation_config:{agent:{prompt:{tool_ids:['tool_offer','tool_stop']}}}};
  const api=async(path,method,input)=>{
   if(path.includes('?page_size='))return {tests:[],has_more:false};
   if(path.endsWith('/create')){body=structuredClone(input);return {id:'test_fixture'};}
   if(path.endsWith('/agent-testing/test_fixture')){const saved=structuredClone(body);patch?.(saved);return saved;}
   if(path.endsWith('/run-tests')){runs++;return {id:'suite_fixture'};}
   if(path.endsWith('/test-invocations/suite_fixture'))return {branch_id:agent.branch_id,version_id:agent.version_id,test_runs:[{test_name:body.name,status:'passed',branch_id:agent.branch_id,version_id:agent.version_id}]};
   throw Error('Unexpected provider path');
  };
  const run=()=>testAutomaticOfferProvider(api,[agent],'tool_offer',{prefix:'fixture-',verifyStored:true,roleInstructions:()=> 'Trusted buyer rules',cases:[{key:'buyer',context:{status:'buyer',returningName:'Alex'},user:'What is the price?',scenario:'Ask the price',criteria:['Quote only the authorized buyer price'],result:{priceCents:100}}]});
  if(patch){await assert.rejects(run(),/EXACT_PROVIDER_TEST_INPUT_REQUIRED/);assert.equal(runs,0);}else{assert.equal((await run()).passed,true);assert.equal(runs,1);}
 }
});
