import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const nodes=root=>root&&typeof root==='object'?Array.isArray(root)?root.flatMap(nodes):[root,...nodes(root.props?.children)]:[];
const text=root=>typeof root==='string'||typeof root==='number'?String(root):Array.isArray(root)?root.map(text).join(' '):root&&typeof root==='object'?text(root.props?.children):'';
const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
const ticket=id=>({id,kind:'account',subject:'Customer '+id,status:'open',updated_at:'2026-10-31T12:00:00Z',account_id:'account-'+id});
const tickets=[ticket('one'),ticket('two')];
function mount(file,exportName){
 let slots=[],cursor=0,pending=[],tree,dirty=true;
 const calls=[],document=new EventTarget();document.hidden=false;
 const hooks={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},
  useRef(initial){const i=cursor++;return slots[i]??={current:initial};},
  useCallback(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,fn};return slots[i].fn;},
  useEffect(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){const old=slots[i];slots[i]={deps};pending.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}},
 };
 const supportRequest=(path,init={})=>new Promise(resolve=>calls.push({path,init,resolve}));
 const mocks={react:hooks,'@/lib/support-client':{supportRequest},'@/lib/support-refund-evidence':{savedRefundCase:()=>null},'@/components/operator-exceptions':{OperatorExceptions:'OperatorExceptions'},'@/components/support-legacy-offer-review':{SupportLegacyOfferReview:'SupportLegacyOfferReview'},'@/components/support-message-content':{SupportMessageContent:'SupportMessageContent'},'@/components/support-quality-panel':{SupportQualityPanel:'SupportQualityPanel'},'@/components/account-access':{AccountAccess:'AccountAccess'}};
 const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};
 new Function('require','module','exports','document','setInterval','clearInterval',code)(name=>mocks[name]??(name.endsWith('.css')?{}:require(name)),mod,mod.exports,document,()=>1,()=>{});
 const render=()=>{cursor=0;dirty=false;tree=mod.exports[exportName]({});};
 async function flush(){for(let i=0;i<20;i++){if(dirty)render();const effects=pending;pending=[];effects.forEach(fn=>fn());await Promise.resolve();}return tree;}
 render();
 return {calls,flush,get tree(){return tree;},refresh(){document.dispatchEvent(new Event('visibilitychange'));},
  button(label){const node=nodes(tree).find(n=>n.type==='button'&&text(n).includes(label));assert(node,'Missing '+label);return node;},
  close(){slots.forEach(slot=>slot?.cleanup?.());},
 };
}
const answer=(call,data,status=200)=>call.resolve({ok:status<400,status,data});
function queue(h,start=0,status=200){for(const call of h.calls.slice(start).filter(c=>!c.init.method&&!c.path.includes('?'))){answer(call,call.path.endsWith('/access')?{requests:[],purchases:[]}:{threads:tickets,cancellations:[],deployment:{detail:'Fixture'}},status);}}
const detail=(h,id)=>h.calls.filter(c=>c.path.endsWith('?threadId='+id)).at(-1);
const contents=id=>({thread:ticket(id),messages:[{id:'message-'+id,role:'user',content:'Saved '+id,created_at:'2026-10-31T12:00:00Z'}]});
const selected=h=>nodes(h.tree).find(n=>n.type==='h2'&&text(n).startsWith('Customer '));
const h=mount('components/support-dashboard.tsx','SupportDashboard');
await h.flush();queue(h);await h.flush();h.button('Customer one').props.onClick();answer(detail(h,'one'),contents('one'));await h.flush();assert.equal(text(selected(h)),'Customer one');

// A timer firing while another conversation opens must not select the old one.
h.button('Customer two').props.onClick();const start=h.calls.length;h.refresh();
assert(!h.calls.slice(start).some(c=>c.path.includes('?threadId=')),'Background refresh waits for the foreground read');
answer(detail(h,'two'),contents('two'));queue(h,start);await h.flush();assert.equal(text(selected(h)),'Customer two');

// A foreground choice supersedes an older, quiet detail read.
const quietStart=h.calls.length;h.refresh();const old=detail(h,'two');h.button('Customer one').props.onClick();answer(old,contents('two'));queue(h,quietStart);await h.flush();
assert.equal(h.button('Customer one').props.disabled,true,'A stale completion cannot unlock a newer foreground request');
assert.equal(h.button('← Inbox').props.disabled,true,'Returning to the inbox cannot strand a foreground loading state');
answer(detail(h,'one'),contents('one'));await h.flush();assert.equal(text(selected(h)),'Customer one');

// Losing authorization invalidates both detail and independently pending queues.
const authStart=h.calls.length;h.refresh();answer(detail(h,'one'),{error:'Denied'},403);await h.flush();queue(h,authStart);await h.flush();
assert(!text(h.tree).includes('Customer one'));assert(!text(h.tree).includes('Customer two'));assert.match(text(h.tree),/Sign in with a support operator/);h.close();
const unauthorized=mount('components/support-dashboard.tsx','SupportDashboard');await unauthorized.flush();queue(unauthorized);await unauthorized.flush();const unauthorizedStart=unauthorized.calls.length;unauthorized.refresh();queue(unauthorized,unauthorizedStart,401);await unauthorized.flush();assert(!text(unauthorized.tree).includes('Customer one'));assert.match(text(unauthorized.tree),/Sign in with a support operator/);unauthorized.close();

// A customer send can lose its session while an earlier background read is pending.
const chat=mount('components/support-chat.tsx','SupportChat');await chat.flush();
const chatData={threads:[ticket('one')],messages:contents('one').messages,threadId:'one',cancellations:[]};answer(chat.calls[0],chatData);await chat.flush();chat.refresh();const staleRead=chat.calls.at(-1);
nodes(chat.tree).find(n=>n.type==='textarea').props.onChange({target:{value:'Help with my bot'}});await chat.flush();nodes(chat.tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
const send=chat.calls.at(-1);assert.equal(send.init.method,'POST');answer(send,{error:'Sign in'},401);await chat.flush();answer(staleRead,chatData);await chat.flush();assert.match(text(chat.tree),/Sign in to review your account/);assert(!nodes(chat.tree).some(n=>n.type==='form'),'A stale read cannot reopen the signed-out composer');chat.close();
console.log('Support read races: foreground selection wins, stale completions cannot unlock newer reads, and auth loss clears pending customer/operator reads.');
