import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
import * as policy from '../lib/webinar-policy.ts';import * as prompts from '../lib/webinar-prompts.ts';import * as playback from '../lib/webinar-playback.ts';
import {webinarChatStream} from '../lib/webinar-chat-stream.ts';
import * as purchaseFlow from '../lib/webinar-purchase-flow.ts';
import {withOfferDeadlines} from '../packages/webinar-engine/src/offer-deadlines.ts';
import {replayOfferSpots} from '../packages/webinar-engine/src/replay-offer-spots.ts';
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
const components=Object.fromEntries(['WebinarPlayer','WebinarPanelBoundary','WebinarAudience','WebinarPurchaseNotifications','WebinarOfferMoment','WebinarOfferImage','WebinarOfferSpots'].map(n=>[n,n]));
const icons=Object.fromEntries(['MessageCircle','Send','X','ChevronDown','ShieldCheck','Maximize','Pause','Play','Volume2','VolumeX','Info'].map(n=>[n,n]));
const w={...policy.newWebinar('00000000-0000-4000-8000-000000000123'),videoUrl:'https://example.test/day.mp4',status:'published',publicCode:'129340',chat:[{id:'before',at:499,name:'Sam',text:'Before submission',kind:'replay'},{id:'after',at:501,name:'Pat',text:'After submission',kind:'replay'}]};
const sessionId='00000000-0000-4000-8000-000000000456';let emptyChat=false;let requestLog=[],remembered='',rememberedEmail='',completionGate=null,chatGate=null,failChat=false,failContact=false;const redirects=[];location.assign=path=>redirects.push(path);
async function post(url,body){requestLog.push({url,body});if(url.endsWith('/start'))return {canonicalPath:'/live/129340',sessionId,webinar:policy.publicWebinar(w),progress:0,name:remembered,email:rememberedEmail,contactSaved:false,messages:[],preview:false,serverNow:Date.now()};if(url.endsWith('/event')&&body.kind==='completed'){if(completionGate)await completionGate;return {saved:true,redirect:'/webinar/checkout'};}if(url.endsWith('/contact')){if(failContact)throw Error('Name could not be saved.');remembered=body.name;if(!body.onlyName)rememberedEmail=body.email;return {name:remembered,contactSaved:!!body.email&&!!body.phone};}if(url.endsWith('/chat')){if(chatGate)await chatGate;if(failChat)throw Error('Connection lost.');return {messages:emptyChat?[]:[{id:'m'+requestLog.length,role:'user',text:body.text,playback_seconds:body.seconds}]};}return {saved:true};}
const roomDeps={webinarChatStream,withOfferDeadlines,replayOfferSpots,useMemo:fn=>fn(),webinarRequest:async()=>({postPurchaseUrl:'/live/123457'}),dynamic:loader=>loader.toString().includes('WebinarCheckout')?'WebinarCheckout':'AccountAccess',useWebinarTimers:()=>({deadlines:{},offerDeadlines:{},offset:0,now:Date.now()}),...purchaseFlow,...icons,...components,...policy,...prompts,...playback,availableOffers,selectOffer,post,webinarBeacon:()=>{},webinarBrowserReady:()=>{},webinarBrowserEvent:()=>{},webinarSite:{hostName:'Kesean',brandName:'iCash X',assistantName:'Assistant',checkoutPath:'/join',workspacePath:'/'}};
const h=await harness('components/webinar-room.tsx',roomDeps);
const render=()=>h.render('WebinarRoom',{webinarCode:'129339'});let tree=render();await flush();tree=render();
assert.equal(requestLog[0].body.code,'129339');assert.equal(requestLog[0].body.attribution.fbclid,'retained');assert.equal(replaced[0],'/live/129340?ad_id=55555&fbclid=retained#room');assert.equal(all(tree).some(n=>n.props?.className==='wb-offer'),false,'No offer before its cue');assert.equal(all(tree).some(n=>n.type==='header'),false);
assert.equal(all(tree).some(n=>n.props?.id==='wb-question'),false,'A new viewer must save a name before chatting');
assert.equal(all(tree).some(n=>n.props?.['aria-label']==='Dismiss contact request'),false,'Required name entry cannot be dismissed');
assert.equal(all(tree).some(n=>n.type==='footer'),false);
let player=find(tree,'WebinarPlayer');player.props.onProgress(30);tree=render();
let prompt=all(tree).find(n=>n.type==='form'&&n.props.className?.startsWith('wb-prompt '));assert.ok(prompt);
let fields=all(prompt).filter(n=>n.type==='input');assert.equal(fields.length,1);assert.equal(fields[0].props.autoComplete,'given-name');fields[0].props.onChange({target:{value:'Casey'}});
tree=render();prompt=all(tree).find(n=>n.type==='form'&&n.props.className?.startsWith('wb-prompt '));
failContact=true;prompt.props.onSubmit({preventDefault(){}});await flush();tree=render();assert.equal(all(tree).some(n=>n.props?.id==='wb-question'),false,'A failed name save keeps the composer locked');assert.ok(all(tree).some(n=>n.props?.role==='alert'));
failContact=false;prompt=all(tree).find(n=>n.type==='form'&&n.props.className?.startsWith('wb-prompt '));prompt.props.onSubmit({preventDefault(){}});await flush();tree=render();assert.ok(all(tree).some(n=>n.props?.id==='wb-question'),'Saving the name opens chat');
assert.equal(all(tree).some(n=>n.props?.className?.startsWith('wb-prompt ')),false,'Contact does not stack immediately on the name prompt');
player=find(tree,'WebinarPlayer');player.props.onProgress(60);tree=render();prompt=all(tree).find(n=>n.type==='form'&&n.props.className?.startsWith('wb-prompt '));
fields=all(prompt).filter(n=>n.type==='input');assert.deepEqual(fields.map(n=>n.props.type),['email','tel']);assert.ok(!fields.some(n=>n.props.autoComplete==='given-name'));
fields[0].props.onChange({target:{value:'casey@example.invalid'}});tree=render();prompt=all(tree).find(n=>n.type==='form'&&n.props.className?.startsWith('wb-prompt '));
assert.equal(all(prompt).filter(n=>n.type==='input'&&n.props.type==='checkbox').length,1,'Only the entered channel asks for optional consent');
assert.equal(all(prompt).find(n=>n.props?.type==='checkbox').props.checked,false,'Follow-up consent is never selected automatically');
assert.equal(requestLog.filter(r=>r.url.endsWith('/contact')).length,2);assert.equal(requestLog.find(r=>r.url.endsWith('/contact')).body.onlyName,true);
// Saving just an email is enough: a deliberately optional phone is not requested again.
prompt.props.onSubmit({preventDefault(){}});await flush();tree=render();assert.equal(requestLog.filter(r=>r.url.endsWith('/contact')).at(-1).body.smsConsent,false);assert.equal(requestLog.filter(r=>r.url.endsWith('/contact')).at(-1).body.consent,false);
find(tree,'WebinarPlayer').props.onProgress(500);tree=render();assert.equal(all(tree).some(n=>n.props?.className?.startsWith('wb-prompt ')),false);
// An outgoing question appears immediately, duplicate submits are blocked, and
// the eventual reply cannot delete a second draft or scroll away from old notes.
const input=()=>all(tree).find(n=>n.props?.id==='wb-question');
input().props.onChange({target:{value:'How does setup work?'}});tree=render();let reply;chatGate=new Promise(resolve=>{reply=resolve;});
const sendForm=all(tree).find(n=>n.props?.className==='wb-chat-input');const pending=sendForm.props.onSubmit({preventDefault(){}});void sendForm.props.onSubmit({preventDefault(){}});tree=render();
assert.equal(requestLog.filter(r=>r.url.endsWith('/chat')).length,1);assert.equal(input().props.value,'');assert.ok(all(tree).some(n=>n.props?.['aria-label']==='Sending your message'));
assert.equal(requestLog.find(r=>r.url.endsWith('/chat')).body.seconds,500);
find(tree,'WebinarPlayer').props.onProgress(502);tree=render();
const streamTexts=()=>all(all(tree).find(n=>n.props?.className==='wb-chat-log')).filter(n=>n.type==='p').map(n=>n.props.children);
assert.deepEqual(streamTexts(),['Before submission','How does setup work?','After submission'],'Pending submissions join the timed discussion');
input().props.onChange({target:{value:'What happens next?'}});tree=render();
let log=all(tree).find(n=>n.props?.className==='wb-chat-log'),scroll={scrollHeight:1200,scrollTop:100,clientHeight:200};log.props.ref.current=scroll;log.props.onScroll({currentTarget:scroll});
reply();await pending;tree=render();tree=render();assert.equal(input().props.value,'What happens next?');assert.equal(scroll.scrollTop,100,'Incoming reply does not move a reader');assert.deepEqual(streamTexts(),['Before submission','How does setup work?','After submission'],'Saved submission stays in place without a duplicate');
all(tree).find(n=>n.props?.className==='wb-new-messages').props.onClick();assert.equal(scroll.scrollTop,1200,'New messages button scrolls only the chat container');
// A timed offer remains available without closing chat while a draft is present.
find(tree,'WebinarPlayer').props.onProgress(w.durationSeconds-1);tree=render();tree=render();assert.equal(all(tree).find(n=>n.props?.className==='wb-chat-heading').type,'div');assert.ok(all(tree).some(n=>n.props?.className==='wb-chat-log'),'Chat stays open when an offer appears');
const panel=all(tree).find(n=>n.props?.id==='webinar-offer');assert.equal(panel.props.hidden,true);let focused=0,scrolled=0;panel.props.ref.current={focus:()=>focused++,scrollIntoView:()=>scrolled++};
all(tree).find(n=>n.props?.['aria-controls']==='webinar-offer').props.onClick();tree=render();tree=render();assert.equal(all(tree).find(n=>n.props?.id==='webinar-offer').props.hidden,false);assert.equal(focused,1);assert.equal(scrolled,1);
assert.ok(all(tree).some(n=>n.props?.id==='wb-question'),'Opening checkout keeps chat available');
// Minimize/reopen preserves both the draft and the same mounted checkout.
all(tree).find(n=>n.props?.['aria-label']==='Minimize offer').props.onClick();tree=render();assert.equal(input().props.value,'What happens next?');
input().props.onChange({target:{value:''}});tree=render();tree=render();
// Failed sends retain the unsent message and do not overwrite a newer draft.
chatGate=null;failChat=true;input().props.onChange({target:{value:'Can I continue later?'}});tree=render();await all(tree).find(n=>n.props?.className==='wb-chat-input').props.onSubmit({preventDefault(){}});tree=render();assert.equal(input().props.value,'Can I continue later?');assert.ok(all(tree).some(n=>n.props?.role==='alert'));failChat=false;
emptyChat=true;await all(tree).find(n=>n.props?.className==='wb-chat-input').props.onSubmit({preventDefault(){}});tree=render();assert.equal(input().props.value,'Can I continue later?','Empty save response restores the draft');emptyChat=false;
// A successful completion opens express checkout, but a checkout started during
// the completion request is never interrupted by its late response.
find(tree,'WebinarPlayer').props.onProgress(w.durationSeconds);tree=render();find(tree,'WebinarPlayer').props.onEnded();await flush();assert.deepEqual(redirects,['/webinar/checkout']);
let finish;completionGate=new Promise(resolve=>{finish=resolve;});tree=render();find(tree,'WebinarPlayer').props.onEnded();find(tree,'WebinarCheckout').props.onEngaged();finish();await flush();assert.deepEqual(redirects,['/webinar/checkout'],'Late completion cannot replace an engaged checkout');
// A Standard buyer enters the paired VIP video when the main webinar ends.
tree=render();find(tree,'WebinarCheckout').props.onPurchased('standard');await flush();assert.equal(redirects.at(-1),'/live/123457');
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
ph.close();
const draftPlayer=await harness('components/webinar-player.tsx',{...icons,...playback});const draftTree=draftPlayer.render('WebinarPlayer',{...vp,videoUrl:'',preview:true});assert.equal(find(draftTree,'video'),undefined);assert.ok(all(draftTree).some(n=>n.props?.children==='Your video goes here'));assert.equal(all(draftTree).some(n=>n.props?.className==='wb-player-recovery'),false,'An empty owner draft is not a connection failure');draftPlayer.close();
// Sound-first autoplay, policy fallback, and explicit viewer choices use the real
// handlers. These fixtures never load media or contact a provider.
async function audioPlayer(play){
 const h=await harness('components/webinar-player.tsx',{...icons,...playback}),calls=[];
 const render=()=>h.render('WebinarPlayer',vp);
 const media={currentTime:0,duration:1800,paused:true,muted:find(render(),'video').props.muted,ended:false,error:null,
  play(){calls.push(this.muted);return play(this,calls.length).then(()=>{this.paused=false;find(render(),'video').props.onPlaying();});},
  pause(){this.paused=true;find(render(),'video').props.onPause();},load(){this.paused=true;this.currentTime=0;}};
 find(render(),'video').props.ref.current=media;
 return {media,calls,render,close:()=>h.close(),start(){find(render(),'video').props.onLoadedMetadata();},
  click(label){all(render()).find(n=>n.props?.['aria-label']===label).props.onClick();},
  overlay(){return all(render()).find(n=>n.props?.className==='wb-unmute');}};
}
const denied=()=>new DOMException('Autoplay requires a gesture','NotAllowedError');
{
 const p=await audioPlayer(async()=>{});p.start();await flush();
 assert.deepEqual(p.calls,[false],'Allowed autoplay starts with sound');assert.equal(p.overlay(),undefined);p.close();
}
{
 const p=await audioPlayer(async(_media,call)=>{if(call===1)throw denied();});p.start();await flush();
 assert.deepEqual(p.calls,[false,true],'Sound denial tries muted playback once');assert.equal(p.media.currentTime,40);
 assert.ok(all(p.overlay()).some(n=>n.props?.children==='Tap to listen'));
 p.overlay().props.onClick();assert.equal(p.media.muted,false,'The tap enables audio before awaiting playback');await flush();
 assert.deepEqual(p.calls,[false,true,false]);assert.equal(p.overlay(),undefined);
 assert.equal(all(p.render()).some(n=>n.props?.className==='wb-player-actions'),false,'No persistent player controls');p.close();
 // Respect mute remembered by an earlier player, while still offering one tap to listen.
 sessionStorage.setItem('icash-webinar-muted','true');
 const next=await audioPlayer(async()=>{});next.start();await flush();assert.deepEqual(next.calls,[true]);
 next.media.pause();next.overlay().props.onClick();await flush();assert.equal(next.calls.at(-1),true,'Resume respects a remembered mute');
 document.hidden=true;listeners.get('visibilitychange')();document.hidden=false;listeners.get('visibilitychange')();await flush();
 assert.equal(next.calls.at(-1),true,'Returning to the tab respects mute');
 find(next.render(),'video').props.onError();all(next.render()).find(n=>n.props?.children==='Resume video').props.onClick();
 next.start();await flush();assert.equal(next.calls.at(-1),true,'Reconnecting respects mute');
 next.overlay().props.onClick();await flush();assert.equal(next.media.muted,false);assert.equal(sessionStorage.getItem('icash-webinar-muted'),null);next.close();
}
{
 const p=await audioPlayer(async()=>{throw denied();});p.start();await flush();
 assert.deepEqual(p.calls,[false,true],'If all autoplay is blocked there is no retry loop');assert.ok(p.overlay());
 p.overlay().props.onClick();await flush();assert.deepEqual(p.calls,[false,true,false],'A tap requests sound directly without silent fallback');p.close();
}
{
 let reject;const p=await audioPlayer(async(_media,call)=>{if(call===1)await new Promise((_resolve,no)=>{reject=no;});});
 p.start();p.overlay().props.onClick();await flush();reject(denied());await flush();
 assert.deepEqual(p.calls,[false,false],'An older denied autoplay cannot mute a newer successful tap');assert.equal(p.media.muted,false);assert.equal(p.overlay(),undefined);p.close();
}
for(const name of ['AbortError','NotSupportedError']){
 const p=await audioPlayer(async()=>{throw new DOMException('Playback interrupted',name);});p.start();await flush();
 assert.deepEqual(p.calls,[false],name+' does not cause muted retries');assert.ok(p.overlay());p.close();
}
console.log('PASS webinar flows: compact optional contact, remembered details, immediate chat echo, draft and scroll preservation, deferred timed offers, direct checkout focus, payment continuity, player recovery and empty draft guidance.');
console.log('PASS webinar audio: audible autoplay, one muted policy fallback, tap to listen, persistent mute, blocked playback recovery, stale rejection protection, and no retry on media errors.');
