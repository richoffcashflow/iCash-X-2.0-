import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
let slots=[],cursor=0,dirty=true,pending=[],tree,requested=0;
const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(fn,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((value,index)=>!Object.is(value,previous.deps[index]))){slots[i]={deps,cleanup:previous?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
const events=[];let trackingFails=false;
const mod={exports:{}};
const code=ts.transpileModule(readFileSync(new URL('../components/workspace-conversion.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','module','exports',code)(name=>name==='react'?hooks:name.endsWith('.css')?{}:name==='@/lib/usage-loop-client'?{trackUsageLoopEvent:async event=>{if(trackingFails)throw Error('Fixture telemetry unavailable');events.push(event);}}:require(name),mod,mod.exports);
const realNow=Date.now;let clock=realNow();Date.now=()=>clock;
const checkedAt=()=>new Date(clock).toISOString();
let response={balanceCents:0,paused:true,checkedAt:checkedAt(),variant:'progress',impressionId:'00000000-0000-4000-8000-000000000001',card:{key:'funding:research',reason:'refill',action:'funding',title:'Your property research is queued.',detail:'Add $25 for eligible research.',progress:'3 properties researched',button:'Review $25 refill',amountCents:2500}};
let otherDialogOpen=false,checkOccupied=()=>{};
globalThis.MutationObserver=class{constructor(fn){checkOccupied=fn;}observe(){}disconnect(){}};
const observers=[];
globalThis.IntersectionObserver=class{constructor(callback){this.callback=callback;this.connected=false;observers.push(this);}observe(){this.connected=true;}disconnect(){this.connected=false;}};
const observe=(ratio=1)=>observers.filter(item=>item.connected).forEach(item=>item.callback([{isIntersecting:ratio>0,intersectionRatio:ratio}]));
const storage=new Map();globalThis.sessionStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
const listeners=new Map();globalThis.document={body:{},hidden:false,activeElement:null,querySelector:()=>otherDialogOpen?{}:null,addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);}};
globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/work/next-action');assert.equal(options.cache,'no-store');assert(options.signal instanceof AbortSignal,'recommendations use bounded abortable requests');requested++;return Response.json(response);};
const actions=[];let props={principal:'owner',balanceCents:0,paused:true,stale:false,hidden:false,busy:false,attentionPending:false,onFunding:(...args)=>actions.push(['funding',...args]),onResume:()=>actions.push(['resume']),onVip:()=>actions.push(['vip']),onWork:reason=>actions.push(['work',reason])};
function elements(root){return !root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(elements):[root,...elements(root.props?.children)];}
function text(root){return typeof root==='string'?root:Array.isArray(root)?root.map(text).join(' '):root&&typeof root==='object'?text(root.props?.children):'';}
function button(label){const b=elements(tree).find(n=>n.type==='button'&&(text(n).trim()===label||n.props['aria-label']===label));assert(b,`Missing button ${label}`);return b;}
function render(){cursor=0;dirty=false;tree=mod.exports.WorkspaceConversion(props);if(tree?.props.ref)tree.props.ref.current={};}
async function flush(){for(let i=0;i<15;i++){if(dirty)render();const tasks=pending;pending=[];tasks.forEach(fn=>fn());await new Promise(resolve=>setTimeout(resolve,2));if(!dirty&&!pending.length)return;}throw Error('did not settle');}
async function refresh(){for(const fn of listeners.get('visibilitychange')??[])fn();await flush();}
function cleanup(){slots.forEach(slot=>slot?.cleanup?.());}
try{
 await flush();assert.equal(tree.type,'section');assert.match(text(tree),/3 properties researched/);assert.equal(actions.length,0,'Reading never starts work or payment');
 assert.equal(events.length,0,'Mounted below the viewport is not an impression');observe(0.25);assert.equal(events.length,0);observe();observe();assert.equal(events.filter(e=>e.event==='shown').length,1,'Only actual visible exposure is counted once');
 button('Dismiss suggestion').props.onClick();await flush();assert.equal(tree,null);assert.equal(events.at(-1).event,'dismissed');
 cleanup();slots=[];cursor=0;pending=[];dirty=true;await flush();assert.equal(tree,null,'Dismissal survives same-session remounts');
 response={...response,balanceCents:193,card:{...response.card,key:'funding:low:research'}};props={...props,balanceCents:193};otherDialogOpen=true;checkOccupied();dirty=true;await flush();assert.equal(tree,null,'An open dialog suppresses the card');
 otherDialogOpen=false;checkOccupied();response={...response,paused:false};props={...props,paused:false};dirty=true;await flush();assert.equal(tree.type,'section');
 button('Review $25 refill').props.onClick();await flush();assert.deepEqual(actions,[['funding',2500,'Add $25 for eligible research.']]);assert.equal(tree,null);assert.equal(events.at(-1).event,'clicked','Opening funding is a click, not a user dismissal');
 props={...props,balanceCents:2500};dirty=true;await flush();assert.equal(tree,null,'Outdated zero-balance payload cannot ask a funded user to refill');
 response={...response,balanceCents:0,card:{...response.card,key:'funding:start',reason:'start'}};props={...props,balanceCents:0,busy:true};dirty=true;await flush();assert.equal(tree,null);
 props={...props,busy:false,attentionPending:true};dirty=true;await flush();assert.equal(tree,null,'Needs-you work suppresses credit upsells');
 props={...props,attentionPending:false};dirty=true;await flush();assert.equal(tree.type,'section');
 props={...props,stale:true};dirty=true;await flush();assert.equal(tree,null);props={...props,stale:false,hidden:true};dirty=true;await flush();assert.equal(tree,null,'Checkout and setup suppress competing suggestions');
 response={...response,balanceCents:2500,paused:true,card:{key:'resume',reason:'resume',action:'resume',title:'Your bot is paused',detail:'Continue your saved work.',progress:null,button:'Run my bot'}};props={...props,balanceCents:2500,paused:true,hidden:false};dirty=true;await flush();assert.equal(tree.type,'section');button('Run my bot').props.onClick();assert.deepEqual(actions.at(-1),['resume']);
 response={...response,card:{key:'vip',reason:'vip',action:'vip',title:'Meet more matched buyers',detail:'Review the buyer network included with VIP.',progress:'1 signed contract',button:'Explore VIP'}};await refresh();props={...props,attentionPending:true};dirty=true;await flush();assert.equal(tree,null,'VIP waits until attention work is cleared');props={...props,attentionPending:false};dirty=true;await flush();button('Explore VIP').props.onClick();await flush();assert.deepEqual(actions.at(-1),['vip']);
 response={...response,impressionId:null,card:{key:'funding:start',reason:'review',action:'work',title:'A seller needs your answer',detail:'Open the saved request.',progress:'1 conversation completed',button:'Review next step'}};props={...props,attentionPending:true};dirty=true;await refresh();assert.equal(tree.type,'section','Progress and review do not inherit a commercial dismissal');const eventCount=events.length;observe();assert.equal(events.length,eventCount,'Admin/test null tracking never emits analytics');
 trackingFails=true;response={...response,impressionId:'00000000-0000-4000-8000-000000000002'};await refresh();button('Review next step').props.onClick();assert.deepEqual(actions.at(-1),['work','review'],'Telemetry failure cannot block the requested action');button('Dismiss suggestion').props.onClick();await flush();assert.equal(tree,null);
 response={...response,card:{...response.card,progress:'2 conversations completed'}};await refresh();assert.equal(tree.type,'section','New progress is visible despite a prior progress dismissal');button('Dismiss suggestion').props.onClick();await flush();assert.equal(tree,null);
 clock+=16*60000;response={...response,checkedAt:checkedAt()};await refresh();assert.equal(tree.type,'section','Progress dismissal expires instead of hiding work permanently');
 response={...response,checkedAt:new Date(clock-91000).toISOString()};await refresh();assert.equal(tree,null,'Expired server evidence is not displayed');
 response={...response,checkedAt:new Date(clock+60000).toISOString()};await refresh();assert.equal(tree,null,'A future timestamp cannot keep a card fresh');
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');assert(page.indexOf('<WorkspaceConversion')>page.indexOf('<BotRunBar'));assert(page.indexOf('<WorkspaceConversion')<page.indexOf('<BudgetSummary'),'one next-step card appears above Bot activity');
 assert.match(page,/<WorkspaceConversion[^>]*attentionPending=\{attentionPending\}/);assert.doesNotMatch(page.match(/<WorkspaceConversion[^\n]+/)[0],/hidden=\{[^}]*canSwitchPlan/,'Admin account can see actual next-step cards');assert.match(page,/onWork=\{openNextWork\}/);
 console.log('PASS usage-loop UI: visible-only deduplicated impressions, session dismissals, progress refresh, exact funding/resume/VIP/work callbacks, attention priority, admin visibility, stale/busy/occupied holds, bounded fetches and no unsolicited actions.');
}finally{cleanup();Date.now=realNow;}
