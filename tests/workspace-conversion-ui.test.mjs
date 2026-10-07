import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
let slots=[],cursor=0,dirty=true,pending=[],tree,requested=0;
const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(fn,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((value,index)=>!Object.is(value,previous.deps[index]))){slots[i]={deps,cleanup:previous?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
const mod={exports:{}};
const code=ts.transpileModule(readFileSync(new URL('../components/workspace-conversion.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','module','exports',code)(name=>name==='react'?hooks:name.endsWith('.css')?{}:require(name),mod,mod.exports);
let response={balanceCents:0,paused:true,checkedAt:new Date().toISOString(),offer:{key:'funding:empty:research',action:'funding',title:'Your property research is queued.',detail:'Add $25 for eligible research.',compact:'Research queued',button:'Add $25 & continue',amountCents:2500}};
globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
globalThis.fetch=async()=>{requested++;return Response.json(response);};
const actions=[];let props={principal:'owner',balanceCents:0,paused:true,stale:false,hidden:false,busy:false,onFunding:(...args)=>actions.push(['funding',...args]),onResume:()=>actions.push(['resume']),onVip:()=>actions.push(['vip'])};
function elements(root){return !root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(elements):[root,...elements(root.props?.children)];}
function text(root){return typeof root==='string'?root:Array.isArray(root)?root.map(text).join(' '):root&&typeof root==='object'?text(root.props?.children):'';}
function button(label){const b=elements(tree).find(n=>n.type==='button'&&(text(n)===label||n.props['aria-label']===label));assert(b);return b;}
function render(){cursor=0;dirty=false;tree=mod.exports.WorkspaceConversion(props);}
async function flush(){for(let i=0;i<15;i++){if(dirty)render();const tasks=pending;pending=[];tasks.forEach(fn=>fn());await new Promise(resolve=>setTimeout(resolve,2));if(!dirty&&!pending.length)return;}throw Error('did not settle');}
await flush();assert.match(text(tree),/property research/);assert.equal(actions.length,0,'Reading never starts work or payment');
button('Minimize suggestion').props.onClick();await flush();assert.match(text(tree),/Research queued/);assert.doesNotMatch(text(tree),/eligible research/);
button('Add $25 & continue').props.onClick();assert.deepEqual(actions,[['funding',2500,'Add $25 for eligible research.']]);
props={...props,balanceCents:2500};dirty=true;await flush();assert.equal(tree,null,'Stale zero-balance response cannot ask a funded user to refill');
props={...props,balanceCents:0,busy:true};dirty=true;await flush();button('Updating…').props.onClick();assert.equal(actions.length,1);
props={...props,stale:true};dirty=true;await flush();assert.equal(tree,null);
props={...props,stale:false,hidden:true};dirty=true;await flush();assert.equal(tree,null,'Checkout suppresses competing suggestions');
slots.forEach(slot=>slot?.cleanup?.());
console.log('PASS conversion UI: read-only mount, exact action/amount, persistent minimized reminder, stale-balance suppression, busy lock and modal suppression.');
