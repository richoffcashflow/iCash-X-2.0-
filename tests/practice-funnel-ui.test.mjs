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
function harness(search=''){
 let slots=[],cursor=0,dirty=true,pending=[],tree,calls=[],respond=()=>{throw Error('Unexpected request');};
 globalThis.window={location:{search},matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}})};
 globalThis.document={hidden:false};globalThis.requestAnimationFrame=fn=>fn();
 globalThis.localStorage={getItem:()=>null,setItem(){}};
 globalThis.fetch=async(url,options={})=>{calls.push({url,options});if(url==='/api/setup/event')return Response.json({ok:true});if(url==='/api/setup/voices')return Response.json(catalog);return respond(url,options);};
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(fn,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((value,index)=>!Object.is(value,previous.deps[index]))){slots[i]={deps,cleanup:previous?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
 const stubs={BotBuilding:'BotBuilding',BotBrand:'BotBrand',FundingCheckout:'FundingCheckout',DemoRunner:'DemoRunner'};
 const mod={exports:{}};
 new Function('require','module','exports',code)(name=>name==='react'?hooks:name==='@/lib/bot-setup'?setupPolicy:name==='@/lib/practice-funnel'?practicePolicy:name==='@/lib/bot-build'?{saveBotBuild,waitForBotCreationTransition}:name==='lucide-react'?{ArrowRight:'ArrowRight',Check:'Check',LoaderCircle:'LoaderCircle'}:name.startsWith('./')?stubs:require(name),mod,mod.exports);
 const props={onBrand(){},onSignedIn(){}};
 return{calls,respond(fn){respond=fn;},render(){cursor=0;dirty=false;tree=mod.exports.BotSetupFlow(props);return tree;},effects(){const tasks=pending;pending=[];tasks.forEach(fn=>fn());},async flush(){for(let n=0;n<12;n++){if(dirty)this.render();this.effects();await new Promise(resolve=>setTimeout(resolve,2));if(!dirty&&!pending.length)return tree;}throw Error('Render did not settle');},unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
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
assert.ok(find(tree,n=>n.type==='FundingCheckout'),'successful creation opens funding directly');assert.equal(elements(tree).some(n=>n.type==='DemoRunner'),false);assert.match(text(tree),/Your bot is created/);assert.equal(h.calls.some(call=>call.url==='/api/funding/status'||call.url==='/api/billing/daily'||call.url==='/api/setup/voices'),false,'entry and creation never select budget or start billing');h.unmount();
// A payment return outranks name changes before the initial setup response.
const returned=harness('?payment=funded&session_id=cs_test_fixture');let finishInit;returned.respond(()=>new Promise(resolve=>{finishInit=resolve;}));tree=returned.render();find(tree,n=>n.type==='input').props.onChange({target:{value:'Typed during loading'}});returned.effects();tree=await returned.flush();assert.ok(find(tree,n=>n.type==='FundingCheckout'));finishInit(Response.json({setup:initial}));tree=await returned.flush();assert.ok(find(tree,n=>n.type==='FundingCheckout'));assert.equal(elements(tree).some(n=>n.type==='DemoRunner'),false);returned.unmount();
console.log('Setup-to-funding handlers passed: loading/typing race, name-only input, preserved market/voice, duplicate submit, failed-save retry, direct funding, no upfront budget/billing and payment-return precedence.');
