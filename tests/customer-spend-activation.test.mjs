import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
let writes=0,origin=true,auth=true;
const route=await loadService('app/api/work/activation/route.ts',{z,NextResponse:{json:(body,o={})=>({body,status:o.status??200})},allowedOrigin:()=>origin,workAccount:async()=>{if(!auth)throw Error();return {accountId:'server-account',userId:'server-user'};},db:async(path,method,body)=>{assert.equal(method,'POST');assert.equal(body.p_account,'server-account');assert.equal(body.p_user,'server-user');if(path.endsWith('review'))return {available:false};assert.equal(path,'rpc/icash_confirm_spend_activation');assert.equal(body.p_accepted,true);writes++;return {saved:true,started:false};}});
const valid={accepted:true,version:'activation-2026-10-03.1',reviewKey:'a'.repeat(32)};
const req=value=>new Request('https://example.invalid/api/work/activation',{method:'POST',body:JSON.stringify(value)});
assert.equal((await route.GET()).status,200);assert.equal(writes,0);
for(const invalid of [{...valid,accepted:false},{...valid,accountId:'attacker'},{...valid,cap:100000},{...valid,version:'old'},{...valid,reviewKey:'bad'}])assert.equal((await route.POST(req(invalid))).status,409);
assert.equal(writes,0);origin=false;assert.equal((await route.POST(req(valid))).status,403);origin=true;auth=false;assert.equal((await route.POST(req(valid))).status,409);auth=true;
assert.equal((await route.POST(req(valid))).status,200);assert.equal(writes,1);
const ui=readFileSync(new URL('../components/spend-activation-review.tsx',import.meta.url),'utf8');assert.match(ui,/I authorize this paid-credit spending limit/);assert.match(ui,/does not start your bot/);assert.match(ui,/disabled=\{!accepted\|\|busy\|\|loading\}/);assert.doesNotMatch(ui,/\/api\/work\/control|action:'resume'/);assert.match(ui,/setLoading\(true\);setAccepted\(false\);setReview\(null\)/);assert.match(ui,/request!==sequence.current/);assert.match(ui,/setAccepted\(false\);setReview\(q\)/);
console.log('PASS explicit activation route: authenticated server account only, no client caps, strict consent/version/key, no GET mutation, origin guard, no Start side effect.');

// Execute the real component's handlers with isolated hooks and network-free responses.
const {createRequire}=await import('node:module');
const require=createRequire(import.meta.url),ts=require('typescript');
const {workspaceStatus,workspaceNextAction}=await import('../lib/workspace-status.ts');
function nodes(n){return !n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];}
function words(n){return typeof n==='string'?n:Array.isArray(n)?n.map(words).join(' '):n&&typeof n==='object'?words(n.props?.children):'';}
function element(tree,predicate){const found=nodes(tree).find(predicate);assert(found,'expected element');return found;}
function activationHarness(){
 let slots=[],cursor=0,dirty=true,pending=[],tree,saves=0,calls=[],availability=[],respond=()=>{throw Error('Unexpected request');};
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){slots[i]={deps,cleanup:old?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
 const code=ts.transpileModule(ui,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};new Function('require','module','exports',code)(name=>name==='react'?hooks:require(name),mod,mod.exports);
 globalThis.fetch=async(url,options={})=>{assert.equal(url,'/api/work/activation');calls.push({url,method:options.method??'GET',body:options.body});return respond(url,options);};
 const props={onSaved(){saves++;},onAvailabilityChange(value){availability.push(value);}};
 return {calls,availability,get saves(){return saves;},respond(fn){respond=fn;},render(){cursor=0;dirty=false;tree=mod.exports.SpendActivationReview(props);return tree;},effects(){const jobs=pending;pending=[];jobs.forEach(fn=>fn());},async flush(){for(let i=0;i<15;i++){if(dirty)this.render();this.effects();await new Promise(r=>setTimeout(r,1));if(!dirty&&!pending.length)return tree;}throw Error('did not settle');},unmount(){slots.forEach(s=>s?.cleanup?.());}};
}
const quote=(key='a',cap=1000)=>({available:true,reviewKey:key.repeat(32),customerCapCents:cap,dailyLimitCents:300,consentVersion:'activation-2026-10-03.1'});
const newcomer={identity:{principal:'Fixture User'},paused:true,workReady:false,discoveryWorkReady:false,contactWorkReady:false,smsWorkReady:false,activeWork:false,balanceCents:1000,discoveryBlocker:'spending_activation_required'};
assert.equal(workspaceNextAction(newcomer,null).kind,'support');
assert.equal(workspaceNextAction({...newcomer,spendingActivationAvailable:true},null).kind,'activation');
assert.doesNotMatch(workspaceStatus({...newcomer,spendingActivationAvailable:true}).detail,/Contact support/);
assert.equal(workspaceNextAction({...newcomer,spendingActivationAvailable:false},null).kind,'support');
assert.equal(workspaceNextAction({...newcomer,spendingActivationAvailable:true,billingReview:true},null).kind,'support');
assert.equal(workspaceNextAction({...newcomer,spendingActivationAvailable:true,identity:null},null).kind,'identity');
assert.equal(workspaceNextAction({...newcomer,spendingActivationAvailable:true,activeWork:true,paused:false},null).kind,'pause');
assert.equal(workspaceNextAction({...newcomer,spendingActivationAvailable:true,discoveryBlocker:'discovery_configuration_required'},null).kind,'support');
// A transient initial read failure is visible and can recover without paying or reloading.
let h=activationHarness();h.respond(()=>Response.json({error:'transient'},{status:503}));let tree=await h.flush();
assert.match(words(tree),/Could not load your spending review/);assert.equal(nodes(tree).some(n=>n.type==='input'),false);assert.equal(h.availability.at(-1),false);
h.respond(()=>Response.json(quote()));element(tree,n=>n.type==='button'&&words(n)==='Refresh activation review').props.onClick();tree=await h.flush();assert.equal(h.availability.at(-1),true);assert.equal(element(tree,n=>n.type==='input').props.checked,false);assert.equal(element(tree,n=>n.type==='button'&&words(n)==='Save spending activation').props.disabled,true);
element(tree,n=>n.type==='input').props.onChange({target:{checked:true}});tree=await h.flush();assert.equal(element(tree,n=>n.type==='button'&&words(n)==='Save spending activation').props.disabled,false);
let settle;h.respond(()=>new Promise(r=>settle=r));element(tree,n=>n.type==='button'&&words(n)==='Refresh activation review').props.onClick();tree=await h.flush();assert.equal(h.availability.at(-1),false);assert.equal(nodes(tree).some(n=>n.type==='input'),false);
settle(Response.json(quote('b',2000)));tree=await h.flush();assert.equal(element(tree,n=>n.type==='input').props.checked,false);assert.match(words(tree),/\$20\.00/);assert.equal(h.availability.at(-1),true);
element(tree,n=>n.type==='input').props.onChange({target:{checked:true}});tree=await h.flush();h.respond(()=>Response.json({error:'stale'},{status:409}));element(tree,n=>n.type==='button'&&words(n)==='Save spending activation').props.onClick();tree=await h.flush();assert.equal(h.availability.at(-1),false);assert.equal(nodes(tree).some(n=>n.type==='input'),false);assert.match(words(tree),/Refresh this review before retrying/);
h.respond(()=>Response.json(quote('c',2000)));element(tree,n=>n.type==='button'&&words(n)==='Refresh activation review').props.onClick();tree=await h.flush();assert.equal(element(tree,n=>n.type==='input').props.checked,false);element(tree,n=>n.type==='input').props.onChange({target:{checked:true}});tree=await h.flush();h.respond(()=>Response.json({saved:true,started:false}));element(tree,n=>n.type==='button'&&words(n)==='Save spending activation').props.onClick();tree=await h.flush();assert.equal(h.saves,1);assert.equal(h.availability.at(-1),false);assert.match(words(tree),/Start remains a separate action/);assert(h.calls.every(c=>c.url==='/api/work/activation'));h.unmount();
// An existing/disabled activation must never produce an actionable self-service hint.
h=activationHarness();h.respond(()=>Response.json({available:false,reason:'existing_activation_preserved'}));tree=await h.flush();assert.equal(tree,null);assert.equal(h.availability.at(-1),false);h.unmount();
// Unmounted/stale reads cannot restore old availability.
h=activationHarness();h.respond(()=>new Promise(r=>settle=r));await h.flush();h.unmount();settle(Response.json(quote()));await h.flush();assert.equal(h.availability.at(-1),false);assert.equal(h.availability.includes(true),false);
const home=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');assert.match(home,/activationAvailability\?\.key===activationKey/);assert.match(home,/onAvailabilityChange=\{updateActivationAvailability\}/);assert.match(home,/nextAction.kind==='activation'/);assert.match(home,/review\?\.focus\(\)/);
console.log('PASS combined activation UI: visible retry, verified current availability, support fallback, higher-priority holds, fresh consent, stale response rejection and separate Start.');
