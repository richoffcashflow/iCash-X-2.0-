import {smsLength} from '../lib/sms-length.ts';
import * as textSendState from '../lib/text-send-state.ts';
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import ts from 'typescript';
const require=createRequire(import.meta.url),mod={exports:{}};const source=readFileSync(new URL('../components/deal-messages.tsx',import.meta.url),'utf8').replace('function TextComposer(','export function TextComposer(');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new Function('require','module','exports',code)(name=>name==='react'?{useState:()=>[0,()=>{}]}:['@/components/owner-phone-privacy','@/lib/workspace-events-client','./workspace-view','./call-conversation','@/lib/conversation-timeline','@/lib/poll-cadence'].includes(name)?{}:name==='@/lib/sms-length'?{smsLength}:name==='@/lib/text-send-state'?textSendState:require(name),mod,mod.exports);
let takenOver=0,calls=[],finish,response={status:'message_accepted',manual:true},savedDraft=null;globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});await new Promise(r=>finish=r);return Response.json(response);};const attempts={},props={thread:{id:'seller',party:'seller',paused:false},message:'Hello',setMessage:m=>savedDraft=m,onSent(){},onTakeover(){takenOver++},attempts,stale:false},event={preventDefault(){}};
const form=mod.exports.TextComposer(props);const first=form.props.onSubmit(event);await form.props.onSubmit(event);assert.equal(calls.length,1,'Same-frame submit locked');assert.equal(calls[0].body.threadId,'seller');assert(calls[0].body.requestKey);finish();await first;assert.equal(savedDraft,'');assert.equal(takenOver,1,'accepted customer text confirms lead takeover');
response={status:'held',manual:true};const second=mod.exports.TextComposer({...props,thread:{id:'buyer',party:'buyer',paused:false}}).props.onSubmit(event);finish();await second;assert.equal(attempts.buyer.held,true);assert.equal(takenOver,2,'saved human text takes over even if delivery is held');await mod.exports.TextComposer({...props,thread:{id:'buyer',paused:false}}).props.onSubmit(event);assert.equal(calls.length,2,'Returning to a held contact cannot resend');
for(const update of [{stale:true},{thread:{id:'paused',paused:true,manualReply:false}},{thread:{id:'empty-wallet',paused:true,manualReply:true,sendReason:'Add credits to send.'}},{message:'x'.repeat(161)},{message:'🌟'.repeat(36)}])await mod.exports.TextComposer({...props,...update}).props.onSubmit(event);assert.equal(calls.length,2,'Stale, blocked and over-limit drafts do not send');
console.log('PASS conversation sends: contact-specific request keys, same-frame duplicate lock, held state survives contact changes, stale/permission/length limits.');

const manualForm=mod.exports.TextComposer({...props,thread:{id:'manual',paused:true,manualReply:true}});response={status:'message_accepted',manual:true};const manualSend=manualForm.props.onSubmit(event);finish();await manualSend;assert.equal(calls.length,3,'paused bot still permits manual conversation');

response={status:'message_not_sent',notSent:true,state:'ready',error:'Spending allowance reached.'};
const retryProps={...props,thread:{id:'retry',paused:false}};
const failed=mod.exports.TextComposer(retryProps).props.onSubmit(event);finish();await failed;
const originalKey=attempts.retry.key;assert.equal(attempts.retry.held,false);assert.equal(attempts.retry.retryable,true);
response={status:'message_accepted',manual:true};const retry=mod.exports.TextComposer(retryProps).props.onSubmit(event);finish();await retry;
assert.equal(calls.at(-1).body.requestKey,originalKey,'a known unstarted message reuses its original idempotency key');

// Passive reads retain saved conversation state without announcing transport errors.
// Explicit sends above still expose their outcome and preserve unknown-send holds.
const originalDocument=globalThis.document,originalWindow=globalThis.window,originalTimeout=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
const passiveListeners=new Map();
globalThis.document={hidden:false,addEventListener:(name,fn)=>passiveListeners.set(name,fn),removeEventListener:name=>passiveListeners.delete(name)};
globalThis.window={addEventListener(){},removeEventListener(){}};
const timers=new Set();
globalThis.setTimeout=(fn,ms,...args)=>{if(ms>=300){const id={fn};timers.add(id);return id;}return originalTimeout(fn,ms,...args);};
globalThis.clearTimeout=id=>{if(timers.has(id))timers.delete(id);else originalClear(id);};
function passiveHarness(){
 let slots=[],cursor=0,dirty=true,pending=[],tree;
 const hooks={
  useState(value){const i=cursor++;if(!(i in slots))slots[i]=value;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;dirty=true;}];},
  useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},
  useEffect(fn,deps){const i=cursor++,prior=slots[i];if(!prior||deps.some((v,n)=>!Object.is(v,prior.deps[n]))){slots[i]={deps,cleanup:prior?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}
 };
 const module={exports:{}};
 new Function('require','module','exports',code)(name=>name==='react'?hooks:name==='@/lib/workspace-events-client'?{subscribeWorkspaceChanges:()=>()=>{},notifyWorkspaceChanges(){}}:name==='@/lib/poll-cadence'?{createPollCadence:()=>({observe:()=>5000,failed:()=>10000})}:['@/components/owner-phone-privacy','./workspace-view','./call-conversation','@/lib/conversation-timeline'].includes(name)?{}:name==='@/lib/sms-length'?{smsLength}:name==='@/lib/text-send-state'?textSendState:require(name),module,module.exports);
 const nodes=root=>!root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(nodes):[root,...nodes(root.props?.children)];
 const visibleText=root=>typeof root==='string'?root:Array.isArray(root)?root.map(visibleText).join(' '):root&&typeof root==='object'?visibleText(root.props?.children):'';
 return{async flush(){for(let i=0;i<15;i++){if(dirty){cursor=0;dirty=false;tree=module.exports.DealMessages({dealId:'fixture'});}const effects=pending;pending=[];effects.forEach(fn=>fn());await new Promise(r=>originalTimeout(r,0));if(!dirty&&!pending.length)return;}throw Error('Read fixture did not settle');},text:()=>visibleText(tree),nodes:()=>nodes(tree),dispose(){slots.forEach(slot=>slot?.cleanup?.());}};
}
try{
 let unavailable=true,readCalls=0;
 globalThis.fetch=async()=>{readCalls++;if(unavailable)return new Response('',{status:503});return Response.json({threads:[{id:'seller',recipient:'+12025550123',paused:false}],threadId:'seller',messages:[{id:'message',thread_id:'seller',direction:'incoming',state:'received',body:'Saved seller answer',created_at:'2026-10-30T12:00:00Z'}],nextThread:null,next:null});};
 const empty=passiveHarness();await empty.flush();
 assert.match(empty.text(),/Refresh messages/);assert.doesNotMatch(empty.text(),/could not|Loading conversation|No text conversation/i,'failed first read stays neutral without inventing emptiness');
 unavailable=false;passiveListeners.get('visibilitychange')();await empty.flush();
 let conversation=empty.nodes().find(n=>n.props?.thread?.id==='seller');assert(conversation);assert.equal(conversation.props.messages[0].body,'Saved seller answer');assert.equal(conversation.props.stale,false);
 unavailable=true;passiveListeners.get('visibilitychange')();await empty.flush();
 conversation=empty.nodes().find(n=>n.props?.thread?.id==='seller');assert(conversation,'saved conversation survives a failed background refresh');assert.equal(conversation.props.messages[0].body,'Saved seller answer');assert.equal(conversation.props.stale,true,'a silent read failure never authorizes a new send');
 assert.doesNotMatch(empty.text(),/could not|Retry|Refresh messages|Loading conversation/i);
 assert.equal(readCalls,3,'reads recover on visibility without starting a send');empty.dispose();
 console.log('PASS quiet conversation reads: neutral first failure, recovered messages retained after later failure, and stale send protection.');
}finally{globalThis.document=originalDocument;globalThis.window=originalWindow;globalThis.setTimeout=originalTimeout;globalThis.clearTimeout=originalClear;timers.clear();}
