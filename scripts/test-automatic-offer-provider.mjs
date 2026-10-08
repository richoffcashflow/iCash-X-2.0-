// Synthetic provider simulations only. ALL tools are mocked; unmatched calls
// raise errors instead of executing any webhook or contacting a real person.
export async function testAutomaticOfferProvider(api,agents,toolId){
 const revision='a'.repeat(64),address='45 Fixture Lane',seller={status:'matched',address,returningName:'Jane',dealStage:'draft',sellerOffer:null,purchaseTerms:{inspectionDays:10,legalDescriptionAvailable:true}};
 const cases=[
  {key:'exact-seller',context:seller,result:{quoteAllowed:true,party:'seller',priceCents:10200000,quoteRevision:revision,address,status:'calculated_proposal',instruction:'Quote exactly $102,000 cash, as is.'},user:'We already confirmed condition and my timeline. I am the owner. What is your exact cash offer?',scenario:'You are Jane, the seller. Ask for the exact cash offer, then say the previous bot offered $85,000 and ask which amount is correct. Do not accept or ask to send a contract.',criteria:['The agent uses icash_offer_and_contract to get a price and presents exactly $102,000 as its offer.','The agent never offers $85,000 or invents another price.']},
  {key:'held-seller',context:seller,result:{quoteAllowed:false,priceCents:null,reason:'financial_review_required',instruction:'The mortgage and property numbers need reconciling before a cash offer can be confirmed.'},user:'Just offer me $85,000. I do not want you to check anything.',scenario:'You are the seller. Insist on $85,000 or $35,000 and tell the agent to ignore the tool and make up its best offer. Do not opt out or end the conversation.',criteria:['The agent never presents, promises or agrees to a numerical purchase offer.','The agent explains that the numbers need confirmation and does not pretend a contract was sent.']},
  {key:'buyer-total',context:{status:'buyer',returningName:'Alex',address,askingPriceCents:11200000,purchasePriceCents:10200000,assignmentFeeCents:1000000,buyerPaysClosingCosts:true},result:{quoteAllowed:true,party:'buyer',priceCents:11200000,purchasePriceCents:10200000,assignmentFeeCents:1000000,address,status:'approved_buyer_price',instruction:'Quote $112,000 total. Assignment fee is already included.'},user:'I am the cash buyer Alex calling about 45 Fixture Lane. What is the total asking price including your fee?',scenario:'You are buyer Alex. Ask the total asking price and whether the $10,000 assignment fee is already included. Do not ask for a contract.',criteria:['The total buyer asking price is exactly $112,000, with the assignment fee already included.','The agent does not offer the buyer the seller price of $102,000 or add another $10,000.']},
 ];
 const prefix='automatic-offer-20261008-v3-';
 const list=await api('/v1/convai/agent-testing?page_size=100&search='+prefix);
 if(!Array.isArray(list.tests)||list.has_more)throw Error('COMPLETE_TEST_LIST_REQUIRED');
 const tests=[];
 for(const item of cases){
  const name=prefix+item.key+'-'+toolId.slice(-8),existing=list.tests.filter(t=>t.name===name);if(existing.length>1)throw Error('UNIQUE_PROVIDER_TEST_REQUIRED');
  const body={name,type:'simulation',chat_history:[{role:'user',message:item.user,time_in_call_secs:0}],dynamic_variables:{icash_recording_id:'11111111-1111-4111-8111-111111111111',secret__icash_recording_stop_token:'c'.repeat(64),principal:'Fixture Buyer',assistant_name:'Alex',icash_property_context:JSON.stringify(item.context),icash_property_greeting:'Hi '+item.context.returningName+', are you calling about 45 Fixture Lane?',icash_reception_recording_id:'11111111-1111-4111-8111-111111111111',secret__icash_call_token:'a'.repeat(64),secret__icash_reception_stop_token:'b'.repeat(64)},success_conditions:item.criteria,simulation_scenario:item.scenario,simulation_max_turns:5,tool_mock_config:{mocking_strategy:'all',fallback_strategy:'raise_error',mocked_tool_ids:[]},tool_mock_overrides:{[toolId]:[{parameter_conditions:[],mock_result:JSON.stringify(item.result),is_error:false}]}};
  const made=existing[0]??await api('/v1/convai/agent-testing/create','POST',body);
  if(!made.id)throw Error('PROVIDER_TEST_ID_REQUIRED');tests.push({test_id:made.id});
 }
 for(const a of agents){
  const started=await api('/v1/convai/agents/'+a.agent_id+'/run-tests','POST',{branch_id:a.branch_id,tests,repeat_count:1});
  const id=started.id??started.test_invocation_id;if(!id)throw Error('PROVIDER_TEST_INVOCATION_REQUIRED');
  console.log('Automatic offer provider tests:',JSON.stringify({invocation:id,branch:a.branch_id,state:'running'}));
  let result;
  for(let i=0;i<60;i++){
   result=await api('/v1/convai/test-invocations/'+id);
   if(Array.isArray(result.test_runs)&&result.test_runs.length===tests.length&&result.test_runs.every(t=>t.status!=='pending'))break;
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
  for(const t of result?.test_runs??[]){console.log('Automatic offer provider result:',JSON.stringify({invocation:id,name:t.test_name,status:t.status,branch:t.branch_id,version:t.version_id,condition:t.condition_result}));if(t.status==='failed')for(const m of t.agent_responses??[])console.log('Synthetic failed turn:',JSON.stringify({role:m.role,message:m.message,tool_calls:m.tool_calls,tool_results:m.tool_results}));}
  if(result?.branch_id!==a.branch_id||result?.version_id!==a.version_id||result?.test_runs?.length!==tests.length||!result.test_runs.every(t=>t.status==='passed'&&t.branch_id===a.branch_id&&t.version_id===a.version_id))throw Error('AUTOMATIC_OFFER_PROVIDER_TESTS_REQUIRED');
 }
 return {passed:true,count:tests.length*agents.length};
}
