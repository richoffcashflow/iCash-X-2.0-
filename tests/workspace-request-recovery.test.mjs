import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {webinarRequest} from '../lib/webinar-client.ts';
import * as status from '../lib/workspace-status.ts';
import * as progress from '../lib/workspace-progress.ts';

// All transport calls below are fixtures. Never use real accounts or providers.
const require=createRequire(import.meta.url),originalFetch=globalThis.fetch;
const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
function elements(root){return !root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(elements):[root,...elements(root.props?.children)];}
function text(root){return typeof root==='string'?root:Array.isArray(root)?root.map(text).join(' '):root&&typeof root==='object'?text(root.props?.children):'';}
function harness(file,props={}){
 let slots=[],cursor=0,dirty=true,pending=[],tree;
 const hooks={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useCallback(fn){cursor++;return fn;},
  useEffect(fn,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((value,index)=>!Object.is(value,previous.deps[index]))){slots[i]={deps,cleanup:previous?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}
 };
 const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};
 const deps={react:hooks,
  '@/lib/use-workspace-walkthrough':{useWorkspaceWalkthrough:()=>null},
  '@/lib/webinar-client':{webinarRequest:(path,init)=>webinarRequest(path,init,20)},'@/lib/workspace-status':status,'@/lib/workspace-progress':progress,'@/lib/bot-setup':{setupThemes:{ink:{color:'#111',soft:'#fff'}}},'next/dynamic':{default:loader=>loader.toString().match(/m\.(\w+)/)[1]},'next/image':{default:'Image'}};
 new Function('require','module','exports',code)(name=>name in deps?deps[name]:name==='react/jsx-runtime'?require(name):name.endsWith('.css')?{default:{}}:new Proxy({},{get:(_,key)=>key}),mod,mod.exports);
 const component=mod.exports.default??mod.exports.AccountAccess;
 function render(){cursor=0;dirty=false;tree=component(props);}
 return {
  async flush(){for(let i=0;i<30;i++){if(dirty)render();const effects=pending;pending=[];effects.forEach(fn=>fn());await tick();if(!dirty&&!pending.length)return tree;}throw Error('Render did not settle');},
  find(predicate){const node=elements(tree).find(predicate);assert(node,'Expected UI control');return node;},
  text(){return text(tree);},
  dispose(){slots.forEach(slot=>slot?.cleanup?.());}
 };
}
const fixture={workspaceAcknowledged:true,signedIn:true,email:'fixture@example.invalid',mode:'live',billingModel:'prepaid',identity:{principal:'Fixture'},assistantName:'Fixture',balanceCents:1000,paused:false,workReady:true};
function browserFixture(){
 const listeners=new Map();
 globalThis.window={location:{search:'',hash:'',pathname:'/'},history:{replaceState(){}},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}};
 globalThis.document={hidden:false,querySelector:()=>null,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}};
 return listeners;
}
let count=0;
async function scenario(name,fn){await fn();console.log('PASS '+(++count)+': '+name);}
try{
 await scenario('a stalled control request finishes once without repeating the write',async()=>{
  let calls=0,signal;
  globalThis.fetch=async(_path,init)=>{calls++;signal=init.signal;return new Promise(()=>{});};
  await assert.rejects(webinarRequest('/fixture/control',{method:'POST'},10),/may have completed.*Check its status/);
  assert.equal(calls,1);assert.equal(signal.aborted,true);
 });
 await scenario('a stalled response body cannot leave a read permanently loading',async()=>{
  globalThis.fetch=async()=>({ok:true,status:200,json:()=>new Promise(()=>{})});
  await assert.rejects(webinarRequest('/fixture/activity',{},10),/too long/);
 });
 await scenario('cancellation prevents a request and ignores a late response',async()=>{
  let calls=0,resolve;const abort=new AbortController();abort.abort();
  globalThis.fetch=async()=>{calls++;return Response.json({saved:true});};
  await assert.rejects(webinarRequest('/fixture', {signal:abort.signal},10));assert.equal(calls,0);
  const next=new AbortController();globalThis.fetch=()=>new Promise(r=>{resolve=r;});
  const result=webinarRequest('/fixture',{signal:next.signal},100);next.abort();await assert.rejects(result);
  resolve(Response.json({saved:true}));await tick();
 });
 await scenario('bad gateway and expired access errors are visible; a later read recovers',async()=>{
  globalThis.fetch=async()=>new Response('<html>Unavailable</html>',{status:502});
  await assert.rejects(webinarRequest('/fixture'),e=>e.status===502&&/Could not connect/.test(e.message));
  globalThis.fetch=async()=>Response.json({error:'Sign in again'},{status:401});
  await assert.rejects(webinarRequest('/fixture'),e=>e.status===401&&e.message==='Sign in again');
  globalThis.fetch=async()=>Response.json({saved:true});assert.deepEqual(await webinarRequest('/fixture'),{saved:true});
 });
 await scenario('duplicate Pause clicks send once; an older poll cannot undo confirmed status',async()=>{
  const listeners=browserFixture();let reads=0,writes=0,late,oldSignal;
  globalThis.fetch=async(path,init={})=>{
   if(path==='/api/work/control'){writes++;return Response.json({saved:true});}
   assert.equal(path,'/api/account?view=core');reads++;
   if(reads===2){oldSignal=init.signal;return new Promise(resolve=>{late=resolve;});}
   return Response.json({...fixture,paused:reads>=3});
  };
  const ui=harness('app/page.tsx');try{
   await ui.flush();listeners.get('visibilitychange')();await tick();
   const bar=ui.find(n=>n.type==='BotRunBar');bar.props.onPause();bar.props.onPause();await ui.flush();
   assert.equal(writes,1);assert.equal(reads,3);assert(oldSignal.aborted);
   late(Response.json(fixture));await ui.flush();
   const current=ui.find(n=>n.type==='BotRunBar');assert.equal(current.props.stopped,true);assert.equal(current.props.running,false);assert.equal(current.props.busy,false);
  }finally{ui.dispose();}
 });
 await scenario('an uncertain Pause result rereads saved status and releases the controls',async()=>{
  browserFixture();let paused=false,writes=0;
  globalThis.fetch=async(path)=>{if(path==='/api/work/control'){writes++;paused=true;return new Promise(()=>{});}assert.equal(path,'/api/account?view=core');return Response.json({...fixture,paused});};
  const ui=harness('app/page.tsx');try{
   await ui.flush();ui.find(n=>n.type==='BotRunBar').props.onPause();await new Promise(resolve=>setTimeout(resolve,30));await ui.flush();
   const bar=ui.find(n=>n.type==='BotRunBar');assert.equal(bar.props.stopped,true);assert.equal(bar.props.busy,false);assert.equal(writes,1);assert.match(ui.text(),/Check its status/);
  }finally{ui.dispose();}
 });
 await scenario('a failed sign-out is caught and does not pretend the user signed out',async()=>{
  browserFixture();globalThis.fetch=async(path)=>{if(path==='/api/auth/logout')throw Error('Connection lost');assert.equal(path,'/api/account?view=core');return Response.json(fixture);};
  const ui=harness('app/page.tsx');try{
   await ui.flush();ui.find(n=>n.type==='button'&&text(n)==='Sign out').props.onClick();await ui.flush();
   assert.equal(ui.find(n=>n.type==='BotRunBar').props.stale,false);assert.match(ui.text(),/Could not sign out/);
  }finally{ui.dispose();}
 });
 await scenario('a failed background account refresh keeps saved mode without a technical banner',async()=>{
  const listeners=browserFixture();let reads=0;
  globalThis.fetch=async path=>{assert.equal(path,'/api/account?view=core');if(++reads>1)throw Error('Connection lost');return Response.json(fixture);};
  const ui=harness('app/page.tsx');try{
   await ui.flush();listeners.get('visibilitychange')();await ui.flush();
   const bar=ui.find(n=>n.type==='BotRunBar');assert.equal(bar.props.enabled,true);assert.equal(bar.props.stale,true);assert.equal(bar.props.balanceCents,1000);
   assert.doesNotMatch(ui.text(),/Could not load your account|Your account could not refresh/);
  }finally{ui.dispose();}
 });
 await scenario('email-only sign-in preserves existing code, retry and trial recovery controls',async()=>{
  for(const props of [{},{trialRecovery:true},{ready:false}]){
   let signedIn=0;const calls=[];
   globalThis.fetch=async(path,init)=>{calls.push({path,body:JSON.parse(init.body)});return Response.json({signedIn:true});};
   const ui=harness('components/account-access.tsx',{initialEmail:'fixture@example.invalid',onSignedIn(){signedIn++;},...props});try{
    await ui.flush();assert.doesNotMatch(ui.text(),/checkout phone|Text me a code|Text code|mobile number/i);
    assert.equal(ui.find(n=>n.type==='input'&&n.props.type==='email').props.required,true);
    assert(ui.find(n=>n.type==='a'&&n.props.href==='/access/help'));
    if(props.ready===false){assert.equal(ui.find(n=>n.type==='button'&&text(n)==='Email me a code').props.disabled,true);assert.match(ui.text(),/temporarily unavailable/);continue;}
    ui.find(n=>n.type==='button'&&text(n)==='I already have a code').props.onClick();await ui.flush();
    ui.find(n=>n.type==='input'&&n.props.autoComplete==='one-time-code').props.onChange({target:{value:'123456'}});await ui.flush();
    await ui.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await ui.flush();
    assert.equal(signedIn,1);assert.deepEqual(calls,[{path:'/api/auth/verify',body:{email:'fixture@example.invalid',code:'123456'}}]);
    ui.find(n=>n.type==='button'&&text(n)==='Use another email or resend').props.onClick();await ui.flush();
    assert.equal(ui.find(n=>n.type==='input'&&n.props.type==='email').props.disabled,false);
    assert(ui.find(n=>n.type==='button'&&text(n)==='Email me a code'));
   }finally{ui.dispose();}
  }
 });
 await scenario('a stalled sign-in releases the form and duplicate submits do not send twice',async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;return new Promise(()=>{});};
  const ui=harness('components/account-access.tsx',{initialEmail:'fixture@example.invalid',onSignedIn(){throw Error('No successful sign-in');}});try{
   await ui.flush();const form=ui.find(n=>n.type==='form');const event={preventDefault(){}};
   await Promise.all([form.props.onSubmit(event),form.props.onSubmit(event)]);await ui.flush();
   assert.equal(calls,1);assert.equal(ui.find(n=>n.type==='button'&&text(n)==='Sign in').props.disabled,false);assert.match(ui.text(),/Email code/);assert.doesNotMatch(ui.text(),/Use my checkout phone|Text me a code/);assert.match(ui.text(),/too long/);
  }finally{ui.dispose();}
 });
}finally{globalThis.fetch=originalFetch;}
assert.equal(count,10);
console.log('Ten bounded local request-recovery scenarios passed. No external requests or paid providers.');
