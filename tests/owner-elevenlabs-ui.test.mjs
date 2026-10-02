import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';

// Component-only simulation: no real timers, provider calls, credentials or writes.
const require=createRequire(import.meta.url),raw='RAW_PRIVATE_RESPONSE_MUST_NOT_RENDER';
const code=ts.transpileModule(readFileSync('app/owner-inbound-acceptance/owner-elevenlabs-readiness.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const fixture={status:'checked',region:'us',checkedAt:'2026-10-02T02:50:00.000Z',callVerification:'not_tested',
 agent:{status:'checked',model:'gemini-2.5-flash',maxTokens:150,maxTokensStatus:'bounded',maxDurationSeconds:60,queueEnabled:false,queueWaitTimeoutSeconds:30,burstingEnabled:false,
  privacy:{recordVoice:false,retentionDays:7,deleteTranscriptAndPii:true,deleteAudio:true,zeroRetentionMode:false},authenticationEnabled:true,initiationWebhookEnabled:true,
  webhookAuthentication:{scope:'private_test_branch_override_only',overrideConfigured:true,webhookUrl:'https://www.geticashx.com/api/internal/voice/inbound',webhookUrlMatchesCanonical:true,authorizationHeaderPresent:true,authorizationHeaderUnique:true,authorizationBearerScheme:true,authorizationValueComparable:false,serverWebhookSecretConfigured:true,authorizationMatchesServerSecret:null,workspaceFallback:'not_read'}},
 branch:{status:'checked',archived:false,liveTrafficPercent:0},phone:{status:'checked',assignedAgentMatches:true,assignedBranchMatches:null}};
fixture.incomingDefault={status:'checked',assignedPhoneBranchMatches:true,initiationWebhookEnabled:true,webhookAuthentication:{...fixture.agent.webhookAuthentication,scope:'default_agent_override_only'},requestAuthenticationVerified:false};
function nodes(root){return root&&typeof root==='object'?Array.isArray(root)?root.flatMap(nodes):[root,...nodes(root.props?.children)]:[];}
function text(root){return typeof root==='string'||typeof root==='number'?String(root):Array.isArray(root)?root.map(text).join(' '):root&&typeof root==='object'?text(root.props?.children):'';}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function mount(transport){
 let slots=[],cursor=0,pending=[],tree,dirty=true,mounted=true,writesAfterUnmount=0,timerId=0;
 const calls=[],timers=new Map();
 const hooks={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{if(!mounted)writesAfterUnmount++;slots[i]=value;dirty=true;}];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useEffect(fn,deps){const i=cursor++;if(!slots[i]){slots[i]={deps};pending.push(()=>{slots[i].cleanup=fn();});}},
 };
 const fetcher=async(url,options)=>{calls.push({url,options});assert.equal(url,'/api/owner-inbound-acceptance/elevenlabs');assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.body,undefined);return transport(calls.length,options);};
 const mod={exports:{}};
 new Function('require','module','exports','fetch','setTimeout','clearTimeout',code)(name=>name==='react'?hooks:require(name),mod,mod.exports,fetcher,(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},id=>timers.delete(id));
 function render(){cursor=0;dirty=false;tree=mod.exports.default();}
 async function flush(){for(let i=0;i<20;i++){if(dirty&&mounted)render();const tasks=pending;pending=[];tasks.forEach(fn=>fn());await Promise.resolve();}return tree;}
 render();
 return {calls,timers,flush,get tree(){return tree;},get writesAfterUnmount(){return writesAfterUnmount;},
  button(){const button=nodes(tree).find(node=>node.type==='button');assert(button);return button;},
  expire(){assert.equal(timers.size,1);const [id,timer]=[...timers][0];assert.equal(timer.delay,65000);timers.delete(id);timer.callback();},
  unmount(){mounted=false;slots.forEach(slot=>slot?.cleanup?.());},
 };
}
const normal=mount(()=>Response.json(fixture));await normal.flush();assert.equal(normal.calls.length,0,'no read on mount');normal.button().props.onClick();await normal.flush();
assert.match(text(normal.tree),/gemini-2.5-flash/);assert.match(text(normal.tree),/150/);assert.match(text(normal.tree),/https:\/\/www.geticashx.com\/api\/internal\/voice\/inbound/);
for(const label of ['Exactly one Authorization header','Authorization uses the expected Bearer prefix','Configured Authorization equals the server secret'])assert(text(normal.tree).includes(label));
assert(text(normal.tree).indexOf('Default incoming webhook authentication')<text(normal.tree).indexOf('Private test branch settings'));assert(text(normal.tree).includes('does not prove which Authorization header was delivered'));
assert.equal(normal.button().props.disabled,false);assert.equal(normal.timers.size,0);normal.unmount();

const pending=deferred(),duplicate=mount(()=>pending.promise);await duplicate.flush();const click=duplicate.button().props.onClick;click();click();await duplicate.flush();assert.equal(duplicate.calls.length,1);assert.equal(duplicate.button().props.disabled,true);pending.resolve(Response.json(fixture));await duplicate.flush();assert.equal(duplicate.button().props.disabled,false);assert.equal(duplicate.timers.size,0);duplicate.unmount();

const malformed=[null,[],{},raw,{status:'checked',agent:{},branch:{},phone:{}}];
for(const change of [
 x=>delete x.incomingDefault,x=>x.incomingDefault.webhookAuthentication.scope='private_test_branch_override_only',x=>x.agent.webhookAuthentication.scope='agent_override_only',x=>x.incomingDefault.requestAuthenticationVerified=true,x=>x.incomingDefault.assignedPhoneBranchMatches=raw,
 x=>x.status=raw,x=>x.agent.status=raw,x=>x.agent.model=raw,x=>x.agent.model={secret:raw},
 x=>delete x.agent.privacy,x=>x.agent.privacy.recordVoice=raw,x=>delete x.agent.webhookAuthentication,
 x=>x.agent.webhookAuthentication.webhookUrl='https://private.invalid/'+raw,x=>x.agent.webhookAuthentication.authorizationHeaderUnique=raw,
 x=>x.agent.maxTokens=raw,x=>x.agent.maxTokensStatus='unlimited',x=>x.agent.maxDurationSeconds={secret:raw},
 x=>x.branch.liveTrafficPercent=101,x=>x.phone.assignedAgentMatches=raw,x=>x.checkedAt=raw,
]){const item=structuredClone(fixture);change(item);malformed.push(item);}
for(const payload of malformed){const h=mount(()=>Response.json(payload));await h.flush();h.button().props.onClick();await h.flush();assert.match(text(h.tree),/Settings are unavailable/);assert(!text(h.tree).includes(raw));assert(!text(h.tree).includes('gemini-2.5-flash'));assert.equal(h.button().props.disabled,false);assert.equal(h.timers.size,0);h.unmount();}
const extra=structuredClone(fixture);extra.private=raw;extra.agent.private=raw;
const stripped=mount(()=>Response.json(extra));await stripped.flush();stripped.button().props.onClick();await stripped.flush();assert(text(stripped.tree).includes('gemini-2.5-flash'));assert(!text(stripped.tree).includes(raw));stripped.unmount();
for(const [status,expected] of [[401,'Sign in'],[403,'configured owner'],[503,'Settings are unavailable']]){
 const h=mount(()=>new Response(raw,{status}));await h.flush();h.button().props.onClick();await h.flush();assert(text(h.tree).includes(expected));assert(!text(h.tree).includes(raw));assert.equal(h.button().props.disabled,false);h.unmount();
}
for(const response of [()=>new Response(raw,{headers:{'content-type':'application/json'}}),()=>{throw Error(raw);}]){const h=mount(response);await h.flush();h.button().props.onClick();await h.flush();assert.match(text(h.tree),/Settings are unavailable/);assert(!text(h.tree).includes(raw));h.unmount();}

const late=deferred(),timed=mount(n=>n===1?late.promise:Response.json(fixture));await timed.flush();timed.button().props.onClick();await timed.flush();timed.expire();await timed.flush();
assert.equal(timed.calls[0].options.signal.aborted,true);assert.equal(timed.button().props.disabled,false);assert.match(text(timed.tree),/timed out/);
timed.button().props.onClick();await timed.flush();assert.equal(timed.calls.length,2);assert.match(text(timed.tree),/gemini-2.5-flash/);
late.resolve(new Response(raw,{status:401}));await timed.flush();assert.match(text(timed.tree),/gemini-2.5-flash/);assert(!text(timed.tree).includes('Sign in'));assert.equal(timed.timers.size,0);timed.unmount();

for(const duringBody of [false,true]){
 const body=deferred(),response=deferred();const h=mount(()=>duringBody?{ok:true,json:()=>body.promise}:response.promise);await h.flush();h.button().props.onClick();await h.flush();
 h.unmount();assert.equal(h.calls[0].options.signal.aborted,true);assert.equal(h.timers.size,0);
 if(duringBody)body.resolve(fixture);else response.resolve(Response.json(fixture));await h.flush();assert.equal(h.writesAfterUnmount,0,'late response cannot update an unmounted component');
}
const lateBody=deferred(),bodyTimeout=mount(()=>({ok:true,json:()=>lateBody.promise}));await bodyTimeout.flush();bodyTimeout.button().props.onClick();await bodyTimeout.flush();bodyTimeout.expire();await bodyTimeout.flush();lateBody.resolve(fixture);await bodyTimeout.flush();assert.match(text(bodyTimeout.tree),/timed out/);assert(!text(bodyTimeout.tree).includes('gemini-2.5-flash'));bodyTimeout.unmount();
console.log('Owner ElevenLabs UI: safe validated rendering, preserved URL/header metadata, duplicate guard, 65-second timeout, retry recovery and ignored late/unmounted responses');
