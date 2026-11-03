// Actual component and request lifecycle, with synthetic response headers/bodies only.
// No credentials, providers, payments, calls or messages are used.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {webinarRequest} from '../lib/webinar-client.ts';

const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../components/fulfillment-details.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const elements=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(elements):[node,...elements(node.props?.children)];
const label=node=>typeof node==='string'?node:Array.isArray(node)?node.map(label).join(''):node&&typeof node==='object'?label(node.props?.children):'';
const progress=(reply='Thursday afternoon works for my viewing.')=>({documents:[],buyers:[],buyerNetwork:{buyers:[{id:'synthetic-buyer',name:'Avery Morgan',state:'interested',reply}]}});
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

function harness(){
 const saved={fetch:globalThis.fetch,document:globalThis.document,setTimeout,clearTimeout,setInterval,clearInterval};
 const document=new EventTarget();Object.assign(document,{hidden:false,getElementById:()=>null});
 const timers=new Map(),requests=[],diagnostics=[];let timerId=0,slots=[],cursor=0,dirty=true,pending=[],tree,disposed=false,stateWrites=0,props={dealId:'synthetic-deal'};
 Object.assign(globalThis,{document,setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;},clearTimeout:id=>timers.delete(id),setInterval:(fn,delay)=>{timers.set(++timerId,{fn,delay,interval:true});return timerId;},clearInterval:id=>timers.delete(id)});
 globalThis.fetch=(url,init)=>{
  assert.equal(init.method??'GET','GET','Background refresh never repeats a write');
  assert.match(url,/^\/api\/work\/fulfillment\?dealId=synthetic-/);
  const headers=deferred(),body=deferred();
  const request={url,init,headers(status=200){headers.resolve({ok:status>=200&&status<300,status,json:()=>body.promise});},body:body.resolve,finish(data,status=200){this.headers(status);body.resolve(data);}};
  requests.push(request);return headers.promise;
 };
 const hooks={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],next=>{stateWrites++;const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},
  useRef(initial){const i=cursor++;return slots[i]??={current:initial};},
  useCallback(fn){cursor++;return fn;},
  useEffect(fn,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((value,index)=>!Object.is(value,previous.deps[index]))){const effect={deps,cleanup:previous?.cleanup};slots[i]=effect;pending.push(()=>{effect.cleanup?.();effect.cleanup=fn();});}}
 };
 const deps={react:hooks,'@/lib/webinar-client':{webinarRequest},'@/lib/buyer-outreach-status':{buyerOutreachMessage:()=>''},'@/lib/workspace-navigation':{revealWorkspaceSection(){}},'@/lib/workspace-experience-client':{recordWorkspaceExperience:event=>diagnostics.push(event)}};
 const mod={exports:{}};
 new Function('require','module','exports',code)(name=>name in deps?deps[name]:name==='react/jsx-runtime'?require(name):new Proxy({},{get:(_target,key)=>String(key)}),mod,mod.exports);
 const ui={
  requests,diagnostics,timers,
  async flush(){for(let i=0;i<32;i++){if(dirty&&!disposed){cursor=0;dirty=false;tree=mod.exports.FulfillmentDetails(props);}const effects=pending;pending=[];effects.forEach(fn=>fn());await Promise.resolve();}},
  find(predicate){const node=elements(tree).find(predicate);assert(node,'Expected component or control');return node;},
  text:()=>label(tree),
  quote:()=>ui.find(node=>node.type==='blockquote').props.children,
  select(){ui.find(node=>node.type==='BuyerOverview').props.onBuyer({kind:'response',buyer:ui.find(node=>node.type==='BuyerOverview').props.network.buyers[0]});},
  visible(){document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));},
  hide(){document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));},
  changeDeal(){props={dealId:'synthetic-other-deal'};dirty=true;},
  writes:()=>stateWrites,
  unmount(){if(!disposed){disposed=true;slots.forEach(slot=>slot?.cleanup?.());}},
  dispose(){ui.unmount();Object.assign(globalThis,saved);}
 };
 return ui;
}
let scenarios=0;
async function scenario(name,run){const ui=harness();try{await ui.flush();assert.equal(ui.requests.length,1);ui.requests[0].finish(progress());await ui.flush();ui.select();await ui.flush();await run(ui);console.log('PASS '+(++scenarios)+': '+name);}finally{ui.dispose();}}

await scenario('visible events during a held 503 body coalesce and refresh the open buyer reply',async ui=>{
 const original=ui.quote();ui.visible();await ui.flush();const failed=ui.requests[1];
 failed.headers(503);await ui.flush();
 // Headers are observable before response.json() and the component finally finish.
 for(let i=0;i<5;i++)ui.visible();await ui.flush();assert.equal(ui.requests.length,2,'No concurrent fulfillment reads');
 assert.equal(ui.quote(),original);failed.body({error:'Synthetic unavailable'});await ui.flush();
 assert.equal(ui.requests.length,3,'Exactly one requested refresh survives the failed response body');
 assert.equal(ui.quote(),original,'The last confirmed selected reply survives the background failure');
 assert.equal(ui.diagnostics.filter(event=>event.event==='panel_error').length,1);
 assert.equal(elements(ui.find(node=>node.type==='section')).some(node=>node.props?.role==='alert'),false);
 const friday='Friday afternoon works for my viewing instead.';ui.requests[2].finish(progress(friday));await ui.flush();
 assert.equal(ui.quote(),friday,'The selected buyer is rebound by ID to the new response');
 assert.equal(ui.requests.length,3,'Successful recovery does not create another read');
 assert.equal(ui.find(node=>node.type==='fieldset').props.disabled,false);
 assert.deepEqual([...ui.timers.values()].map(timer=>timer.delay),[30000],'The existing poll interval is unchanged');
});

await scenario('a failure without a queued event preserves data and waits for the existing poll',async ui=>{
 ui.visible();await ui.flush();ui.requests[1].finish({error:'Synthetic unavailable'},503);await ui.flush();
 assert.equal(ui.requests.length,2,'Failure alone never starts an automatic retry loop');assert.equal(ui.quote(),progress().buyerNetwork.buyers[0].reply);
 assert.equal(ui.find(node=>node.type==='fieldset').props.disabled,true,'Unconfirmed controls remain guarded');
 const interval=[...ui.timers.values()].find(timer=>timer.interval);interval.fn();await ui.flush();assert.equal(ui.requests.length,3);
 ui.requests[2].finish(progress());await ui.flush();assert.equal(ui.find(node=>node.type==='fieldset').props.disabled,false);
});

await scenario('visible events during a successful read coalesce without concurrent requests',async ui=>{
 ui.visible();await ui.flush();for(let i=0;i<5;i++)ui.visible();assert.equal(ui.requests.length,2);
 ui.requests[1].finish(progress('First update'));await ui.flush();assert.equal(ui.requests.length,3);assert.equal(ui.quote(),'First update');
 ui.requests[2].finish(progress('Latest update'));await ui.flush();assert.equal(ui.quote(),'Latest update');assert.equal(ui.requests.length,3);
});

await scenario('a queued refresh does not start hidden work and resumes once visible',async ui=>{
 ui.visible();await ui.flush();ui.visible();ui.hide();ui.requests[1].finish({error:'Synthetic unavailable'},503);await ui.flush();
 assert.equal(ui.requests.length,2,'Hidden completion does not drain a network read');
 [...ui.timers.values()].find(timer=>timer.interval).fn();await ui.flush();assert.equal(ui.requests.length,2,'Polling while hidden also stays idle');
 ui.visible();await ui.flush();assert.equal(ui.requests.length,3);ui.requests[2].finish(progress('Visible update'));await ui.flush();
 assert.equal(ui.quote(),'Visible update');assert.equal(ui.requests.length,3,'The old queued event is consumed');
});

await scenario('unmount aborts an in-flight body and removes queued work, listeners and timers',async ui=>{
 ui.visible();await ui.flush();const late=ui.requests[1];late.headers(503);await ui.flush();ui.visible();ui.unmount();const writes=ui.writes();
 assert.equal(late.init.signal.aborted,true);late.body({error:'Synthetic unavailable'});await ui.flush();ui.visible();await ui.flush();
 assert.equal(ui.requests.length,2);assert.equal(ui.writes(),writes,'Aborted work cannot update an unmounted panel');assert.equal(ui.diagnostics.length,0);assert.equal(ui.timers.size,0);
});

await scenario('a changed deal aborts its former queued read and ignores its late data',async ui=>{
 ui.visible();await ui.flush();const old=ui.requests[1];old.headers();await ui.flush();ui.visible();ui.changeDeal();await ui.flush();
 assert.equal(old.init.signal.aborted,true);assert.equal(ui.requests.length,3);assert.match(ui.requests[2].url,/synthetic-other-deal$/);
 const current=progress('Current deal reply');ui.requests[2].finish(current);await ui.flush();const writes=ui.writes();
 old.body(progress('Obsolete deal reply'));await ui.flush();
 assert.equal(ui.quote(),'Current deal reply');assert.equal(ui.writes(),writes,'Late former-deal data cannot replace the current panel');assert.equal(ui.requests.length,3);
});
console.log('PASS fulfillment refresh queue: six local lifecycle scenarios, unchanged polling and no provider work.');
