import {pathToFileURL} from 'node:url';
import {db} from '../lib/stripe-test.ts';

const source='buyer_scenario_audit_20261009_v5',marker='voice_audit_trace_review_20261009_v1';
const word=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,120}$/.test(value)?value:null;
const list=value=>Array.isArray(value)?value:[];
const actions=new Set(['get_offer','accept_offer','report_change','update_repairs','confirm_and_send','status']);

// GET existing, synthetic invocations only. Never create/run a test, call a person,
// alter an agent, or copy tool headers, credentials, arguments, or reasoning.
// Provider schema: https://elevenlabs.io/docs/api-reference/tests/test-invocations/get/
export async function inspectVoiceAuditTraces(api,audit){
 if(audit?.status!=='failed'||audit.code!=='BUYER_SCENARIO_FAILURES_REQUIRE_FIX'||audit.outreach!==false||audit.count!==30||!Array.isArray(audit.tests)||audit.tests.length!==30||!/^[a-f0-9]{64}$/.test(audit.fixtureHash??''))throw Error('VOICE_TRACE_AUDIT_REQUIRED');
 const ids=list(audit.invocations),expected=new Map(audit.tests.map(t=>[t.name,t]));
 if(!/^agtbrch_[A-Za-z0-9]+$/.test(audit.branchId??'')||!/^agtvrsn_[A-Za-z0-9]+$/.test(audit.version??'')||ids.length!==6||new Set(ids).size!==6||expected.size!==30||ids.some(id=>!/^suite_[A-Za-z0-9]+$/.test(id))||audit.tests.some(t=>!/^buyer-scenarios-20261009-v5-[A-Za-z0-9-]+$/.test(t.name??'')||!['passed','failed'].includes(t.status)))throw Error('VOICE_TRACE_SCOPE_REQUIRED');
 const seen=new Set(),tests=[];
 for(const id of ids){
  const response=await api('/v1/convai/test-invocations/'+id);
  if(response.id!==id||!Array.isArray(response.test_runs)||response.test_runs.length<1||response.test_runs.length>6)throw Error('VOICE_TRACE_INVOCATION_CHANGED');
  for(const t of response.test_runs){
   const saved=expected.get(t.test_name);
   if(!saved||seen.has(t.test_name)||t.status!==saved.status||t.branch_id!==audit.branchId||t.version_id!==audit.version||saved.branch!==audit.branchId||saved.version!==audit.version||!Array.isArray(t.agent_responses)||t.agent_responses.length>200)throw Error('VOICE_TRACE_RESULT_CHANGED');
   seen.add(t.test_name);
   const turns=t.agent_responses.map((m,index)=>({
    index,role:m.role==='agent'?'agent':m.role==='user'?'user':'other',
    // Booleans and reviewed enum-like metadata only, never raw speech or inputs.
    pricingRetryPhrase:typeof m.message==='string'&&m.message.includes('Let me confirm that amount'),
    producingModel:word(m.producing_llm),overrideModel:word(m.llm_override),
    guardrails:list(m.triggered_guardrails).slice(0,20).map(g=>({type:word(g.guardrail_type),name:word(g.guardrail_name)})),
    toolActions:list(m.tool_calls).slice(0,12).map(c=>{let p;try{p=JSON.parse(c.params_as_json);}catch{}return {name:word(c.tool_name),action:actions.has(p?.action)?p.action:null,called:c.tool_has_been_called===true};}),
    toolResults:list(m.tool_results).slice(0,12).map(r=>({name:word(r.tool_name),blocked:r.is_blocked===true,error:r.is_error===true,called:r.tool_has_been_called===true})),
   }));
   tests.push({name:t.test_name,status:t.status,turns,guardrailTurns:turns.filter(t=>t.guardrails.length).length,getOfferCalls:turns.flatMap(t=>t.toolActions).filter(t=>t.action==='get_offer'&&t.called).length});
  }
 }
 if(seen.size!==30)throw Error('VOICE_TRACE_INCOMPLETE');
 return {status:'inspected',source,fixtureHash:audit.fixtureHash,branchId:audit.branchId,version:audit.version,count:tests.length,outreach:false,mutatedProvider:false,tests};
}

async function main(){
 if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main')return;
 const [row]=await db('icash_integration_checks?provider=eq.'+source+'&select=result');
 if(row?.result?.status!=='failed')return;
 const [prior]=await db('icash_integration_checks?provider=eq.'+marker+'&select=result');
 if(prior){if(prior.result?.fixtureHash!==row.result.fixtureHash)throw Error('VOICE_TRACE_EVIDENCE_CHANGED');return;}
 if(!process.env.ELEVENLABS_API_KEY)throw Error('VOICE_TRACE_CONFIGURATION_REQUIRED');
 const api=async path=>{
  const response=await fetch('https://api.us.elevenlabs.io'+path,{method:'GET',headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('VOICE_TRACE_HTTP_'+response.status);
  const text=await response.text();if(text.length>5000000)throw Error('VOICE_TRACE_RESPONSE_TOO_LARGE');return JSON.parse(text);
 };
 const result=await inspectVoiceAuditTraces(api,row.result);
 await db('icash_integration_checks','POST',{provider:marker,checked_at:new Date().toISOString(),result});
 console.log('Synthetic voice trace review:',JSON.stringify({count:result.count,guardrailTurns:result.tests.reduce((n,t)=>n+t.guardrailTurns,0),repeatedOfferLookups:result.tests.filter(t=>t.getOfferCalls>1).length,outreach:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 // Diagnostics are supplementary. Their failure never changes the mandatory
 // scenario gate that runs immediately afterward, nor any original audit marker.
 await main().catch(error=>console.log('Voice trace inspection unavailable:',/^[A-Z0-9_]{3,100}$/.test(error.message)?error.message:'VOICE_TRACE_READ_UNCONFIRMED'));
}
