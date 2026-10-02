import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url),raw='PRIVATE_RAW_RESPONSE_MUST_NOT_RENDER';
const code=ts.transpileModule(readFileSync('app/owner-inbound-acceptance/owner-elevenlabs-authorization.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const fixture={status:'ready',reason:'ready',operation:'reuse_saved_authorization_reference_on_main',fingerprint:'a'.repeat(64),reviewToken:'r'.repeat(96),expiresAt:'2099-10-02T03:00:00.000Z',callVerification:'not_tested',concurrencyProtection:'fresh_snapshot_check_only',checkedAt:'2026-10-02T03:24:00.000Z',message:raw};
const verified={...fixture,status:'verified_only_auth_changed',reason:'verified_only_auth_changed',reviewToken:null,expiresAt:null};
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
 const fetcher=async(url,options)=>{calls.push({url,options});assert.equal(url,'/api/owner-inbound-acceptance/elevenlabs/authorization');assert(['GET','POST'].includes(options.method));assert.equal(options.cache,'no-store');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');if(options.method==='GET')assert.equal(options.body,undefined);else assert.deepEqual(JSON.parse(options.body),{reviewToken:fixture.reviewToken});return transport(calls.length,options);};
 const mod={exports:{}};
 new Function('require','module','exports','fetch','setTimeout','clearTimeout',code)(name=>name==='react'?hooks:require(name),mod,mod.exports,fetcher,(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},id=>timers.delete(id));
 function render(){cursor=0;dirty=false;tree=mod.exports.default();}
 async function flush(){for(let i=0;i<20;i++){if(dirty&&mounted)render();const tasks=pending;pending=[];tasks.forEach(fn=>fn());await Promise.resolve();}return tree;}
 render();
 return {calls,timers,flush,get tree(){return tree;},get writesAfterUnmount(){return writesAfterUnmount;},
  button(label){const button=nodes(tree).find(node=>node.type==='button'&&(!label||text(node).includes(label)));assert(button);return button;},
  expire(){assert.equal(timers.size,1);const [id,timer]=[...timers][0];assert.equal(timer.delay,125000);timers.delete(id);timer.callback();},
  unmount(){mounted=false;slots.forEach(slot=>slot?.cleanup?.());},
 };
}

function approve(h){const input=nodes(h.tree).find(node=>node.type==='input');assert(input);input.props.onChange({target:{checked:true}});}
const h=mount(n=>Response.json(n===1?fixture:verified));await h.flush();assert.equal(h.calls.length,0);h.button().props.onClick();await h.flush();assert.equal(h.calls[0].options.method,'GET');assert(!text(h.tree).includes(raw));assert.equal(h.button('Apply').props.disabled,true);h.button('Apply').props.onClick();await h.flush();assert.equal(h.calls.length,1);approve(h);await h.flush();assert.equal(h.button('Apply').props.disabled,false);const apply=h.button('Apply').props.onClick;apply();apply();await h.flush();assert.equal(h.calls.length,2);assert.equal(h.calls[1].options.method,'POST');assert.match(text(h.tree),/Verified: Main now uses/);assert(!nodes(h.tree).some(n=>n.type==='button'&&text(n).includes('Apply')));h.unmount();
const p=deferred(),dup=mount(()=>p.promise);await dup.flush();const check=dup.button().props.onClick;check();check();await dup.flush();assert.equal(dup.calls.length,1);assert.equal(dup.button().props.disabled,true);p.resolve(Response.json(fixture));await dup.flush();dup.unmount();
for(const payload of [null,{},raw,{...fixture,reviewToken:'<invalid>'},{...fixture,fingerprint:'abc'},{...fixture,expiresAt:raw},{...fixture,status:'verified_only_auth_changed'},{...verified,reason:'ready'}]){
 const bad=mount(()=>Response.json(payload));await bad.flush();bad.button().props.onClick();await bad.flush();assert(!text(bad.tree).includes(raw));assert(!nodes(bad.tree).some(n=>n.type==='input'));assert.match(text(bad.tree),/unavailable/);bad.unmount();
}
for(const [status,expected] of [[401,'Sign in'],[403,'configured owner'],[503,'unavailable']]){const bad=mount(()=>Response.json({status:'error',message:raw},{status}));await bad.flush();bad.button().props.onClick();await bad.flush();assert(text(bad.tree).includes(expected));assert(!text(bad.tree).includes(raw));bad.unmount();}
const forged=mount(()=>Response.json(fixture,{status:503}));await forged.flush();forged.button().props.onClick();await forged.flush();assert(!nodes(forged.tree).some(n=>n.type==='input'));forged.unmount();
const blocked=mount(()=>Response.json({...fixture,status:'blocked',reason:'drafts_present',reviewToken:null,expiresAt:null},{status:409}));await blocked.flush();blocked.button().props.onClick();await blocked.flush();assert.match(text(blocked.tree),/conflicting unpublished draft/);assert(!nodes(blocked.tree).some(n=>n.type==='input'));blocked.unmount();
const expired=mount(()=>Response.json({...fixture,expiresAt:'2020-01-01T00:00:00.000Z'}));await expired.flush();expired.button().props.onClick();await expired.flush();approve(expired);await expired.flush();expired.button('Apply').props.onClick();await expired.flush();assert.equal(expired.calls.length,1);assert.match(text(expired.tree),/review expired/);expired.unmount();
const late=deferred(),unknown=mount(n=>n===1?Response.json(fixture):n===2?late.promise:Response.json(fixture));await unknown.flush();unknown.button().props.onClick();await unknown.flush();approve(unknown);await unknown.flush();unknown.button('Apply').props.onClick();await unknown.flush();unknown.expire();await unknown.flush();assert.match(text(unknown.tree),/result is unknown/);assert.equal(unknown.calls[1].options.signal.aborted,true);assert(!nodes(unknown.tree).some(n=>n.type==='input'));unknown.button().props.onClick();await unknown.flush();assert.equal(unknown.calls[2].options.method,'GET');assert(!nodes(unknown.tree).some(n=>n.type==='input'));late.resolve(Response.json(verified));await unknown.flush();assert(!text(unknown.tree).includes('Verified: Main now uses'));unknown.unmount();
const fails=mount(n=>n===1?Response.json(fixture):Promise.reject(Error(raw)));await fails.flush();fails.button().props.onClick();await fails.flush();approve(fails);await fails.flush();fails.button('Apply').props.onClick();await fails.flush();assert.match(text(fails.tree),/Do not apply again/);assert(!nodes(fails.tree).some(n=>n.type==='input'));assert(!text(fails.tree).includes(raw));fails.unmount();
const body=deferred(),unmounted=mount(()=>({ok:true,json:()=>body.promise}));await unmounted.flush();unmounted.button().props.onClick();await unmounted.flush();unmounted.unmount();body.resolve(fixture);await unmounted.flush();assert.equal(unmounted.writesAfterUnmount,0);assert.equal(unmounted.timers.size,0);
console.log('Authorization repair UI: explicit preparation/consent, fixed payload, response allowlist, expiry, duplicate protection, unknown-result no retry, read-only follow-up, unmount cleanup');
