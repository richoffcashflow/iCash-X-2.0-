import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
import * as policy from '../lib/webinar-policy.ts';import * as prompts from '../lib/webinar-prompts.ts';import * as playback from '../lib/webinar-playback.ts';
import {availableOffers,selectOffer} from '../packages/webinar-engine/src/index.ts';
async function harness(file,extra){const cells=[],effects=[],pending=[];let index=0;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const deps={useState(initial){const n=index++;if(!(n in cells))cells[n]=typeof initial==='function'?initial():initial;return [cells[n],value=>cells[n]=typeof value==='function'?value(cells[n]):value];},useRef(initial){const n=index++;return cells[n]??=( {current:initial});},useCallback(fn){index++;return fn;},useEffect(fn,list){const n=index++;if(!same(effects[n]?.list,list))pending.push(()=>{effects[n]?.cleanup?.();effects[n]={list,cleanup:fn()};});},_Fragment:'fragment',_jsx:(type,props)=>({type,props}),_jsxs:(type,props)=>({type,props}),Check:'check',ArrowRight:'arrow',ShieldCheck:'shield',...extra};
 const key='component'+Math.random().toString(36).slice(2);globalThis[key]=deps;const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .*;\s*$/gm,'');const module=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.'+key+';\n'+code).toString('base64'));return {render(name,props){index=0;const node=module[name](props);while(pending.length)pending.shift()();return node;},close(){effects.forEach(e=>e?.cleanup?.());}};}
const all=(node)=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(all)];
const find=(tree,type)=>all(tree).find(n=>n.type===type);const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};

const listeners=new Map(),store=new Map();
globalThis.window={addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
globalThis.document={hidden:false,addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
globalThis.location={search:'',pathname:'/live/129339',assign:()=>{},replace:()=>{}};
globalThis.localStorage=globalThis.sessionStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
const components=Object.fromEntries(['WebinarPlayer','WebinarPanelBoundary','WebinarAudience','WebinarPurchaseNotifications','WebinarCheckout','AccountAccess','WebinarTimers'].map(n=>[n,n]));
const icons=Object.fromEntries(['MessageCircle','Send','X','ChevronDown','ShieldCheck','Maximize','Pause','Play','Volume2','VolumeX'].map(n=>[n,n]));
const w={...policy.newWebinar('00000000-0000-4000-8000-000000000123'),videoUrl:'https://example.test/day.mp4',status:'published',publicCode:'129339'};
const sessionId='00000000-0000-4000-8000-000000000456';let requestLog=[],remembered='';
async function post(url,body){requestLog.push({url,body});if(url.endsWith('/start'))return {sessionId,webinar:policy.publicWebinar(w),progress:0,name:remembered,contactSaved:false,messages:[],preview:false,serverNow:Date.now()};if(url.endsWith('/contact')){remembered=body.name;return {name:remembered,contactSaved:!!body.email&&!!body.phone};}if(url.endsWith('/chat'))return {messages:[{id:'m1',role:'user',text:body.text}]};return {saved:true};}
const h=await harness('components/webinar-room.tsx',{useWebinarTimers:()=>({deadlines:{},now:Date.now()}),...icons,...components,...policy,...prompts,...playback,availableOffers,selectOffer,post,webinarBeacon:()=>{},webinarBrowserReady:()=>{},webinarBrowserEvent:()=>{},webinarSite:{hostName:'Kesean',brandName:'iCash X',assistantName:'Assistant',checkoutPath:'/join',workspacePath:'/'}});
const render=()=>h.render('WebinarRoom',{webinarCode:'129339'});let tree=render();await flush();tree=render();
assert.equal(requestLog[0].body.code,'129339');assert.equal(all(tree).some(n=>n.props?.className==='wb-offer'),false,'No offer before its cue');assert.equal(all(tree).some(n=>n.type==='header'),false);
let player=find(tree,'WebinarPlayer');player.props.onProgress(30);tree=render();
let prompt=all(tree).find(n=>n.type==='form'&&n.props.className==='wb-prompt');assert.ok(prompt);
let fields=all(prompt).filter(n=>n.type==='input');assert.equal(fields.length,1);assert.equal(fields[0].props.autoComplete,'given-name');fields[0].props.onChange({target:{value:'Casey'}});
tree=render();prompt=all(tree).find(n=>n.type==='form'&&n.props.className==='wb-prompt');prompt.props.onSubmit({preventDefault(){}});await flush();tree=render();
assert.equal(all(tree).some(n=>n.props?.className==='wb-prompt'),false,'Contact does not stack immediately on the name prompt');
player=find(tree,'WebinarPlayer');player.props.onProgress(60);tree=render();prompt=all(tree).find(n=>n.type==='form'&&n.props.className==='wb-prompt');fields=all(prompt).filter(n=>n.type==='input');assert.deepEqual(fields.map(n=>n.props.type),['email','tel','checkbox']);assert.ok(!fields.some(n=>n.props.autoComplete==='given-name'));
assert.equal(requestLog.filter(r=>r.url.endsWith('/contact')).length,1);assert.equal(requestLog.find(r=>r.url.endsWith('/contact')).body.onlyName,true);
h.close();
// Real player handlers: failed autoplay is recoverable, and reloading restores
// the newest position rather than the position at initial entry.
let rejectPlay=true,loads=0,ticks=[];const ph=await harness('components/webinar-player.tsx',{...icons,...playback});
const vp={sessionId,videoUrl:w.videoUrl,posterUrl:'',title:'Test recording',progress:40,preview:false,onProgress:n=>ticks.push(n),onStarted:()=>{},onCheckpoint:()=>{},onPlayingChange:()=>{},onEnded:()=>{}};
const media={currentTime:0,duration:1800,paused:true,muted:true,ended:false,error:null,async play(){if(rejectPlay)throw Error('autoplay denied');this.paused=false;},pause(){this.paused=true;},load(){loads++;this.currentTime=0;}};
let pt=ph.render('WebinarPlayer',vp),video=find(pt,'video');video.props.ref.current=media;video.props.onLoadedMetadata();await flush();pt=ph.render('WebinarPlayer',vp);assert.equal(media.currentTime,40);assert.ok(all(pt).some(n=>n.props?.className==='wb-unmute'));
rejectPlay=false;await all(pt).find(n=>n.props?.className==='wb-unmute').props.onClick();await flush();video=find(pt,'video');video.props.onPlaying();media.currentTime=235;video.props.onTimeUpdate();assert.equal(ticks.at(-1),235);
video.props.onError();pt=ph.render('WebinarPlayer',vp);all(pt).find(n=>n.type==='button'&&n.props.children==='Resume video').props.onClick();assert.equal(loads,1);find(pt,'video').props.onLoadedMetadata();await flush();assert.equal(media.currentTime,235);
document.hidden=true;listeners.get('visibilitychange')();assert.equal(media.paused,true);document.hidden=false;listeners.get('visibilitychange')();await flush();assert.equal(media.paused,false);
ph.close();console.log('PASS webinar component flows: name-only first, phone/email together later, permanent link request, hidden offers, no header, denied autoplay recovery, latest-position restore and pause/resume visibility.');
