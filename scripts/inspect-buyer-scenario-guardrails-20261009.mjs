// Read only the completed, synthetic v5 suite. No new tests or provider writes.
import {db} from '../lib/stripe-test.ts';
import {boundedBytes} from '../lib/required-call-recording-provider.ts';
const marker='buyer_scenario_guardrail_inspection_20261009_v1';
if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main')process.exit(0);
const [prior]=await db('icash_integration_checks?provider=eq.'+marker+'&select=result');
if(prior?.result?.status==='inspected')process.exit(0);
if(prior||Date.now()>Date.parse('2026-10-10T00:00:00Z'))throw Error('BUYER_GUARDRAIL_INSPECTION_WINDOW_REQUIRED');
const [row]=await db('icash_integration_checks?provider=eq.buyer_scenario_audit_20261009_v5&select=result');
const audit=row?.result;
if(audit?.status!=='failed'||audit.code!=='BUYER_SCENARIO_FAILURES_REQUIRE_FIX'||audit.fixtureHash!=='d1012080ea3ac92001d5467ed78c4c5e81f929131f2671b3e41ba30658a1b1ea'||audit.branchId!=='agtbrch_9501m4heehy0eftbhsq5za6ghzkx'||audit.version!=='agtvrsn_0801m4heehxzedxsa4p74a39ev59'||audit.tests?.length!==30||audit.invocations?.length!==6||new Set(audit.invocations).size!==6||audit.invocations.some(id=>!/^suite_[A-Za-z0-9]+$/.test(id)))throw Error('EXACT_COMPLETED_BUYER_AUDIT_REQUIRED');
if(!process.env.ELEVENLABS_API_KEY)throw Error('BUYER_PROVIDER_CONFIGURATION_REQUIRED');
const expected=new Map(audit.tests.map(t=>[t.name,t.status])),tests=[];
const safeText=value=>typeof value==='string'?value.replaceAll(process.env.ELEVENLABS_API_KEY,'[redacted]').slice(0,4000):null;
for(const id of audit.invocations){
 const response=await fetch('https://api.us.elevenlabs.io/v1/convai/test-invocations/'+id,{headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY},redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('BUYER_GUARDRAIL_READBACK_REQUIRED');
 const invocation=JSON.parse((await boundedBytes(response,16*1024*1024)).toString('utf8'));
 if(invocation.branch_id!==audit.branchId||invocation.version_id!==audit.version||!Array.isArray(invocation.test_runs)||invocation.test_runs.length>6)throw Error('BUYER_GUARDRAIL_VERSION_CHANGED');
 for(const t of invocation.test_runs){
  if(!expected.has(t.test_name)||expected.get(t.test_name)!==t.status||tests.some(test=>test.name===t.test_name)||t.branch_id!==audit.branchId||t.version_id!==audit.version||!Array.isArray(t.agent_responses)||t.agent_responses.length>160)throw Error('BUYER_GUARDRAIL_TEST_CHANGED');
  tests.push({name:t.test_name,status:t.status,turns:t.agent_responses.map(m=>({role:m.role==='agent'?'agent':m.role==='user'?'user':'other',message:safeText(m.message),originalMessage:safeText(m.original_message),producingLlm:safeText(m.producing_llm),guardrails:Array.isArray(m.triggered_guardrails)?m.triggered_guardrails.slice(0,8).map(g=>({type:safeText(g.guardrail_type),name:safeText(g.guardrail_name)})):[],actions:Array.isArray(m.tool_calls)?m.tool_calls.slice(0,8).map(c=>{if(c.tool_name!=='icash_offer_and_contract')return c.tool_name==='end_call'?'end_call':'other';try{const action=JSON.parse(c.params_as_json).action;return ['get_offer','accept_offer','update_repairs','report_change','confirm_and_send','status'].includes(action)?action:'other';}catch{return 'invalid';}}):[]})).filter(m=>m.message||m.originalMessage||m.guardrails.length||m.actions.length)});
 }
}
if(tests.length!==30)throw Error('COMPLETE_BUYER_GUARDRAIL_READBACK_REQUIRED');
await db('icash_integration_checks','POST',{provider:marker,checked_at:new Date().toISOString(),result:{status:'inspected',auditProvider:'buyer_scenario_audit_20261009_v5',fixtureHash:audit.fixtureHash,branchId:audit.branchId,version:audit.version,count:tests.length,outreach:false,providerWrites:false,tests}});
console.log('Completed synthetic buyer guardrail evidence saved; no provider mutation or outreach.');
