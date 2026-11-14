import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {loadCheckoutStripe} from '../lib/stripe-checkout-client.ts';

const original=Object.fromEntries(['window','document','setTimeout','clearTimeout'].map(k=>[k,globalThis[k]]));
const timers=new Map();let sequence=0,scripts=[];
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
class Script extends EventTarget{src='';removed=false;remove(){this.removed=true;scripts=scripts.filter(s=>s!==this);}}
Object.assign(globalThis,{window:{},document:{querySelector:()=>scripts[0]??null,createElement:()=>new Script(),head:{appendChild:script=>scripts.push(script)}},setTimeout:(fn,ms)=>{timers.set(++sequence,{fn,ms});return sequence;},clearTimeout:id=>timers.delete(id)});
const fire=()=>{const entries=[...timers.entries()];timers.clear();for(const [,{fn}] of entries)fn();};
try{
 const first=loadCheckoutStripe(),same=loadCheckoutStripe();assert.equal(first,same);assert.equal(scripts.length,1,'Concurrent checkouts share one script download');
 const failed=assert.rejects(first,/secure payment connection/);scripts[0].dispatchEvent(new Event('error'));await failed;await flush();assert.equal(scripts.length,0);assert.equal(timers.size,0);
 const retry=loadCheckoutStripe();assert.equal(scripts.length,1,'A failed download can be retried without reloading the webinar');
 const factory=()=>({});window.Stripe=factory;scripts[0].dispatchEvent(new Event('load'));assert.equal(await retry,factory);assert.equal(await loadCheckoutStripe(),factory);assert.equal(timers.size,0);
 delete window.Stripe;const prior=scripts[0];const slow=loadCheckoutStripe();const timedOut=assert.rejects(slow,/secure payment connection/);fire();await timedOut;await flush();assert.equal(prior.removed,true,'A stalled preloader can be replaced on explicit retry');assert.equal(scripts.length,0);

 const source=ts.transpileModule(readFileSync(new URL('../components/stripe-embedded-checkout.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .*;\s*$/gm,'');
 async function fixture(loader){
  const cells=[],effects=[],pending=[];let cursor=0;
  const deps={loadCheckoutStripe:loader,useState(initial){const index=cursor++;if(!(index in cells))cells[index]=initial;return [cells[index],value=>cells[index]=typeof value==='function'?value(cells[index]):value];},useRef(initial){const index=cursor++;return cells[index]??={current:initial};},useEffect(fn,list){const index=cursor++,old=effects[index];if(!old||list.some((v,i)=>!Object.is(v,old.list[i])))pending.push(()=>{old?.cleanup?.();effects[index]={list,cleanup:fn()};});},_jsx:(type,props)=>({type,props}),_jsxs:(type,props)=>({type,props})};
  const key='checkoutRecovery'+Math.random().toString(36).slice(2);globalThis[key]=deps;
  const mod=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.'+key+';\n'+source).toString('base64'));delete globalThis[key];
  const host={};const stats={ready:0,complete:0};
  return {stats,render(){cursor=0;const tree=mod.StripeEmbeddedCheckout({clientSecret:'original-session-secret',publishableKey:'pk_test_fixture',onReady:()=>stats.ready++,onComplete:()=>stats.complete++});cells[0].current=host;while(pending.length)pending.shift()();return tree;},close(){effects.forEach(e=>e?.cleanup?.());}};
 }
 const all=node=>node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).flatMap(all)]:[];
 const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(' '):node?.props?text(node.props.children):'';
 let resolveFirst,calls=[],destroyed=0,mounts=0;
 const h=await fixture(async()=>key=>({createEmbeddedCheckoutPage:options=>{calls.push({key,...options});return calls.length===1?new Promise(resolve=>resolveFirst=resolve):Promise.resolve({mount(){mounts++;},destroy(){destroyed++;}});}}));
 h.render();await flush();assert.match(text(h.render()),/Loading secure payment/);fire();let tree=h.render();assert.match(text(tree),/payment form could not load/);assert.equal(h.stats.ready,0);
 const reload=all(tree).find(n=>n.type==='button');assert(reload,'Initialization timeout provides recovery');reload.props.onClick();h.render();await flush();tree=h.render();assert.equal(mounts,1);assert.equal(h.stats.ready,1);assert.equal(calls[0].clientSecret,calls[1].clientSecret,'Retry keeps the original payment session');assert.equal(h.stats.complete,0,'Reloading never confirms a purchase');
 resolveFirst({mount(){assert.fail('Timed-out initialization must never mount over the retry');},destroy(){destroyed++;}});await flush();assert.equal(destroyed,1);calls[0].onComplete();assert.equal(h.stats.complete,0,'Late expired callback cannot complete the active checkout');calls[1].onComplete();assert.equal(h.stats.complete,1);h.close();assert.equal(destroyed,2);assert.equal(timers.size,0);
 const rejected=await fixture(async()=>{throw Error('The secure payment connection could not load. Check your connection and reload.');});rejected.render();await flush();tree=rejected.render();assert(all(tree).find(n=>n.type==='button'),'A failed script has a reload control before Stripe becomes ready');rejected.close();
 let late;const unmounted=await fixture(async()=>()=>({createEmbeddedCheckoutPage:()=>new Promise(resolve=>late=resolve)}));unmounted.render();await flush();unmounted.close();late({mount(){assert.fail('Unmounted checkout mounted');},destroy(){destroyed++;}});await flush();assert.equal(destroyed,3);assert.equal(timers.size,0);
 console.log('PASS checkout loading recovery: shared/preloaded script, failure and timeout retry, visible initialization, same-session recovery, late resolution isolation, completion and cleanup.');
}finally{for(const [key,value] of Object.entries(original))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
