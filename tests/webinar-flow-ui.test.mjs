import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
import * as policy from '../lib/webinar-policy.ts';import * as prompts from '../lib/webinar-prompts.ts';import * as playback from '../lib/webinar-playback.ts';
import * as purchaseFlow from '../lib/webinar-purchase-flow.ts';
import {availableOffers,selectOffer} from '../packages/webinar-engine/src/index.ts';
async function harness(file,extra){const cells=[],effects=[],pending=[];let index=0;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const deps={useState(initial){const n=index++;if(!(n in cells))cells[n]=typeof initial==='function'?initial():initial;return [cells[n],value=>cells[n]=typeof value==='function'?value(cells[n]):value];},useRef(initial){const n=index++;return cells[n]??=( {current:initial});},useCallback(fn,list){const n=index++;if(!same(cells[n]?.list,list))cells[n]={list,fn};return cells[n].fn;},useEffect(fn,list){const n=index++;if(!same(effects[n]?.list,list))pending.push(()=>{effects[n]?.cleanup?.();effects[n]={list,cleanup:fn()};});},_Fragment:'fragment',_jsx:(type,props)=>({type,props}),_jsxs:(type,props)=>({type,props}),Check:'check',ArrowRight:'arrow',ShieldCheck:'shield',...extra};
 const key='component'+Math.random().toString(36).slice(2);globalThis[key]=deps;const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .*;\s*$/gm,'');const module=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.'+key+';\n'+code).toString('base64'));return {render(name,props){index=0;const node=module[name](props);while(pending.length)pending.shift()();return node;},close(){effects.forEach(e=>e?.cleanup?.());}};}
const all=(node)=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(all)];
const find=(tree,type)=>all(tree).find(n=>n.type===type);const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};

const listeners=new Map(),store=new Map();
globalThis.window={addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
globalThis.document={hidden:false,addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
globalThis.location={search:'?ad_id=55555&fbclid=retained&r=signed-token',hash:'#room',pathname:'/live/129339',assign:()=>{},replace:()=>{}};
const replaced=[];globalThis.history={replaceState:(_state,_title,url)=>replaced.push(url)};
globalThis.localStorage=globalThis.sessionStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
const components=Object.fromEntries(['WebinarPlayer','WebinarPanelBoundary','WebinarAudience','WebinarPurchaseNotifications','WebinarTimers'].map(n=>[n,n]));
const icons=Object.fromEntries(['MessageCircle','Send','X','ChevronDown','ShieldCheck','Maximize','Pause','Play','Volume2','VolumeX'].map(n=>[n,n]));
const w={...policy.newWebinar('00000000-0000-4000-8000-000000000123'),videoUrl:'https://example.test/day.mp4',status:'published',publicCode:'129340'};
const sessionId='00000000-0000-4000-8000-000000000456';let requestLog=[],remembered='',rememberedEmail='',completionGate=null,chatGate=null,failChat=false;const redirects=[];location.assign=path=>redirects.push(path);
async function post(url,body){requestLog.push({url,body});if(url.endsWith('/start'))return {canonicalPath:'/live/129340',sessionId,webinar:policy.publicWebinar(w),progress:0,name:remembered,email:rememberedEmail,contactSaved:false,messages:[],preview:false,serverNow:Date.now()};if(url.endsWith('/event')&&body.kind==='completed'){if(completionGate)await completionGate;return {saved:true,redirect:'/webinar/checkout'};}if(url.endsWith('/contact')){remembered=body.name;if(!body.onlyName)rememberedEmail=body.email;return {name:remembered,contactSaved:!!body.email&&!!body.phone};}if(url.endsWith('/chat')){if(chatGate)await chatGate;if(failChat)throw Error('Connection lost.');return {messages:[{id:'m'+requestLog.length,role:'user',text:body.text}]};}return {saved:true};}
const roomDeps={dynamic:loader=>loader.toString().includes('WebinarCheckout')?'WebinarCheckout':'AccountAccess',useWebinarTimers:()=>({deadlines:{},now:Date.now()}),...purchaseFlow,...icons,...components,...policy,...prompts,...playback,availableOffers,selectOffer,post,webinarBeacon:()=>{},webinarBrowserReady:()=>{},webinarBrowserEvent:()=>{},webinarSite:{hostName:'Kesean',brandName:'iCash X',assistantName:'Assistant',checkoutPath:'/join',workspacePath:'/'}};
const h=await harness('components/webinar-room.tsx',roomDeps);
const render=()=>h.render('WebinarRoom',{webinarCode:'129339'});let tree=render();await flush();tree=render();
assert.equal(requestLog[0].body.code,'129339');assert.equal(requestLog[0].body.attribution.fbclid,'retained');assert.equal(replaced[0],'/live/129340?ad_id=55555&fbclid=retained#room');assert.equal(all(tree).some(n=>n.props?.className==='wb-offer'),false,'No offer before its cue');assert.equal(all(tree).some(n=>n.type==='header'),false);
let player=find(tree,'WebinarPlayer');player.props.onProgress(30);tree=render();
let prompt=all(tree).find(n=>n.type==='form'&&n.props.className?.startsWith('wb-prompt '));assert.ok(prompt);
let fields=all(prompt).filter(n=>n.type==='input');assert.equal(fields.length,1);assert.equal(fields[0].props.autoComplete,'given-name');fields[0].props.onChange({target:{value:'Casey'}});
tree=render();prompt=all(tree).find(n=>n.type==='form'&&n.props.className?.startsWith('wb-prompt '));prompt.props.onSubmit({preventDefault(){}});await flush();tree=render();
assert.equal(all(tree).some(n=>n.props?.className?.startsWith('wb-prompt ')),false,'Contact does not stack immediately on the name prompt');
player=find(tree,'WebinarPlayer');player.props.onProgress(60);tree=render();prompt=all(tree).find(n=>n.type==='form'&&n.props.className?.startsWith('wb-prompt '));
fields=all(prompt).filter(n=>n.type==='input');assert.deepEqual(fields.map(n=>n.props.type),['email','tel']);assert.ok(!fields.some(n=>n.props.autoComplete==='given-name'));
fields[0].props.onChange({target:{value:'casey@example.invalid'}});tree=render();prompt=all(tree).find(n=>n.type==='form'&&n.props.className?.startsWith('wb-prompt '));
assert.equal(all(prompt).filter(n=>n.type==='input'&&n.props.type==='checkbox').length,1,'Only the entered channel asks for optional consent');
assert.equal(all(prompt).find(n=>n.props?.type==='checkbox').props.checked,false,'Follow-up consent is never selected automatically');
assert.equal(requestLog.filter(r=>r.url.endsWith('/contact')).length,1);assert.equal(requestLog.find(r=>r.url.endsWith('/contact')).body.onlyName,true);
// Saving just an email is enough: a deliberately optional phone is not requested again.
prompt.props.onSubmit({preventDefault(){}});await flush();tree=render();assert.equal(requestLog.filter(r=>r.url.endsWith('/contact')).at(-1).body.smsConsent,false);assert.equal(requestLog.filter(r=>r.url.endsWith('/contact')).at(-1).body.consent,false);
find(tree,'WebinarPlayer').props.onProgress(500);tree=render();assert.equal(all(tree).some(n=>n.props?.className?.startsWith('wb-prompt ')),false);
// An outgoing question appears immediately, duplicate submits are blocked, and
// the eventual reply cannot delete a second draft or scroll away from old notes.
const input=()=>all(tree).find(n=>n.props?.id==='wb-question');
input().props.onChange({target:{value:'How does setup work?'}});tree=render();let reply;chatGate=new Promise(resolve=>{reply=resolve;});
const sendForm=all(tree).find(n=>n.props?.className==='wb-chat-input');const pending=sendForm.props.onSubmit({preventDefault(){}});void sendForm.props.onSubmit({preventDefault(){}});tree=render();
assert.equal(requestLog.filter(r=>r.url.endsWith('/chat')).length,1);assert.equal(input().props.value,'');assert.ok(all(tree).some(n=>n.props?.['aria-label']==='Sending your message'));
input().props.onChange({target:{value:'What happens next?'}});tree=render();
let log=all(tree).find(n=>n.props?.className==='wb-chat-log'),scroll={scrollHeight:1200,scrollTop:100,clientHeight:200};log.props.ref.current=scroll;log.props.onScroll({currentTarget:scroll});
reply();await pending;tree=render();tree=render();assert.equal(input().props.value,'What happens next?');assert.equal(scroll.scrollTop,100,'Incoming reply does not move a reader');
all(tree).find(n=>n.props?.className==='wb-new-messages').props.onClick();assert.equal(scroll.scrollTop,1200,'New messages button scrolls only the chat container');
// A timed offer remains available without closing chat while a draft is present.
find(tree,'WebinarPlayer').props.onProgress(w.durationSeconds-1);tree=render();tree=render();assert.equal(all(tree).find(n=>n.props?.className==='wb-chat-heading').props['aria-expanded'],true);
const panel=all(tree).find(n=>n.props?.id==='webinar-offer');assert.equal(panel.props.hidden,true);let focused=0,scrolled=0;panel.props.ref.current={focus:()=>focused++,scrollIntoView:()=>scrolled++};
all(tree).find(n=>n.props?.['aria-controls']==='webinar-offer').props.onClick();tree=render();tree=render();assert.equal(all(tree).find(n=>n.props?.id==='webinar-offer').props.hidden,false);assert.equal(focused,1);assert.equal(scrolled,1);
// Minimize/reopen preserves both the draft and the same mounted checkout.
all(tree).find(n=>n.props?.['aria-label']==='Minimize offer').props.onClick();tree=render();assert.equal(input().props.value,'What happens next?');
input().props.onChange({target:{value:''}});tree=render();tree=render();
// Failed sends retain the unsent message and do not overwrite a newer draft.
chatGate=null;failChat=true;input().props.onChange({target:{value:'Can I continue later?'}});tree=render();await all(tree).find(n=>n.props?.className==='wb-chat-input').props.onSubmit({preventDefault(){}});tree=render();assert.equal(input().props.value,'Can I continue later?');assert.ok(all(tree).some(n=>n.props?.role==='alert'));failChat=false;
// A successful completion opens express checkout, but a checkout started during
// the completion request is never interrupted by its late response.
find(tree,'WebinarPlayer').props.onProgress(w.durationSeconds);tree=render();find(tree,'WebinarPlayer').props.onEnded();await flush();assert.deepEqual(redirects,['/webinar/checkout']);
let finish;completionGate=new Promise(resolve=>{finish=resolve;});tree=render();find(tree,'WebinarPlayer').props.onEnded();find(tree,'WebinarCheckout').props.onEngaged();finish();await flush();assert.deepEqual(redirects,['/webinar/checkout'],'Late completion cannot replace an engaged checkout');
// A Standard buyer gets the final upsell, even with an already-engaged base checkout.
tree=render();find(tree,'WebinarCheckout').props.onPurchased('standard');assert.equal(redirects.at(-1),'/webinar/upgrade');
h.close();
store.delete('icash-webinar-prompts:'+sessionId);
const returningRoom=await harness('components/webinar-room.tsx',roomDeps);returningRoom.render('WebinarRoom',{webinarCode:'129339'});await flush();let returningTree=returningRoom.render('WebinarRoom',{webinarCode:'129339'});find(returningTree,'WebinarPlayer').props.onProgress(65);returningTree=returningRoom.render('WebinarRoom',{webinarCode:'129339'});assert.equal(all(returningTree).some(n=>n.props?.className?.startsWith('wb-prompt ')),false,'A remembered email avoids another contact request in a fresh session');returningRoom.close();
// Real player handlers: failed autoplay is recoverable, and reloading restores
// the newest position rather than the position at initial entry.
let rejectPlay=true,loads=0,ticks=[];const ph=await harness('components/webinar-player.tsx',{...icons,...playback});
const vp={sessionId,videoUrl:w.videoUrl,posterUrl:'',title:'Test recording',progress:40,preview:false,onProgress:n=>ticks.push(n),onStarted:()=>{},onCheckpoint:()=>{},onPlayingChange:()=>{},onEnded:()=>{}};
const media={currentTime:0,duration:1800,paused:true,muted:true,ended:false,error:null,async play(){if(rejectPlay)throw Error('autoplay denied');this.paused=false;},pause(){this.paused=true;},load(){loads++;this.currentTime=0;}};
let pt=ph.render('WebinarPlayer',vp),video=find(pt,'video');video.props.ref.current=media;video.props.onLoadedMetadata();await flush();pt=ph.render('WebinarPlayer',vp);assert.equal(media.currentTime,40);assert.ok(all(pt).some(n=>n.props?.className==='wb-unmute'));
rejectPlay=false;await all(pt).find(n=>n.props?.className==='wb-unmute').props.onClick();await flush();video=find(pt,'video');video.props.onPlaying();media.currentTime=235;video.props.onTimeUpdate();assert.equal(ticks.at(-1),235);
video.props.onError();pt=ph.render('WebinarPlayer',vp);all(pt).find(n=>n.type==='button'&&n.props.children==='Resume video').props.onClick();assert.equal(loads,1);find(pt,'video').props.onLoadedMetadata();await flush();assert.equal(media.currentTime,235);
document.hidden=true;listeners.get('visibilitychange')();assert.equal(media.paused,true);document.hidden=false;listeners.get('visibilitychange')();await flush();assert.equal(media.paused,false);
ph.close();console.log('PASS webinar flows: compact optional contact, remembered details, immediate chat echo, draft and scroll preservation, deferred timed offers, direct checkout focus, payment continuity, and player recovery.');
