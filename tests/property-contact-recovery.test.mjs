import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {webinarRequest} from '../lib/webinar-client.ts';

// The real component and request helper, with fictional transport. Only deliberate
// timeout scenarios use a short deadline; normal async assertions retain headroom.
// No account, provider, contact or message is created by these fixtures.
const require=createRequire(import.meta.url),originalFetch=globalThis.fetch;
const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):'';
const elements=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(elements):[node,...elements(node.props?.children)];
const contact={phone:'+12025550101',name:'Fixture Seller',phone_type:'mobile',blocked:false};
const ids={screeningId:'11111111-1111-4111-8111-111111111111',dealId:'22222222-2222-4222-8222-222222222222',threadId:'33333333-3333-4333-8333-333333333333'};
function harness(overrides={},timeoutMs=500){
 let props={screeningId:ids.screeningId,active:true,onTakeover(){assert.fail('Opening a conversation cannot take over');},...overrides};
 let slots=[],cursor=0,dirty=true,effects=[],tree,disposed=false,lateUpdates=0;
 const hooks={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],next=>{if(disposed){lateUpdates++;return;}const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useEffect(fn,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((value,index)=>!Object.is(value,previous.deps[index]))){slots[i]={deps,cleanup:previous?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}
 };
 const code=ts.transpileModule(readFileSync(new URL('../components/property-messages.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const deps={react:hooks,'react/jsx-runtime':require('react/jsx-runtime'),'@/lib/webinar-client':{webinarRequest:(path,init)=>webinarRequest(path,init,timeoutMs)},'./deal-messages':{DealMessages:'DealMessages'},'./manual-call-options':{displayContactPhone:value=>value},'@/components/owner-phone-privacy':{PrivatePhone:'PrivatePhone'},'lucide-react':{MessageCircle:'MessageCircle'}};
 const mod={exports:{}};new Function('require','module','exports',code)(name=>{assert(name in deps,'Unmocked import '+name);return deps[name];},mod,mod.exports);
 const render=()=>{cursor=0;dirty=false;tree=mod.exports.PropertyMessages(props);};
 return {
  async flush(ms=0){const end=Date.now()+ms;do{if(dirty)render();const pending=effects;effects=[];pending.forEach(fn=>fn());await tick();}while(dirty||effects.length||Date.now()<end);return tree;},
  update(next){props={...props,...next};dirty=true;},
  find(predicate){const result=elements(tree).find(predicate);assert(result,'Expected component control: '+text(tree));return result;},
  text:()=>text(tree),
  dispose(){disposed=true;slots.forEach(slot=>slot?.cleanup?.());},
  lateUpdates:()=>lateUpdates
 };
}
let count=0;
async function scenario(name,fn){await fn();console.log('PASS '+(++count)+': '+name);}
try{
 await scenario('a stalled saved-contact read exposes its existing reload control and recovers',async()=>{
  let requests=0,signal;
  globalThis.fetch=async(_path,init)=>{assert.equal(init.method??'GET','GET');requests++;signal=init.signal;return requests===1?new Promise(()=>{}):Response.json({contacts:[contact],...ids});};
  const ui=harness({},15);try{
   await ui.flush(40);assert.match(ui.text(),/Reload saved contacts/);assert.doesNotMatch(ui.text(),/Loading saved numbers/);assert(signal.aborted);assert.equal(requests,1);
   ui.find(n=>n.type==='button'&&text(n)==='Reload saved contacts').props.onClick();await ui.flush();
   assert.equal(ui.find(n=>n.type==='DealMessages').props.dealId,ids.dealId);assert.equal(requests,2);
  }finally{ui.dispose();}
 });
 await scenario('an uncertain open releases busy state without a second write; retry reads the saved result',async()=>{
  let gets=0,writes=0,releaseBody,signal;
  globalThis.fetch=async(_path,init)=>{if(init.method==='POST'){writes++;signal=init.signal;return {ok:true,json:()=>new Promise(resolve=>{releaseBody=resolve;})};}gets++;return Response.json(gets===1?{contacts:[contact],dealId:null,threadId:null}:{contacts:[contact],...ids});};
  const ui=harness({},15);try{
   await ui.flush(40);assert.equal(writes,1);assert(signal.aborted);assert.doesNotMatch(ui.text(),/Opening conversation/);assert.match(ui.text(),/may have completed/);
   ui.find(n=>n.type==='button'&&text(n)==='Retry').props.onClick();await ui.flush();
   assert.equal(ui.find(n=>n.type==='DealMessages').props.dealId,ids.dealId);assert.equal(writes,1);assert.equal(gets,2);assert.doesNotMatch(ui.text(),/may have completed|Opening conversation/);
   releaseBody({dealId:'late-unconfirmed-deal',threadId:'late-thread'});await ui.flush();
   assert.equal(ui.find(n=>n.type==='DealMessages').props.dealId,ids.dealId,'late timed-out response cannot replace the recovered original');
  }finally{ui.dispose();}
 });
 await scenario('rapid duplicate open clicks perform only one request and retain the chosen contact',async()=>{
  let writes=0,release;globalThis.fetch=async(_path,init)=>init.method==='POST'?(writes++,new Promise(resolve=>{release=resolve;})):Response.json({contacts:[contact,{...contact,phone:'+12025550102'}]});
  const ui=harness();try{
   await ui.flush();const button=ui.find(n=>n.type==='button'&&text(n).includes('Open text conversation'));button.props.onClick();button.props.onClick();await ui.flush();assert.equal(writes,1);
   release(Response.json(ids));await ui.flush();assert.equal(ui.find(n=>n.type==='DealMessages').props.initialThreadId,ids.threadId);assert.doesNotMatch(ui.text(),/Opening conversation/);
  }finally{ui.dispose();}
 });
 await scenario('cancelled contact reads cannot open a conversation after leaving the text view',async()=>{
  let release,writes=0;globalThis.fetch=async(_path,init)=>{if(init.method==='POST'){writes++;return Response.json(ids);}return new Promise(resolve=>{release=resolve;});};
  const ui=harness();try{await ui.flush();ui.update({active:false});await ui.flush();release(Response.json({contacts:[contact]}));await ui.flush();assert.equal(writes,0);assert.doesNotMatch(ui.text(),/Opening conversation/);}finally{ui.dispose();}
 });
 await scenario('an unfinished open is aborted on unmount and ignores a late successful response',async()=>{
  let release,signal;globalThis.fetch=async(_path,init)=>init.method==='POST'?(signal=init.signal,new Promise(resolve=>{release=resolve;})):Response.json({contacts:[contact]});
  const ui=harness();await ui.flush();ui.dispose();assert(signal.aborted);release(Response.json(ids));await tick();await tick();assert.equal(ui.lateUpdates(),0);
 });
 await scenario('invalid contact data cannot crash saved history or grant a contact',async()=>{
  globalThis.fetch=async()=>Response.json({contacts:null});const ui=harness({knownDealId:ids.dealId});try{await ui.flush();assert.equal(ui.find(n=>n.type==='DealMessages').props.dealId,ids.dealId);assert.match(ui.text(),/Reload saved contacts/);}finally{ui.dispose();}
 });
}finally{globalThis.fetch=originalFetch;}
assert.equal(count,6);
console.log('Six contact-panel recovery scenarios passed with no external requests or paid work.');
