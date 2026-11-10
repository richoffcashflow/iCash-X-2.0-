// Actual client handlers with local hook/fetch fixtures only. No live requests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as demo from '../lib/bot-demo.ts';
import * as callNow from '../lib/optin-call-now.ts';
import * as progress from '../lib/seller-submission-status.ts';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../components/bot-demo.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):'';
const find=(tree,predicate)=>{const n=nodes(tree).find(predicate);assert(n,'Expected rendered control');return n;};
const button=(tree,label)=>find(tree,n=>n.type==='button'&&text(n)===label);
const form=tree=>find(tree,n=>n.type==='form');
const consent=tree=>find(tree,n=>n.type==='input'&&n.props.type==='checkbox');
const event={preventDefault(){}};
const savedGlobals={fetch:globalThis.fetch,requestAnimationFrame:globalThis.requestAnimationFrame};
function harness(){
 let cells=[],cursor=0,dirty=true,pending=[],tree,fail=true,terminal=progress.sellerSubmissionStatus('assigned','contact_started');
 const calls=[];
 globalThis.requestAnimationFrame=fn=>fn();
 globalThis.fetch=async(url,options={})=>{
  calls.push({url,options});
  if(url==='/api/demo/intake'&&options.method!=='POST')return Response.json({ready:true,privateDemoPhone:'+12145550123'});
  if(url.startsWith('/api/seller/status?'))return Response.json(terminal);
  assert.equal(url,'/api/demo/intake');assert.equal(options.method,'POST');
  if(fail)throw Error('Fixture uncertain network response');
  return Response.json({received:true,progress:terminal});
 };
 const hooks={
  useState(initial){const i=cursor++;if(!(i in cells))cells[i]=initial;return[cells[i],next=>{const value=typeof next==='function'?next(cells[i]):next;if(!Object.is(cells[i],value)){cells[i]=value;dirty=true;}}];},
  useRef(initial){const i=cursor++;if(!(i in cells))cells[i]={current:initial};return cells[i];},
  useEffect(fn,deps){const i=cursor++,prior=cells[i];if(!prior||deps.some((v,j)=>!Object.is(v,prior.deps[j]))){cells[i]={deps,cleanup:prior?.cleanup};pending.push(()=>{cells[i].cleanup?.();cells[i].cleanup=fn();});}},
 };
 const mod={exports:{}};
 new Function('require','module','exports',code)(name=>{
  if(name==='react')return hooks;
  if(name==='react/jsx-runtime')return require(name);
  if(name==='lucide-react')return Object.fromEntries(['ArrowLeft','ArrowUpRight','Check','House','Phone','Sparkles'].map(n=>[n,n]));
  if(name==='@/lib/bot-demo')return demo;
  if(name==='@/lib/optin-call-now')return callNow;
  if(name==='@/lib/seller-submission-status')return progress;
  if(name==='@/components/seller-address-input')return {SellerAddressInput:'SellerAddressInput'};
  if(name==='./demo-phone-field')return {DemoPhoneField:'DemoPhoneField'};
  throw Error('Unexpected import '+name);
 },mod,mod.exports);
 return {
  calls,posts:()=>calls.filter(c=>c.options.method==='POST').map(c=>JSON.parse(c.options.body)),
  succeed(){fail=false;},phase(state,response){terminal=progress.sellerSubmissionStatus(state,response);},
  async flush(){for(let i=0;i<16;i++){if(dirty){cursor=0;dirty=false;tree=mod.exports.BotDemo();}const effects=pending;pending=[];effects.forEach(fn=>fn());await new Promise(resolve=>setTimeout(resolve,1));if(!dirty&&!pending.length)return tree;}throw Error('Render did not settle');},
  close(){cells.forEach(cell=>cell?.cleanup?.());},
 };
}
try{
 const h=harness();let tree=await h.flush();
 find(tree,n=>n.type==='SellerAddressInput').props.onChange('45 Fixture Lane, Dallas, TX 75201');tree=await h.flush();
 form(tree).props.onSubmit(event);tree=await h.flush();
 find(tree,n=>n.props?.id==='demo-name').props.onChange({target:{value:'Demo Seller'}});tree=await h.flush();
 consent(tree).props.onChange({target:{checked:true}});tree=await h.flush();
 const first=form(tree);const a=first.props.onSubmit(event),b=first.props.onSubmit(event);await Promise.all([a,b]);tree=await h.flush();
 assert.equal(h.posts().length,1,'Double click submits once');
 const original=h.posts()[0].requestId;assert.match(text(tree),/uncertain network response/);
 h.succeed();await form(tree).props.onSubmit(event);tree=await h.flush();
 assert.equal(h.posts().length,2);assert.equal(h.posts()[1].requestId,original,'Uncertain response retries the exact original request');
 const callsBefore=h.calls.length;
 button(tree,'Start a new demo').props.onClick();tree=await h.flush();
 assert.equal(consent(tree).props.checked,false,'Intentional new run requires fresh confirmation');
 assert.equal(find(tree,n=>n.props?.id==='demo-name').props.value,'Demo Seller');
 assert.equal(find(tree,n=>n.type==='DemoPhoneField').props.value,'+12145550123');
 assert.equal(h.calls.length,callsBefore,'Opening new run does not submit, reset history or call a provider');
 await form(tree).props.onSubmit(event);assert.equal(h.posts().length,2,'Cannot submit before renewed consent');
 consent(tree).props.onChange({target:{checked:true}});tree=await h.flush();
 await form(tree).props.onSubmit(event);tree=await h.flush();
 assert.notEqual(h.posts()[2].requestId,original,'Intentional resubmit uses a fresh request ID with identical property and phone');
 assert.equal(h.posts()[2].address,h.posts()[0].address);assert.equal(h.posts()[2].phone,h.posts()[0].phone);
 // Existing button is available from all completed/saved statuses that formerly
 // forced a manual reset. Address errors retain their existing Update address path.
 for(const [state,response] of [['duplicate_demo'],['archived_demo'],['assigned','needs_setup'],['assigned','stopped'],['assigned','contact_started']]){
  button(tree,'Start a new demo').props.onClick();tree=await h.flush();
  assert.equal(consent(tree).props.checked,false);h.phase(state,response);
  consent(tree).props.onChange({target:{checked:true}});tree=await h.flush();
  await form(tree).props.onSubmit(event);tree=await h.flush();button(tree,'Start a new demo');
 }
 button(tree,'Start a new demo').props.onClick();tree=await h.flush();h.phase('unmatched');
 consent(tree).props.onChange({target:{checked:true}});tree=await h.flush();await form(tree).props.onSubmit(event);tree=await h.flush();
 assert(!nodes(tree).some(n=>n.type==='button'&&text(n)==='Start a new demo'),'Address correction retains its original control');
 button(tree,'Update address').props.onClick();tree=await h.flush();form(tree).props.onSubmit(event);tree=await h.flush();
 assert.equal(consent(tree).props.checked,false,'Correcting a saved address also requires fresh contact confirmation');
 const ids=h.posts().slice(1).map(p=>p.requestId);assert.equal(new Set(ids).size,ids.length,'Every explicit new submission has its own key');
 h.close();
 console.log('PASS actual demo client: double-click lock, uncertain retry identity, terminal new-run control, fresh consent, identical details and no implicit work/reset.');
}finally{Object.assign(globalThis,savedGlobals);}
