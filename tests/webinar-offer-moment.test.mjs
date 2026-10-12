import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {formatWatchTime} from '../lib/webinar-policy.ts';
import {timerDisplay} from '../lib/webinar-timers.ts';
async function harness(file,extra){const cells=[],effects=[],pending=[];let index=0;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const deps={useState(initial){const n=index++;if(!(n in cells))cells[n]=typeof initial==='function'?initial():initial;return [cells[n],value=>cells[n]=typeof value==='function'?value(cells[n]):value];},useRef(initial){const n=index++;return cells[n]??=( {current:initial});},useCallback(fn,list){const n=index++;if(!same(cells[n]?.list,list))cells[n]={list,fn};return cells[n].fn;},useEffect(fn,list){const n=index++;if(!same(effects[n]?.list,list))pending.push(()=>{effects[n]?.cleanup?.();effects[n]={list,cleanup:fn()};});},_Fragment:'fragment',_jsx:(type,props)=>({type,props}),_jsxs:(type,props)=>({type,props}),Check:'check',ArrowRight:'arrow',ShieldCheck:'shield',...extra};
 const key='component'+Math.random().toString(36).slice(2);globalThis[key]=deps;const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .*;\s*$/gm,'');const module=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.'+key+';\n'+code).toString('base64'));return {render(name,props){index=0;const node=module[name](props);while(pending.length)pending.shift()();return node;},close(){effects.forEach(e=>e?.cleanup?.());}};}
const all=(node)=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(all)];
const find=(tree,type)=>all(tree).find(n=>n.type===type);const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};


const listeners = new Map(), intervals = new Map(); let ticks = 0, closed = 0;
globalThis.document = {hidden: false};
class Audio {
 state = 'running'; currentTime = 0; destination = {};
 resume() {return Promise.resolve();} close() {closed++; return Promise.resolve();}
 createOscillator() {return {frequency: {setValueAtTime(){}}, connect(){}, disconnect(){}, start(){ticks++;}, stop(){this.onended?.();}};}
 createGain() {return {gain: {setValueAtTime(){}, exponentialRampToValueAtTime(){}}, connect(){}, disconnect(){}};}
}
globalThis.AudioContext = Audio;
globalThis.window = {AudioContext: Audio, addEventListener: (n,f)=>listeners.set(n,f), removeEventListener: n=>listeners.delete(n), setInterval: (f,ms)=>{intervals.set(ms,f);return ms;}, clearInterval: id=>intervals.delete(id)};
const h = await harness('components/webinar-offer-moment.tsx', {Clock:'clock', Volume2:'volume', VolumeX:'muted',formatWatchTime,timerDisplay});
const now = Date.parse('2026-10-12T12:00:00Z');
const base = {now,timerNow:now,seconds:0,timers:[],deadlines:{},checkoutEngaged:false,onOpen(){}};
const offer = {id:'one',title:'Start your workspace',ctaLabel:'Get access',expiresAt:new Date(now+600000).toISOString()};
const render = patch => h.render('WebinarOfferMoment',{...base,offer,...patch});
assert.equal(render({offer:null}),null);
let tree = render(); assert.ok(!tree.props.className.includes('wb-last-chance'));
listeners.get('pointerdown')(); await flush();
tree = render({now:now+540000}); assert.ok(tree.props.className.includes('wb-last-chance'));
assert.equal(intervals.size,1); intervals.get(1000)(); assert.equal(ticks,1);
document.hidden=true; intervals.get(1000)(); assert.equal(ticks,1); document.hidden=false;
tree=render({now:now+590000}); assert.ok(intervals.has(500)); assert.ok(!intervals.has(1000));
all(tree).find(n=>n.type==='button' && n.props['aria-pressed']===true).props.onClick();
render({now:now+590000}); assert.equal(intervals.size,0);
assert.equal(render({now:now+600000}),null);
assert.equal(render({checkoutEngaged:true}),null);
tree=render({offer:{...offer,expiresAt:null}});assert.ok(!tree.props.className.includes('wb-last-chance'));assert.ok(!all(tree).some(n=>n.props?.role==='timer'));
h.close();assert.equal(closed,1);assert.equal(listeners.size,0);
console.log('Offer reveal, real expiration, last chance, ticking cadence, mute, background silence, checkout and audio cleanup passed.');
