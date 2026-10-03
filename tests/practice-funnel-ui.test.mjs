import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as setupPolicy from '../lib/bot-setup.ts';
import * as practicePolicy from '../lib/practice-funnel.ts';
import {saveBotBuild,waitForBotCreationTransition} from '../lib/bot-build.ts';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../components/bot-setup.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const catalog={voices:[{key:'sarah',name:'Sarah',description:'Warm',previewUrl:'https://example.invalid/sarah',voiceId:'sarah-fixture'},{key:'chris',name:'Chris',description:'Direct',previewUrl:'https://example.invalid/chris',voiceId:'chris-fixture'}]};
function elements(root){return !root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(elements):[root,...elements(root.props?.children)];}
function text(root){return typeof root==='string'?root:Array.isArray(root)?root.map(text).join(' '):root&&typeof root==='object'?text(root.props?.children):'';}
function find(root,p){const item=elements(root).find(p);assert.ok(item,'expected rendered element');return item;}
function harness(search='',hash=''){
 let slots=[],cursor=0,dirty=true,pending=[],tree,calls=[],respond=()=>{throw Error('Unexpected request');};
 const listeners={},history=[hash];let historyIndex=0;globalThis.window={location:{search,hash},history:{state:{router:'preserved'},pushState(state,_title,url){assert.equal(state.router,'preserved');history.splice(++historyIndex,history.length,url);window.location.hash=url;},replaceState(state,_title,url){assert.equal(state.router,'preserved');history[historyIndex]=url;window.location.hash=url;}},addEventListener(name,fn){listeners[name]=fn;},removeEventListener(name){delete listeners[name];},matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}})};
 globalThis.document={hidden:false};globalThis.requestAnimationFrame=fn=>fn();
 globalThis.localStorage={getItem:()=>null,setItem(){}};
 globalThis.fetch=async(url,options={})=>{calls.push({url,options});if(url==='/api/setup/event')return Response.json({ok:true});if(url==='/api/setup/voices')return Response.json(catalog);return respond(url,options);};
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(fn,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((value,index)=>!Object.is(value,previous.deps[index]))){slots[i]={deps,cleanup:previous?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
 const stubs={BotBuilding:'BotBuilding',BotBrand:'BotBrand',MembershipCheckout:'MembershipCheckout',FundingCheckout:'FundingCheckout',FreeSampleWorkspace:'FreeSampleWorkspace',DemoRunner:'DemoRunner'};
 const mod={exports:{}};
 new Function('require','module','exports',code)(name=>name==='react'?hooks:name==='@/lib/bot-setup'?setupPolicy:name==='@/lib/practice-funnel'?practicePolicy:name==='@/lib/bot-build'?{saveBotBuild,waitForBotCreationTransition}:name==='lucide-react'?{ArrowRight:'ArrowRight',Check:'Check',LoaderCircle:'LoaderCircle'}:name.startsWith('./')?stubs:require(name),mod,mod.exports);
 const props={onBrand(){},onSignedIn(){}};
 return{calls,get history(){return history;},navigate(hash){window.location.hash=hash;listeners.hashchange?.();},back(){historyIndex--;window.location.hash=history[historyIndex];listeners.popstate?.();},forward(){historyIndex++;window.location.hash=history[historyIndex];listeners.popstate?.();},respond(fn){respond=fn;},render(){cursor=0;dirty=false;tree=mod.exports.BotSetupFlow(props);return tree;},effects(){const tasks=pending;pending=[];tasks.forEach(fn=>fn());},async flush(){for(let n=0;n<12;n++){if(dirty)this.render();this.effects();await new Promise(resolve=>setTimeout(resolve,2));if(!dirty&&!pending.length)return tree;}throw Error('Render did not settle');},unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}
const initial={id:'fixture-setup',stage:0,revision:1,profile:{...setupPolicy.defaultBotProfile,displayName:'Saved name',market:'Austin, TX',marketMode:'city'}};
const h=harness();let resolveInit;
h.respond((url,options)=>new Promise(resolve=>{resolveInit=resolve;}));
let tree=h.render();h.effects();find(tree,n=>n.type==='input'&&n.props.id==='bot-name').props.onChange({target:{value:'Scout'}});await h.flush();
tree=h.render();assert.equal(find(tree,n=>n.type==='button'&&text(n).includes('Create my bot')).props.disabled,true,'init must finish before submission');
resolveInit(Response.json({setup:initial}));tree=await h.flush();
assert.equal(find(tree,n=>n.type==='input'&&n.props.id==='bot-name').props.value,'Scout','late initial response preserves typing');
assert.equal(elements(tree).some(n=>n.props?.id==='practice-budget'),false,'no upfront budget');
assert.equal(elements(tree).filter(n=>n.type==='input').length,1,'only name is requested');assert.equal(elements(tree).some(n=>n.type==='select'),false);
let failed=true,posts=0;
h.respond(async(url,options)=>{if(options.method!=='POST')return Response.json({setup:initial});posts++;if(failed)return Response.json({error:'Synthetic save failure'},{status:503});const body=JSON.parse(options.body);assert.equal(body.profile.market,'Austin, TX');assert.equal(body.profile.voice,'sarah');assert.equal(body.profile.marketMode,'city');assert.equal(body.profile.displayName,'Scout');return Response.json({setup:{...initial,profile:body.profile,stage:4,revision:2}});});
const form=find(tree,n=>n.type==='form');form.props.onSubmit({preventDefault(){}});form.props.onSubmit({preventDefault(){}});tree=await h.flush();assert.equal(posts,1,'double submit creates one request');
let building=find(tree,n=>n.type==='BotBuilding');assert.equal(building.props.phase,'error');assert.equal(elements(tree).some(n=>n.type==='DemoRunner'),false,'failed setup must not start demo');
failed=false;building.props.onRetry();tree=await h.flush();
assert.ok(find(tree,n=>n.type==='MembershipCheckout'),'successful creation opens funding directly');assert.equal(elements(tree).some(n=>n.type==='FreeSampleWorkspace'),false);assert.equal(window.location.hash,'#funding');h.back();tree=await h.flush();assert.ok(find(tree,n=>n.type==='input'&&n.props.id==='bot-name'),'browser Back returns to name entry');h.forward();tree=await h.flush();assert.ok(find(tree,n=>n.type==='MembershipCheckout'),'browser Forward returns to funding');find(tree,n=>n.type==='button'&&text(n)==='Edit bot name').props.onClick();tree=await h.flush();assert.equal(find(tree,n=>n.type==='input').props.value,'Scout');assert.equal(window.location.hash,'#setup');h.back();tree=await h.flush();assert.ok(find(tree,n=>n.type==='MembershipCheckout'),'Back after explicit edit restores funding');assert.equal(elements(tree).some(n=>n.type==='DemoRunner'),false);assert.match(text(tree),/Get your software access/);assert.equal(h.calls.some(call=>call.url==='/api/funding/status'||call.url==='/api/billing/daily'||call.url==='/api/setup/voices'),false,'setup component never selects budget or starts billing');h.unmount();
// A payment return outranks name changes before the initial setup response.
const returned=harness('?payment=funded&session_id=cs_test_fixture');let finishInit;returned.respond(()=>new Promise(resolve=>{finishInit=resolve;}));tree=returned.render();find(tree,n=>n.type==='input').props.onChange({target:{value:'Typed during loading'}});returned.effects();tree=await returned.flush();assert.ok(find(tree,n=>n.type==='FundingCheckout'));finishInit(Response.json({setup:initial}));tree=await returned.flush();assert.ok(find(tree,n=>n.type==='FundingCheckout'));assert.equal(elements(tree).some(n=>n.type==='DemoRunner'),false);returned.unmount();
for(const hash of ['', '#example','#funding']){
 const savedGuest=harness('?utm_source=preserved',hash);savedGuest.respond(()=>Response.json({setup:{...initial,stage:1}}));tree=await savedGuest.flush();assert.equal(window.location.hash,'#funding','restored and legacy sessions normalize to funding');assert.ok(find(tree,n=>n.type==='MembershipCheckout'));assert.equal(savedGuest.history.length,1,'resume uses replace, not another history entry');assert.equal(window.location.search,'?utm_source=preserved');savedGuest.unmount();
}
const editGuest=harness('','#setup');editGuest.respond(()=>Response.json({setup:{...initial,stage:4}}));tree=await editGuest.flush();assert.ok(find(tree,n=>n.type==='input'));editGuest.unmount();
for(const payment of ['funded','canceled']){
 const paid=harness(`?payment=${payment}&session_id=opaque%2Breturn`,'#example');paid.respond(()=>Response.json({setup:{...initial,stage:4}}));tree=await paid.flush();assert.ok(find(tree,n=>n.type===(payment==='funded'?'FundingCheckout':'MembershipCheckout')));assert.equal(window.location.hash,'#funding');assert.equal(window.location.search,`?payment=${payment}&session_id=opaque%2Breturn`);if(payment==='funded'){paid.navigate('#setup');tree=await paid.flush();assert.ok(find(tree,n=>n.type===(payment==='funded'?'FundingCheckout':'MembershipCheckout')),'payment return outranks history navigation');}paid.unmount();
}
// Newer history selection must win over late initialization and completed saves.
const lateInit=harness();let settleInit;lateInit.respond(()=>new Promise(resolve=>{settleInit=resolve;}));await lateInit.flush();lateInit.navigate('#funding');await lateInit.flush();lateInit.navigate('');await lateInit.flush();settleInit(Response.json({setup:{...initial,stage:4}}));tree=await lateInit.flush();assert.ok(find(tree,n=>n.type==='input'),'late initialization does not override newer history');lateInit.unmount();
for(const unmount of [false,true]){
 const lateSave=harness();lateSave.respond(()=>Response.json({setup:initial}));tree=await lateSave.flush();let settleSave;lateSave.respond(()=>new Promise(resolve=>{settleSave=resolve;}));find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});await lateSave.flush();if(unmount)lateSave.unmount();else{lateSave.navigate('#setup');await lateSave.flush();}settleSave(Response.json({setup:{...initial,stage:4,revision:2}}));tree=await lateSave.flush();assert.equal(window.location.hash,unmount?'':'#setup','late save does not override navigation/unmount');if(!unmount){assert.ok(find(tree,n=>n.type==='input'));lateSave.unmount();}
}
assert.doesNotMatch(source,/FreeSampleWorkspace|navigate\('sample'\)|Back to free example|Try a free deal example/);
console.log('Setup-to-funding handlers passed: direct funding, loading/typing and navigation races, preserved preferences, duplicate/retry/unmount, legacy hashes, edit/back/forward, and payment-return precedence.');
