import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {ownerInboundTarget} from '../lib/owner-inbound-acceptance.ts';
import {inboundAuthorized,inboundCallSchema,inboundCapability,inboundInitiation} from '../lib/inbound-voice.ts';
const secret='a'.repeat(64),events=[];
const call={caller_id:'+12125550123',called_number:'+12125550199',agent_id:'agent_fixture',call_sid:'CA'+'1'.repeat(32),conversation_id:'conv_fixture'};
let registered=true,admitted=true,lookupError=false,context={status:'matched',address:'123 Fixture Lane',returningName:'Jane',seller:'Secret Owner',sms:['Secret SMS'],ceiling:900000};
const env={ELEVENLABS_INBOUND_WEBHOOK_SECRET:secret,ICASH_LIVE_WORK_READY:'true'};
const db=async(path,method,body)=>{
 events.push({path,body});
 if(path.startsWith('icash_inbound_voice_routes?'))return registered?[{agent_id:call.agent_id}]:[];
 if(path==='rpc/icash_begin_inbound_voice')return admitted?{maxSeconds:600}:null;
 assert.equal(path,'rpc/icash_inbound_property_context');assert.equal(method,'POST');
 if(lookupError)throw Error('PRIVATE DATABASE ERROR');return context;
};
const route=await loadService('app/api/internal/voice/inbound/route.ts',{NextResponse:{json:Response.json},createHash,process:{env},db,
 elevenRequest:async()=>{events.push({path:'provider-read'});return {conversation_config:{}};},
 beginAudioOnce:async()=>({ownerFixture:true}),ownerInboundTarget,inboundAuthorized,inboundCallSchema,inboundCapability,inboundInitiation});
const request=(body=call,auth='Bearer '+secret)=>new Request('https://fixture.invalid/api/internal/voice/inbound',{method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify(body)});
let response=await route.POST(request());assert.equal(response.status,200);let payload=await response.json();
assert.deepEqual(events.map(x=>x.path.startsWith('icash_inbound_voice_routes?')?'route':x.path),['route','provider-read','rpc/icash_begin_inbound_voice','rpc/icash_inbound_property_context']);
const cap=inboundCapability(call,secret);assert.deepEqual(events.at(-1).body,{p_call_sid:call.call_sid,p_conversation:call.conversation_id,p_binding_hash:cap.bindingHash,p_token_hash:cap.hash});
assert(!JSON.stringify(events).includes(cap.token),'Lookup never stores plaintext capability');
assert.match(payload.conversation_config_override.agent.first_message,/123 Fixture Lane/);
assert.match(payload.conversation_config_override.agent.first_message,/Jane/);
for(const privateValue of ['Secret Owner','Secret SMS','900000'])assert(!JSON.stringify(payload).includes(privateValue));
assert.equal(response.headers.get('cache-control'),'private, no-store');
assert.equal(payload.dynamic_variables.approved_offer_ceiling,'NOT AUTHORIZED');
for(const missing of [null,{status:'ambiguous'},{status:'matched',address:42},{status:'matched',address:'Bad\naddress'},{}]){
 context=missing;events.length=0;response=await route.POST(request());assert.equal(response.status,200);payload=await response.json();
 assert.match(payload.conversation_config_override.agent.first_message,/Which property/);
 assert.equal(events.filter(e=>e.path==='rpc/icash_begin_inbound_voice').length,1,'No repeat admission for unknown context');
}
lookupError=true;events.length=0;response=await route.POST(request());assert.equal(response.status,200);payload=await response.json();
assert.match(payload.conversation_config_override.agent.first_message,/Which property/);assert(!JSON.stringify(payload).includes('PRIVATE DATABASE'));
assert.equal(events.filter(e=>e.path==='rpc/icash_begin_inbound_voice').length,1);lookupError=false;
for(const rejection of ['unauthorized','held','unregistered','unmatched','extra-account']){
 events.length=0;registered=rejection!=='unregistered';admitted=rejection!=='unmatched';env.ICASH_LIVE_WORK_READY=rejection==='held'?'false':'true';
 response=await route.POST(request(rejection==='extra-account'?{...call,account_id:'caller-choice'}:call,rejection==='unauthorized'?'Bearer invalid':'Bearer '+secret));
 assert.notEqual(response.status,200,rejection);assert(!events.some(e=>e.path==='rpc/icash_inbound_property_context'),rejection);
}
events.length=0;response=await route.POST(request({...call,caller_id:ownerInboundTarget.ownerPhone,called_number:ownerInboundTarget.ingressNumber,agent_id:ownerInboundTarget.agentId}));
assert.deepEqual(await response.json(),{ownerFixture:true});assert.deepEqual(events,[]);
console.log('Inbound property-context route passed: admission-before-context, exact hashed binding, first-name/address allowlist, unknown/ambiguous/error fallback, owner isolation and unchanged holds.');
