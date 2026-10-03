import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {inspectOutboundReadiness,inspectOutboundTools,outboundAuthorizationShape,readOutboundReadiness,validOutboundTemplate} from '../lib/owner-outbound-readiness.ts';
const config={agent:{max_conversation_duration_message:'',prompt:{tool_ids:['tool_one','tool_two'],max_tokens:120,prompt:'PRIVATE PROMPT'}},conversation:{max_duration_seconds:600}};
const template={id:1,enabled:false,agent_id:'agent_test',phone_number_id:'phnum_test',agent_config_hash:createHash('sha256').update(JSON.stringify(config)).digest('hex'),required_tool_ids:['tool_one','tool_two'],max_duration_seconds:600,reviewed_at:'2026-01-01T00:00:00Z',reviewed_until:'2099-01-01T00:00:00Z'};
const agent={agent_id:template.agent_id,conversation_config:config,platform_settings:{overrides:{conversation_config_override:{agent:{first_message:true,prompt:{prompt:true}},conversation:{max_duration_seconds:true}}}}};
const phone={phone_number_id:template.phone_number_id,phone_number:'+12125551212',provider:'twilio'};
assert(validOutboundTemplate(template));assert(!validOutboundTemplate({...template,agent_id:'../agent_other'}));
const result=inspectOutboundReadiness(template,agent,phone,phone.phone_number);assert.equal(result.runtimeConfigChecksPass,true);assert.equal(result.templateEnabled,false);assert(!JSON.stringify(result).includes('PRIVATE PROMPT'));assert(!JSON.stringify(result).includes(phone.phone_number));
for(const bad of [{...agent,agent_id:'wrong'},{...agent,platform_settings:{}},{...agent,conversation_config:{...config,conversation:{max_duration_seconds:601}}}])assert.equal(inspectOutboundReadiness(template,bad,phone,phone.phone_number).runtimeConfigChecksPass,false);
assert.equal(inspectOutboundReadiness(template,agent,phone,'+12125550000').runtimeConfigChecksPass,false);
const calls=[];const fetcher=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.includes('/phone-numbers/')?phone:agent),{headers:{'content-type':'application/json'}})};
assert.equal((await readOutboundReadiness(template,'fake-test-key',phone.phone_number,fetcher)).runtimeConfigChecksPass,true);
assert.equal(calls.length,4);for(const call of calls){assert.equal(call.options.method,'GET');assert.equal(call.options.redirect,'error');assert.equal(call.options.body,undefined);assert(call.url.startsWith('https://api.elevenlabs.io/v1/convai/'));}
await assert.rejects(readOutboundReadiness({...template,phone_number_id:'other'},'key',phone.phone_number,fetcher));
await assert.rejects(readOutboundReadiness(template,'key',phone.phone_number,async()=>new Response('private provider error',{status:401})));
await assert.rejects(readOutboundReadiness(template,'key',phone.phone_number,async()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'1048577'}})));
const route=readFileSync(new URL('../app/api/owner-outbound-readiness/route.ts',import.meta.url),'utf8');assert(route.includes('currentUser(false)'));assert(route.includes('user.id!==ownerInboundTarget.ownerUserId'));assert(!route.includes('rpc/'));assert(!route.includes('export async function POST'));assert(route.includes('new URL(request.url).search'));
console.log('Owner outbound read-only readiness tests passed');
const {loadService}=await import('./helpers/simulated-journey-services.mjs');
let signedUser=null,dbCalls=[],providerCalls=0;
const ownerInboundTarget={ownerUserId:'owner',accountId:'account'};
const {GET}=await loadService('app/api/owner-outbound-readiness/route.ts',{
 NextResponse:{json:(body,init)=>Response.json(body,init)},ownerInboundTarget,
 currentUser:async(refresh)=>{assert.equal(refresh,false);return signedUser;},
 db:async(path,method)=>{assert.equal(method,undefined);dbCalls.push(path);return path.startsWith('icash_accounts?')?[{id:'account'}]:[template];},
 validOutboundTemplate,readOutboundReadiness:async()=>{providerCalls++;return result;},
});
for(const [user,url,status] of [[null,'https://local/api/owner-outbound-readiness',401],[{id:'other'},'https://local/api/owner-outbound-readiness',403],[{id:'owner'},'https://local/api/owner-outbound-readiness?agent_id=agent_other',400]]){
 signedUser=user;const response=await GET(new Request(url));assert.equal(response.status,status);assert.equal(providerCalls,0);assert.equal(dbCalls.length,0);
}
signedUser={id:'owner'};const response=await GET(new Request('https://local/api/owner-outbound-readiness'));assert.equal(response.status,200);assert.equal(providerCalls,1);assert.equal(dbCalls.length,2);assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');
console.log('Outbound route auth, input rejection, GET-only DB/provider tests passed');

assert.equal(inspectOutboundReadiness({...template,reviewed_at:'2098-01-01T00:00:00Z'},agent,phone,phone.phone_number).checks.reviewCurrent,false);

const tools=['callback','handoff'].map((role,index)=>{const keys=role==='callback'?['conversationId','dueAt','timezone','readback','confirmation']:['conversationId','reason'];return {id:template.required_tool_ids[index],tool_config:{type:'webhook',api_schema:{url:'https://www.geticashx.com/api/internal/voice/'+role,method:'POST',request_headers:{Authorization:{variable_name:'secret__icash_call_token'}},request_body_schema:{type:'object',required:keys,properties:Object.fromEntries(keys.map(k=>[k,{type:'string',...(k==='conversationId'?{dynamic_variable:'system__conversation_id'}:{})}]))}}}}});
assert.equal(inspectOutboundTools(template,tools).toolDefinitionsVerified,true);
for(const change of [t=>t.id='other',t=>t.tool_config.api_schema.url='https://evil.invalid',t=>t.tool_config.api_schema.method='GET',t=>t.tool_config.api_schema.request_headers.Authorization='Bearer private-fixed-secret',t=>t.tool_config.api_schema.request_body_schema.properties.conversationId.dynamic_variable='',t=>t.response_mocks=[{}]]){const bad=structuredClone(tools);change(bad[0]);const out=inspectOutboundTools(template,bad);assert.equal(out.toolDefinitionsVerified,false);assert(!JSON.stringify(out).includes('private-fixed-secret'));assert(!JSON.stringify(out).includes('evil.invalid'));}
assert.equal(inspectOutboundTools(template,[tools[0],tools[0]]).toolDefinitionsVerified,false);
console.log('Outbound tool metadata endpoint, auth, conversation binding and redaction tests passed');

// Exact typed per-call locator only; strings are not ElevenLabs interpolation.
for(const [headers,shape,pass] of [[{Authorization:{variable_name:'secret__icash_call_token'}},'exact_call_token_locator',true],[{authorization:{variable_name:'secret__icash_call_token'}},'exact_call_token_locator',true],[{Authorization:'Bearer {{secret__icash_call_token}}'},'literal_template',false],[{Authorization:'PRIVATE_SECRET'},'literal_value',false],[{Authorization:{variable_name:'public_token'}},'other_variable_locator',false],[{Authorization:{variable_name:'secret__icash_call_token',extra:'PRIVATE_SECRET'}},'unrecognized',false],[{Authorization:{secret_id:'PRIVATE_SECRET'}},'workspace_secret_reference',false],[{Authorization:{env_var_label:'PRIVATE_SECRET'}},'environment_reference',false],[{Authorization:{variable_name:'secret__icash_call_token'},authorization:'other'},'duplicate',false],[{},'missing',false]]){assert.equal(outboundAuthorizationShape(headers),shape);const altered=structuredClone(tools);altered[0].tool_config.api_schema.request_headers=headers;const checked=inspectOutboundTools(template,altered);assert.equal(checked.tools[0].checks.scopedCallAuthorization,pass);assert(!JSON.stringify(checked).includes('PRIVATE_SECRET'));}
const changed=inspectOutboundReadiness({...template,agent_config_hash:'f'.repeat(64)},{...agent,conversation_config:{...config,agent:{...config.agent,first_message:'PRIVATE_GREETING',prompt:{...config.agent.prompt,prompt:'PRIVATE_PROMPT',custom_llm:{url:'PRIVATE_URL'},knowledge_base:[{id:'PRIVATE_ID'}]}}}},phone,phone.phone_number);
assert.equal(changed.checks.configHashMatches,false);assert.equal(changed.runtimeConfigChecksPass,false);assert.equal(changed.configurationDriftExplanation,'not_determined_without_reviewed_snapshot');assert.equal(changed.configurationShape.knowledgeBaseCount,1);assert.equal(changed.configurationShape.customLlmConfigured,true);for(const secret of ['PRIVATE_GREETING','PRIVATE_PROMPT','PRIVATE_URL','PRIVATE_ID'])assert(!JSON.stringify(changed).includes(secret));
console.log('Exact typed header locator recognition and non-authorizing redacted configuration-shape diagnostics passed');
// Execute unchanged production receivers with the exact bare synthetic value
// supplied by dispatch and resolved by a typed locator; never use live tokens.
const {z}=await import('zod');
const syntheticToken='a'.repeat(64),receiverCalls=[];
for(const [file,body] of [['app/api/internal/voice/callback/route.ts',{conversationId:'conv_test',dueAt:'2099-01-01T12:00:00Z',timezone:'UTC',readback:'Synthetic callback readback',confirmation:'yes'}],['app/api/internal/voice/handoff/route.ts',{conversationId:'conv_test',reason:'Synthetic handoff'}]]){
 const {POST}=await loadService(file,{NextResponse:{json:(body,init)=>Response.json(body,init)},createHash,z,db:async(path,method,args)=>{receiverCalls.push({path,method,args});return {saved:true};}});
 const before=receiverCalls.length;const response=await POST(new Request('https://local/tool',{method:'POST',headers:{authorization:syntheticToken,'content-type':'application/json'},body:JSON.stringify(body)}));assert.equal(response.status,200);assert.equal(receiverCalls.length,before+1);assert.equal(receiverCalls.at(-1).args.p_hash,createHash('sha256').update(syntheticToken).digest('hex'));assert.equal(receiverCalls.at(-1).args.p_conversation,'conv_test');
 const rejected=await POST(new Request('https://local/tool',{method:'POST',headers:{authorization:'Bearer {{secret__icash_call_token}}','content-type':'application/json'},body:JSON.stringify(body)}));assert.equal(rejected.status,401);assert.equal(receiverCalls.length,before+1);
}
console.log('Unchanged callback/handoff routes accept exact synthetic call-token locator value and reject literal templates');
for(const value of [null,[],['secret__icash_call_token'],0,false,{variable_name:null},{variable_name:1},{variable_name:' secret__icash_call_token'},{variable_name:'secret__icash_call_token '},{variable_name:'SECRET__ICASH_CALL_TOKEN'},{variable_name:'{{secret__icash_call_token}}'}])assert.notEqual(outboundAuthorizationShape({Authorization:value}),'exact_call_token_locator');
const reordered={conversation:config.conversation,agent:config.agent};
assert.deepEqual(reordered,config);const serializationOnly=inspectOutboundReadiness(template,{...agent,conversation_config:reordered},phone,phone.phone_number);
assert.equal(serializationOnly.checks.configHashMatches,false);assert.equal(serializationOnly.runtimeConfigChecksPass,false);assert.equal(serializationOnly.configurationDriftExplanation,'not_determined_without_reviewed_snapshot');
