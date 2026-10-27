// Local component behavior only: no payments, provider sends or network access.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as views from '../components/workspace-view.ts';
import * as guidance from '../lib/workspace-guidance.ts';
import {workspaceLeadPresence} from '../lib/workspace-lead-presence.ts';
const require=createRequire(import.meta.url),saved={window:globalThis.window,document:globalThis.document,setTimeout,clearTimeout,setInterval,clearInterval};
const timers=new Map();let timerId=0;
const windowTarget=new EventTarget(),documentTarget=new EventTarget();
let unsavedId=null;
Object.assign(windowTarget,{location:{search:''},confirm(){throw Error('Funding must not navigate or discard unsaved work');}});
Object.assign(documentTarget,{hidden:false,querySelector(){return unsavedId?{}:null;},querySelectorAll(){return unsavedId?[{id:'property-'+unsavedId,matches:()=>false,querySelector:()=>({})}]:[];},getElementById(){return null;}});
globalThis.window=windowTarget;globalThis.document=documentTarget;
globalThis.setTimeout=(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;};globalThis.clearTimeout=id=>timers.delete(id);
globalThis.setInterval=(fn,delay)=>{timers.set(++timerId,{fn,delay,interval:true});return timerId;};globalThis.clearInterval=id=>timers.delete(id);
const elements=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(elements):[n,...elements(n.props?.children)];
const label=n=>typeof n==='string'?n:Array.isArray(n)?n.map(label).join(''):n&&typeof n==='object'?label(n.props?.children):'';
let cells=[],cursor=0,dirty=true,pending=[],tree;
const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
const hooks={useState(initial){const i=cursor++;if(!(i in cells))cells[i]=typeof initial==='function'?initial():initial;return[cells[i],next=>{const n=typeof next==='function'?next(cells[i]):next;if(!Object.is(n,cells[i])){cells[i]=n;dirty=true;}}];},useRef(initial){const i=cursor++;return cells[i]??={current:initial};},useEffect(fn,deps){const i=cursor++,prior=cells[i];if(!same(prior?.deps,deps)){cells[i]={deps,cleanup:prior?.cleanup};pending.push(()=>{cells[i].cleanup?.();cells[i].cleanup=fn();});}},useCallback:fn=>fn};
const requests=[],changes=new Set();
const workspaceRequest=(url,options)=>new Promise((resolve,reject)=>{requests.push({url,options,resolve,reject});});
const code=ts.transpileModule(readFileSync(new URL('../components/live-workspace.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
new Function('require','module','exports',code)(name=>name==='react'?hooks:name==='react/jsx-runtime'?require(name):name==='@/lib/webinar-client'?{webinarRequest:workspaceRequest}:name==='@/lib/workspace-events-client'?{subscribeWorkspaceChanges:fn=>{changes.add(fn);return()=>changes.delete(fn);}}:name==='./workspace-view'?views:name==='@/lib/workspace-guidance'?guidance:name==='@/lib/workspace-lead-presence'?{workspaceLeadPresence}:new Proxy({},{get:(_o,key)=>String(key)}),mod,mod.exports);
function render(){cursor=0;dirty=false;tree=mod.exports.LiveWorkspace({principal:'Synthetic investor',botAvailable:true,showCoach:false});}
async function flush(){for(let i=0;i<12;i++){if(dirty)render();const batch=pending;pending=[];for(const fn of batch)fn();await Promise.resolve();}}
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const property=n=>({id:uuid(n),completed_at:'2026-10-19T18:00:00Z',engagement:{responded:false,interested:false,optedOut:false},result:{property:{propertyId:'prop_'+n,address:n+' Sample Lane'},financialCheck:{status:'eligible',reason:'Saved eligible research'},preliminarySellerCeilingCents:10000000}});
const work=(numbers=[1])=>({responseCounts:{responded:0,total:10},properties:numbers.map(property),deals:[],contacts:[],controls:[],conversations:[],callbacks:[],handoffs:[],signing:[],signatureActions:[],signingConfigured:false,hasMore:true});
const button=name=>{const n=elements(tree).find(n=>n.type==='button'&&label(n)===name);assert(n,'button '+name);return n;};
const card=id=>elements(tree).find(n=>n.type?.name==='PropertyCard'&&n.props.property.id===id);
const query=i=>new URL(requests[i].url,'https://fixture.invalid').searchParams;
const funded=()=>window.dispatchEvent(new Event('icash:credits-funded'));
try{
 await flush();assert.equal(requests.length,1);assert.equal(query(0).get('view'),'opportunities','First hydration requests fresh eligible properties or actual responses before pagination');assert.equal(button('Opportunities').props['aria-pressed'],true);
 funded();funded();assert.equal(requests.length,1,'An in-flight request coalesces funding refreshes');
 requests[0].resolve(work());await flush();assert.equal(requests.length,2,'Funding during a pending read triggers a fresh read afterward');
 requests[1].resolve(work());await flush();assert(card(uuid(1)));assert.equal(card(uuid(1)).props.property.engagement.responded,false,'Displaying a candidate never invents seller response');
 const before=requests.length;funded();await flush();assert.equal(requests.length,before+1,'Unchanged progress counts do not block funded refresh');requests.at(-1).resolve(work([2]));await flush();assert(card(uuid(2)));
 button('Seller responses').props.onClick();await flush();assert.equal(query(requests.length-1).get('view'),'responses');requests.at(-1).resolve(work([2]));await flush();
 button('Next properties').props.onClick();await flush();assert.equal(query(requests.length-1).get('page'),'1');requests.at(-1).resolve(work([2]));await flush();
 card(uuid(2)).props.onToggle(true);await flush();unsavedId=uuid(2);
 const explicit=requests.length;funded();await flush();assert.equal(query(explicit).get('view'),'responses','Funding respects the selected view');assert.equal(query(explicit).get('page'),'1','Funding respects the selected page');
 requests[explicit].resolve(work([3]));await flush();assert.equal(query(explicit+1).get('screeningId'),uuid(2),'An open draft missing from the new page is retained');
 requests[explicit+1].resolve(work([2]));await flush();assert.equal(card(uuid(2)).props.active,true);assert.equal(button('Seller responses').props['aria-pressed'],true);assert(card(uuid(3)));
 unsavedId=null;
 const search=elements(tree).find(n=>n.type==='input'&&n.props.type==='search');search.props.onChange({target:{value:'2 Sample'}});await flush();
 for(const [id,timer] of timers)if(!timer.interval&&timer.delay===300){timers.delete(id);timer.fn();}await flush();
 requests.at(-1).resolve(work([2]));await flush();const searchIndex=requests.length;funded();await flush();assert.equal(query(searchIndex).get('query'),'2 Sample','Funding respects an explicit search');requests[searchIndex].resolve(work([2]));await flush();
 assert.equal(button('Seller responses').props['aria-pressed'],true);
 const beforeChange=requests.length;for(const fn of changes)fn();await flush();assert.equal(requests.length,beforeChange+1,'A revision refreshes the current view');requests.at(-1).resolve(work([2]));await flush();
 cells.forEach(cell=>cell?.cleanup?.());assert.equal(changes.size,0,'Unmount removes the revision subscription');const stopped=requests.length;funded();await flush();assert.equal(requests.length,stopped,'Unmount removes the funding listener');
 console.log('PASS funded workspace: saved candidates visible on hydration, immediate/count-independent refresh, in-flight coalescing, explicit response/search/page choices and open drafts preserved. No provider work.');
}finally{cells.forEach(cell=>cell?.cleanup?.());Object.assign(globalThis,saved);}
