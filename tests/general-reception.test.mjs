import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createReceptionHandlers,inspectReceptionAgent,receptionTarget as target,receptionGreeting,receptionPrompt,receptionUrl,verifyReceptionTwilio,verifyReceptionPostcall,rejectTwiml,receptionRegisterBody,receptionProfiles,resolveReceptionProfile} from '../lib/general-reception.ts';
const now=Date.now(),sid='CA'+'a'.repeat(32),account='AC'+'b'.repeat(32),caller='+12145550199';
const env={RECEPTION_ENABLED:'true',TWILIO_ACCOUNT_SID:account,TWILIO_AUTH_TOKEN:'t'.repeat(32),ELEVENLABS_API_KEY:'local-fixture-only',RECEPTION_POSTCALL_SECRET:'s'.repeat(32)};
function configuration(){
 const c={account_id:target.accountId,owner_user_id:target.ownerUserId,called_number:target.calledNumber,agent_id:target.agentId,branch_id:'agtbrch_reception',reviewed_version_id:'agtvrsn_reception',enabled:true,funding_mode:'customer_credits',receipt_mode:'provider_readback',config_hash:'',call_profile:'normal',rate_id:receptionProfiles.normal.rateId,customer_charge_cap_cents:430,max_duration_seconds:600};
 const agent={agent_id:c.agent_id,branch_id:c.branch_id,main_branch_id:'agtbrch_main',version_id:c.reviewed_version_id,conversation_config:{agent:{first_message:receptionGreeting,prompt:{prompt:receptionPrompt,max_tokens:120,tools:[],tool_ids:[],mcp_server_ids:[],knowledge_base:[]}},asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600}},platform_settings:{auth:{enable_auth:true},privacy:{record_voice:false},call_limits:{agent_concurrency_limit:1,bursting_enabled:false},queueing_config:{enabled:false},overrides:{enable_conversation_initiation_client_data_from_webhook:false,conversation_config_override:{conversation:{max_duration_seconds:true}}}}};
 const branch={id:c.branch_id,agent_id:c.agent_id,is_archived:false,current_live_percentage:0,draft_exists:false};
 c.config_hash=inspectReceptionAgent(c,agent,branch).hash;
 return {c,agent,branch};
}
function form(extra={}){return new URLSearchParams({AccountSid:account,CallSid:sid,To:target.calledNumber,From:caller,Direction:'inbound',CallStatus:'ringing',...extra});}
function request(params=form(),signatureOverride,options={}){
 const signature=createHmac('sha1',env.TWILIO_AUTH_TOKEN).update(receptionUrl+[...params.keys()].sort().map(k=>k+params.get(k)).join('')).digest('base64');
 return new Request(receptionUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','x-twilio-signature':signatureOverride??signature},body:params.toString(),...options});
}
function fixture(options={}){
 const {c,agent,branch}=configuration(),calls=[],rpcCalls=[];let reservation=null;const dedup=new Set();
 options.mutate?.({c,agent,branch});
 const fetcher=async(url,init={})=>{
  calls.push({url,init});if(options.fetchThrows)throw Error('provider-private-error');
  if(url.includes('api.twilio.com'))return Response.json({sid,account_sid:account,to:target.calledNumber,from:caller,direction:'inbound',status:'ringing',date_created:new Date(now).toISOString(),...options.call});
  if(init.method==='POST'){
   assert(reservation,'No registration before durable reserve');
   if(options.registerThrows)throw Error('write-unknown');
   return new Response(options.xml===undefined?'<Response><Connect><Stream url="wss://api.us.elevenlabs.io/stream"/></Connect></Response>':String(options.xml),{headers:{'Content-Type':'text/xml'}});
  }
  return Response.json(url.includes('/branches?')?(options.branches??{results:[branch],meta:{total:1}}):agent);
 };
 const rpc=async(name,body)=>{
  rpcCalls.push({name,body});
  if(name==='icash_get_general_reception_config')return options.missingConfig?null:c;
  if(name==='icash_reserve_general_reception'){
   if(options.denied||dedup.has(body.p_call_sid))return {allowed:false};
   dedup.add(body.p_call_sid);
   reservation={receipt_id:'local-receipt',operation_key:'reception:'+body.p_call_sid,customer_charge_cap_cents:c.customer_charge_cap_cents,call_profile:c.call_profile,rate_id:c.rate_id,receipt_nonce:body.p_receipt_nonce,call_sid:body.p_call_sid,agent_id:c.agent_id,branch_id:c.branch_id,reviewed_version_id:c.reviewed_version_id,config_hash:c.config_hash,max_duration_seconds:c.max_duration_seconds};
   return {allowed:true,receipt:{...reservation,...options.badReceipt}};
  }
  if(name==='icash_finish_general_reception')return options.finishNull?null:{state:'completed'};
  throw Error('Unexpected RPC');
 };
 return {c,agent,branch,calls,rpcCalls,get reservation(){return reservation;},handler:createReceptionHandlers({...env,...options.env},{rpc,fetcher,now:()=>now})};
}
const good=fixture();let response=await good.handler.inbound(request());assert.match(await response.text(),/<Connect>/);assert.equal(good.calls.filter(x=>x.init.method==='POST').length,1);
const registered=JSON.parse(good.calls.find(x=>x.init.method==='POST').init.body);assert.deepEqual(registered,receptionRegisterBody(good.c,caller,sid,good.reservation.receipt_nonce));assert.equal(registered.direction,'inbound');assert.equal(registered.conversation_initiation_client_data.user_id,'icash-reception:'+good.reservation.receipt_nonce);
assert.equal(await (await good.handler.inbound(request())).text(),rejectTwiml);assert.equal(good.calls.filter(x=>x.init.method==='POST').length,1);
for(const options of [{env:{RECEPTION_ENABLED:undefined}},{env:{TWILIO_ACCOUNT_SID:'wrong'}},{missingConfig:true},{denied:true},{fetchThrows:true},{registerThrows:true},{xml:{}},{badReceipt:{customer_charge_cap_cents:66}},{badReceipt:{operation_key:'foreign'}},{badReceipt:{call_sid:'CA'+'c'.repeat(32)}},{call:{status:'completed'}},{call:{date_created:new Date(now-121000).toISOString()}},{call:{account_sid:'foreign'}},{call:{from:'+19995550199'}},{branches:{results:[],meta:{total:1}}},{branches:{results:[],meta:{total:0}}}]){
 const f=fixture(options);assert.equal(await (await f.handler.inbound(request())).text(),rejectTwiml);
 if(!options.registerThrows&&!options.xml)assert.equal(f.calls.filter(x=>x.init.method==='POST').length,0);
}
for(const mutate of [x=>x.agent.conversation_config.agent.prompt.built_in_tools={transfer_to_number:{}},x=>x.agent.conversation_config.agent.prompt.built_in_tools={transfer_to_number:[]},x=>x.agent.conversation_config.agent.prompt.built_in_tools={memory_entry_create:{}},x=>x.agent.conversation_config.agent.prompt.native_mcp_server_ids=['mcp_privileged'],x=>x.agent.conversation_config.agent.prompt.built_in_tools={transfer_to_number:{type:'system',name:'transfer_to_number',params:{system_tool_type:'transfer_to_number'}}},x=>x.agent.conversation_config.agent.prompt.built_in_tools={end_call:{type:'system',name:'end_call',params:{system_tool_type:'transfer_to_number'}}},x=>x.agent.conversation_config.language_presets={es:{agent:{prompt:{prompt:'unsafe'}}}},x=>x.agent.platform_settings.overrides.enable_procedure_ids_from_client=true,x=>x.agent.platform_settings.workspace_overrides={webhooks:{events:['transcript']}},x=>x.agent.conversation_config.agent.prompt.max_tokens=-1,x=>x.agent.conversation_config.agent.prompt.max_tokens=151,x=>x.agent.conversation_config.agent.prompt.tool_ids=['tool_privileged'],x=>x.agent.conversation_config.agent.prompt.tools=[{type:'system',name:'transfer_to_number'}],x=>x.agent.conversation_config.agent.prompt.knowledge_base=['private'],x=>x.agent.conversation_config.agent.first_message='Hi human here',x=>x.agent.conversation_config.conversation.max_duration_seconds=60,x=>x.agent.platform_settings.privacy.record_voice=true,x=>x.agent.platform_settings.call_limits.bursting_enabled=true,x=>x.agent.platform_settings.overrides.enable_conversation_initiation_client_data_from_webhook=true,x=>x.agent.platform_settings.queueing_config.enabled=true,x=>x.branch.draft_exists=true,x=>x.branch.current_live_percentage=1,x=>x.agent.workflow={nodes:{execute:{type:'tool'}}},x=>x.c.account_id='foreign',x=>x.c.config_hash='stale',x=>x.c.enabled=false,x=>x.c.funding_mode='business']){
 const f=fixture({mutate});assert.equal(await (await f.handler.inbound(request())).text(),rejectTwiml);assert.equal(f.calls.filter(x=>x.init.method==='POST').length,0);
}
for(const params of [form({To:'+19995550199'}),form({Direction:'outbound-api'}),form({AccountSid:'AC'+'c'.repeat(32)}),form({CallSid:'invalid'}),form({From:'<xml>'})]){const f=fixture();assert.equal(await(await f.handler.inbound(request(params))).text(),rejectTwiml);assert.equal(f.calls.length,0);}
for(const req of [request(form(),'forged'),request(form(),undefined,{headers:{'Content-Type':'application/json'}}),new Request(receptionUrl+'?spoof=1',{method:'POST'})]){const f=fixture();assert.equal(await(await f.handler.inbound(req)).text(),rejectTwiml);assert.equal(f.calls.length,0);}
const duplicate=form();duplicate.append('To',target.calledNumber);assert.equal(verifyReceptionTwilio(duplicate.toString(),'a'.repeat(27)+'=',env.TWILIO_AUTH_TOKEN),null);
const expanded=form({FutureTwilioField:'preserve spaces  '});assert.match(await(await fixture().handler.inbound(request(expanded))).text(),/<Connect>/);
for(const from of ['anonymous','restricted','unknown','+442079460000']){const f=fixture({call:{from}});assert.match(await(await f.handler.inbound(request(form({From:from})))).text(),/<Connect>/);}
function post(event,signatureOverride){const raw=JSON.stringify(event),timestamp=Math.floor(now/1000);const signature=`t=${timestamp},v0=`+createHmac('sha256',env.RECEPTION_POSTCALL_SECRET).update(timestamp+'.'+raw).digest('hex');return new Request('https://www.geticashx.com/api/reception/postcall',{method:'POST',headers:{'Content-Type':'application/json','elevenlabs-signature':signatureOverride??signature},body:raw});}
const event={type:'post_call_transcription',data:{agent_id:good.c.agent_id,branch_id:good.c.branch_id,version_id:good.c.reviewed_version_id,conversation_id:'conv_reception',status:'done',conversation_initiation_client_data:registered.conversation_initiation_client_data,transcript:[{role:'agent',message:'Invented verified fact'},{role:'user',message:'I say I own 123 Main Street'},{role:'user',message:''},{role:'user',message:'   '}] ,metadata:{phone_call:{call_sid:sid}}}};
assert.equal((await good.handler.postcall(post(event))).status,200);
const saved=good.rpcCalls.find(x=>x.name==='icash_finish_general_reception').body;assert.deepEqual(saved.p_caller_statements,['I say I own 123 Main Street']);assert.equal(saved.p_branch_id,good.c.branch_id);assert.equal(saved.p_call_sid,sid);
assert.equal((await good.handler.postcall(post(event,'forged'))).status,401);
for(const mutate of [e=>e.data.version_id='',e=>e.data.branch_id='agtbrch_foreign',e=>e.data.agent_id='agent_foreign',e=>e.data.metadata.phone_call.call_sid='CA'+'c'.repeat(32),e=>e.data.conversation_initiation_client_data.dynamic_variables.icash_reception_receipt_nonce='invalid',e=>e.data.status='in-progress']){const e=structuredClone(event);mutate(e);const f=fixture();assert.equal((await f.handler.postcall(post(e))).status,400);assert.equal(f.rpcCalls.length,0);}
assert.equal((await fixture({finishNull:true}).handler.postcall(post(event))).status,409);
assert.equal((await fixture().handler.postcall(post({type:'post_call_audio',data:{}}))).status,200);
assert.equal(verifyReceptionPostcall('{}','t=1,v0='+'0'.repeat(64),env.RECEPTION_POSTCALL_SECRET,now),false);
assert.equal(verifyReceptionPostcall('{}','t='+Math.floor(now/1000+3600)+',v0='+'0'.repeat(64),env.RECEPTION_POSTCALL_SECRET,now),false);
for(const path of ['lib/general-reception.ts','lib/general-reception-server.ts']){const s=readFileSync(path,'utf8');assert(!/console\./.test(s));assert(!/customer.*(?:credit|wallet).*POST/i.test(s));assert(!s.includes('icash_live_'));}
console.log('General reception: signed admission, stale replay, target isolation, all-caller intake, once-only registration, failure holds and signed exact receipt tests passed');

const quickMutation=({c,agent,branch})=>{Object.assign(c,{call_profile:'owner_quick_test',rate_id:receptionProfiles.owner_quick_test.rateId,customer_charge_cap_cents:65,max_duration_seconds:60,owner_quick_test_enabled:true,owner_quick_test_approval_reference:'explicit-owner-approval',owner_caller_hash:createHmac('sha256',env.TWILIO_AUTH_TOKEN).update('reception-caller-v1\0'+caller).digest('hex')});agent.conversation_config.conversation.max_duration_seconds=60;c.config_hash=inspectReceptionAgent(c,agent,branch).hash;};
const quick=fixture({mutate:quickMutation});assert.match(await(await quick.handler.inbound(request())).text(),/<Connect>/);assert.equal(quick.reservation.customer_charge_cap_cents,65);
for(const mutate of [x=>{quickMutation(x);x.c.owner_quick_test_enabled=false;},x=>{quickMutation(x);x.c.owner_quick_test_approval_reference='';},x=>{quickMutation(x);x.c.owner_caller_hash='a'.repeat(64);},x=>{x.c.max_duration_seconds=60;},x=>{x.c.customer_charge_cap_cents=65;},x=>{x.c.call_profile=undefined;}]){const f=fixture({mutate});assert.equal(await(await f.handler.inbound(request())).text(),rejectTwiml);assert.equal(f.calls.length,0);}
const foreignQuick=fixture({mutate:quickMutation,call:{from:'anonymous'}});assert.equal(await(await foreignQuick.handler.inbound(request(form({From:'anonymous'})))).text(),rejectTwiml);assert.equal(foreignQuick.calls.length,0);
assert.equal(good.reservation.customer_charge_cap_cents,430);assert.equal(registered.conversation_initiation_client_data.conversation_config_override.conversation.max_duration_seconds,600);assert.equal(resolveReceptionProfile({...good.c,max_duration_seconds:60}),null);
console.log('Profiles: normal600/430c, explicit owner-only60/65c, no short fallback, exact immutable receipt tier passed');
