import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as guidance from '../lib/support-self-service.ts';
const require=createRequire(import.meta.url),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const evidence=[{key:'work',code:'paused',source:'icash_accounts',status:'attention',detail:'Your bot is paused. Previously authorized work may still finish.',observedAt:'2026-10-02T00:00:00Z'},{key:'billing',code:'renewal_active',source:'icash_daily_plans',status:'ok',detail:'A live daily renewal plan is recorded as active.',observedAt:'2026-10-02T00:00:00Z'}];
evidence.push({key:'payments',code:'payment_uncredited',source:'icash_funding_orders',status:'attention',detail:'A recorded paid payment is not yet marked credited.',observedAt:'2026-10-02T00:00:00Z'});
let slots=[],cursor=0,dirty=true,pending=[],tree,calls=[],inFlight=0,signedIn=true,historyError=false,sendFailure=false,replyPending=false,escalateConfirmed=true,confirmMode='pending',history={threads:[],messages:[],threadId:null,cancellations:[],evidence};
const hooks={
 useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},
 useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
 useCallback(fn,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((v,j)=>!Object.is(v,previous.deps[j])))slots[i]={deps,fn};return slots[i].fn;},
 useEffect(fn,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((v,j)=>!Object.is(v,previous.deps[j]))){slots[i]={deps,cleanup:previous?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}},
};
function module(file){const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;const mod={exports:{}};new Function('require','module','exports',code)(name=>name==='react'?hooks:name==='@/lib/support-self-service'?guidance:name==='@/components/account-access'?{AccountAccess:'AccountAccess'}:name==='@/components/support-account-checks'?checks:name.endsWith('.css')?{}:require(name),mod,mod.exports);return mod.exports;}
const checks=module('components/support-account-checks.tsx'),{SupportChat}=module('components/support-chat.tsx');
const logGeometry={scrollTop:0,scrollHeight:700};
assert.doesNotMatch(readFileSync(new URL('../components/support-chat.tsx',import.meta.url),'utf8'),/scrollIntoView|window\.scroll|document\.scroll/,'message updates must not scroll the page past account checks');
function elements(root){if(!root||typeof root!=='object')return[];if(Array.isArray(root))return root.flatMap(elements);if(typeof root.type==='function')return elements(root.type(root.props));return[root,...elements(root.props?.children)];}
function text(root){if(typeof root==='string'||typeof root==='number')return String(root);if(Array.isArray(root))return root.map(text).join(' ');if(root&&typeof root==='object')return typeof root.type==='function'?text(root.type(root.props)):text(root.props?.children);return '';}
const find=p=>{const node=elements(tree).find(p);assert(node,'expected control');return node;};
const button=label=>find(n=>n.type==='button'&&text(n)===label),draft=()=>find(n=>n.type==='textarea'),form=()=>find(n=>n.type==='form'),postCalls=()=>calls.filter(c=>c.options.method==='POST');
function render(){cursor=0;dirty=false;tree=SupportChat({onClose(){}});const log=elements(tree).find(n=>n.props?.role==='log');if(log?.props.ref)log.props.ref.current=logGeometry;return tree;}
async function flush(){for(let i=0;i<25;i++){if(dirty)render();const work=pending;pending=[];work.forEach(fn=>fn());await new Promise(r=>setTimeout(r,8));if(!dirty&&!pending.length&&!inFlight)return tree;}throw Error('Render did not settle');}
function type(value){draft().props.onChange({target:{value}});}
const submit=()=>form().props.onSubmit({preventDefault(){}});
globalThis.fetch=async(url,options={})=>{
 inFlight++;try{calls.push({url,options});await new Promise(r=>setTimeout(r,2));
 if(!signedIn)return Response.json({error:'Sign in to get help.'},{status:401});
 if(options.method!=='POST')return historyError?Response.json({error:'Support history is unavailable. Please retry.'},{status:503}):Response.json(history);
 const body=JSON.parse(options.body);
 if(url==='/api/support/cancel'){
  if(body.action==='prepare')return Response.json({token:`${id(9)}.${'f'.repeat(64)}`,summary:'Pause new bot work and stop future live daily renewals. Existing credit remains. No refund or deletion.',expiresAt:Date.now()+600_000});
  assert.equal(body.acknowledged,true);assert.match(body.token,/^[\w-]+\.[a-f0-9]{64}$/);
  if(confirmMode==='expired')return Response.json({error:'This confirmation expired or was already used. Refresh to check the result before trying again.'},{status:409});
  history={...history,cancellations:[{id:id(9),source:'account',state:confirmMode==='pending'?'needs_review':'cancelled',result:confirmMode==='pending'?'Provider cancellation is not yet confirmed.':'Your bot and daily renewals were stopped.'}]};
  return Response.json({confirmed:confirmMode!=='pending',message:confirmMode==='pending'?'Your pause request is saved. Provider cancellation is not yet confirmed; support review is needed.':'Your bot is paused and future live daily renewals are stopped.'},{status:confirmMode==='pending'?202:200});
 }
 if(body.action==='escalate'){if(escalateConfirmed)history={...history,threads:history.threads.map(t=>({...t,status:'escalated'}))};return Response.json({escalated:escalateConfirmed});}
 if(sendFailure)return Response.json({error:'Could not confirm that the reply was saved. Refresh before retrying.'},{status:503});
 history={...history,threadId:id(3),threads:[{id:id(3),subject:'Fixture support',status:'open'}],messages:[{id:id(4),role:'user',content:body.message,evidence:[],created_at:'2026-10-02T00:00:00Z'},{id:id(5),role:'assistant',content:'Fixture account answer.',evidence,created_at:'2026-10-02T00:00:01Z'}]};
 return Response.json({threadId:id(3),pending:replyPending},{status:replyPending?202:200});
 }finally{inFlight--;}
};
render();await flush();assert.match(text(tree),/Your account at a glance/);assert.match(text(tree),/Previously authorized work may still finish/);assert.equal(postCalls().length,0,'loading the page is read-only');assert.equal(logGeometry.scrollTop,700,'initial history scrolls only its own message log');
assert.equal(find(n=>n.type==='a'&&text(n).includes('Review bot controls')).props.href,'/');
button('My bot stopped').props.onClick();await flush();assert.match(draft().props.value,/Why did my bot stop/);assert.equal(postCalls().length,0,'quick prompts never send or act automatically');
button('Ask the team').props.onClick();await flush();assert.match(draft().props.value,/Why did my bot stop/);assert.match(text(tree),/Send your message first/);assert.equal(postCalls().length,0,'no empty escalation is created');
type('');await flush();button('Prepare support question').props.onClick();await flush();assert.match(draft().props.value,/I need help with Payment records/);assert.equal(postCalls().length,0,'a card prepares current context rather than escalating an old conversation');button('Something else').props.onClick();await flush();assert.match(draft().props.value,/I need help with Payment records/,'choosing another question does not overwrite an unsent draft');
const prepare=button('Review cancellation');prepare.props.onClick();prepare.props.onClick();await flush();assert.equal(postCalls().length,1,'same-frame prepare clicks are locked');assert.equal(JSON.parse(postCalls()[0].options.body).action,'prepare');
assert.equal(find(n=>n.type==='input'&&n.props.type==='checkbox').props.checked,false);assert.equal(button('Confirm cancellation').props.disabled,true);button('Confirm cancellation').props.onClick();await flush();assert.equal(postCalls().length,1,'unchecked confirmation does not invoke endpoint even if handler is called');
button('Keep my current settings').props.onClick();await flush();assert.equal(postCalls().length,1,'dismissal never cancels');assert(!elements(tree).some(n=>n.props?.id==='support-cancel-heading'));
button('Review cancellation').props.onClick();await flush();find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});await flush();const confirm=button('Confirm cancellation');confirm.props.onClick();confirm.props.onClick();await flush();assert.equal(postCalls().filter(c=>JSON.parse(c.options.body).action==='confirm').length,1);assert.match(text(tree),/not yet confirmed/);assert.doesNotMatch(text(tree),/Cancellation confirmed when/);assert(!elements(tree).some(n=>n.props?.id==='support-cancel-heading'));
confirmMode='confirmed';button('Review cancellation').props.onClick();await flush();assert.equal(find(n=>n.type==='input'&&n.props.type==='checkbox').props.checked,false,'each prepared confirmation starts unchecked');find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});await flush();button('Confirm cancellation').props.onClick();await flush();assert.match(text(tree),/Cancellation confirmed when this request was completed/);assert.match(text(tree),/future live daily renewals are stopped/);
// Failed sends retain the draft and reuse a request ID; the synchronous lock also guards duplicates.
sendFailure=true;type('Why did my bot stop?');await flush();submit();submit();await flush();const firstSend=postCalls().filter(c=>JSON.parse(c.options.body).message).at(-1);assert.equal(draft().props.value,'Why did my bot stop?');assert.match(text(tree),/Could not confirm that the reply/);
logGeometry.scrollTop=40;logGeometry.scrollHeight=900;history={...history,threadId:id(3),threads:[{id:id(3),subject:'Saved before lost response',status:'open'}],messages:[{id:id(4),role:'user',content:'Why did my bot stop?',evidence:[],created_at:'2026-10-02T00:00:00Z'}]};button('Refresh status').props.onClick();await flush();assert.equal(draft().props.value,'Why did my bot stop?');assert.equal(logGeometry.scrollTop,900,'refresh keeps page position and updates only the internal log');
logGeometry.scrollTop=40;logGeometry.scrollHeight=1100;sendFailure=false;replyPending=true;submit();await flush();const retry=postCalls().filter(c=>JSON.parse(c.options.body).message).at(-1);assert.equal(JSON.parse(firstSend.options.body).requestId,JSON.parse(retry.options.body).requestId);assert.equal(JSON.parse(retry.options.body).threadId,undefined,'retry preserves the original null thread binding after discovery');assert.equal(draft().props.value,'');assert.match(text(tree),/reply is not yet confirmed/);assert.match(text(tree),/View the checks saved with this answer/);assert.equal(logGeometry.scrollTop,1100,'a newly sent message stays visible inside the log');
escalateConfirmed=false;button('Ask the team').props.onClick();await flush();assert.match(text(tree),/Could not confirm the support request/);assert.doesNotMatch(text(tree),/Sent this conversation/);
escalateConfirmed=true;button('Ask the team').props.onClick();await flush();assert.match(text(tree),/Sent this conversation and its saved account checks to the support team/);
// A refresh failure removes the formerly current snapshot but keeps the saved conversation visible.
historyError=true;button('Refresh status').props.onClick();await flush();assert.match(text(tree),/Account checks are unavailable/);assert.equal(elements(tree).filter(n=>n.props?.className==='support-check').length,0);assert.match(text(tree),/Fixture account answer/);
historyError=false;button('Refresh status').props.onClick();await flush();assert(elements(tree).some(n=>n.props?.className==='support-check'));
confirmMode='expired';button('Review cancellation').props.onClick();await flush();find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});await flush();button('Confirm cancellation').props.onClick();await flush();assert.match(text(tree),/expired or was already used/);
// Losing authentication clears the old account, pending nonce, message draft, and saved messages.
signedIn=false;type('private old account draft');await flush();button('Refresh status').props.onClick();await flush();assert.match(text(tree),/Sign in so we can check only your account/);assert.doesNotMatch(text(tree),/Fixture account answer|Your bot is paused|private old account draft/);assert(!elements(tree).some(n=>n.props?.id==='support-cancel-heading'));assert(button('Close'));
signedIn=true;history={threads:[],messages:[],threadId:null,cancellations:[],evidence:[]};find(n=>n.type==='AccountAccess').props.onSignedIn();await flush();assert.equal(draft().props.value,'');assert.doesNotMatch(text(tree),/Fixture account answer/);assert(!elements(tree).some(n=>n.props?.id==='support-cancel-heading'));
slots.forEach(slot=>slot?.cleanup?.());
console.log('Customer help UI: read-only load, internal-log-only scroll on initial load/refresh/new message, deterministic next steps, prompts, empty/existing escalation, ack/nonce flow, duplicate lock, dismiss/expired/partial outcomes, draft-safe retry, stale snapshot and signed-out recovery passed. Mocked endpoints only.');
