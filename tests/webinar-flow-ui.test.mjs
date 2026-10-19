import {webinarOfferFocus} from '../lib/webinar-offer-focus.ts';
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
import * as policy from '../lib/webinar-policy.ts';import * as prompts from '../lib/webinar-prompts.ts';import * as playback from '../lib/webinar-playback.ts';
import {webinarChatStream} from '../lib/webinar-chat-stream.ts';
import * as purchaseFlow from '../lib/webinar-purchase-flow.ts';
import * as exitReminder from '../lib/webinar-exit-reminder.ts';
import {withOfferDeadlines} from '../packages/webinar-engine/src/offer-deadlines.ts';
import {replayOfferActivity} from '../packages/webinar-engine/src/replay-offer-spots.ts';
import {recordedPurchaseMessage,activityMessage,recentActivity} from '../lib/webinar-activity.ts';
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
window.location=location;
const replaced=[];globalThis.history={replaceState:(_state,_title,url)=>replaced.push(url)};
globalThis.localStorage=globalThis.sessionStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
const components=Object.fromEntries(['WebinarVipWelcome','WebinarTimers','WebinarPlayer','WebinarPanelBoundary','WebinarAudience','WebinarPurchaseNotifications','WebinarCountdownBanner','WebinarOfferImage','WebinarOfferSpots'].map(n=>[n,n]));
const icons=Object.fromEntries(['MessageCircle','Send','X','ChevronDown','ShieldCheck','Maximize','Pause','Play','Volume2','VolumeX','Info'].map(n=>[n,n]));
const w={...policy.newWebinar('00000000-0000-4000-8000-000000000123'),videoUrl:'https://example.test/day.mp4',status:'published',publicCode:'129340',chat:[{id:'before',at:499,name:'Sam',text:'Before submission',kind:'replay'},{id:'after',at:501,name:'Pat',text:'After submission',kind:'replay'}]};
const sessionId='00000000-0000-4000-8000-000000000456';let emptyChat=false;let requestLog=[],remembered='',rememberedEmail='',completionGate=null,chatGate=null,failChat=false,failContact=false;const redirects=[];location.assign=path=>redirects.push(path);
async function post(url,body){requestLog.push({url,body});if(url.endsWith('/start'))return {canonicalPath:'/live/129340',sessionId,webinar:policy.publicWebinar(w),progress:0,name:remembered,email:rememberedEmail,contactSaved:false,messages:[],preview:false,serverNow:Date.now()};if(url.endsWith('/event')&&body.kind==='completed'){if(completionGate)await completionGate;return {saved:true,redirect:'/webinar/checkout'};}if(url.endsWith('/contact')){if(failContact)throw Error('Name could not be saved.');remembered=body.name;if(!body.onlyName)rememberedEmail=body.email;return {name:remembered,contactSaved:!!body.email&&!!body.phone};}if(url.endsWith('/chat')){if(chatGate)await chatGate;if(failChat)throw Error('Connection lost.');return {messages:emptyChat?[]:[{id:'m'+requestLog.length,role:'user',text:body.text,playback_seconds:body.seconds,public_status:'pending'}]};}return {saved:true};}
let timerInput;
const roomDeps={installWebinarRecovery:()=>({sync(){},stop(){}}),...exitReminder,webinarOfferFocus,useWebinarSharedChat:()=>({messages:[],statuses:[]}),webinarChatStream,withOfferDeadlines,replayOfferActivity,recordedPurchaseMessage,useMemo:fn=>fn(),webinarRequest:async()=>({postPurchaseUrl:'/live/123457'}),dynamic:loader=>loader.toString().includes('WebinarCheckout')?'WebinarCheckout':'AccountAccess',useWebinarTimers:input=>{timerInput=input;return {deadlines:{},offerDeadlines:{},offset:0,now:Date.now()};},...purchaseFlow,...icons,...components,...policy,...prompts,...playback,availableOffers,selectOffer,post,webinarBeacon:()=>{},webinarBrowserReady:()=>{},webinarBrowserEvent:()=>{},webinarSite:{hostName:'Kesean',brandName:'iCash X',assistantName:'Assistant',checkoutPath:'/join',workspacePath:'/'}};
const h=await harness('components/webinar-room.tsx',roomDeps);
const render=()=>h.render('WebinarRoom',{webinarCode:'129339'});let tree=render();assert.equal(listeners.has('beforeunload'),false,'Loading never installs a reminder');await flush();tree=render();
assert.equal(listeners.has('beforeunload'),true,'Regular viewers receive the one-time exit reminder');
const exitDialog=find(tree,'dialog');assert.equal(exitDialog.props['aria-describedby'],'wb-exit-benefit');
assert.ok(all(exitDialog).some(n=>n.type==='button'&&n.props.children==='Keep watching'));
assert.ok(all(exitDialog).some(n=>n.type==='button'&&n.props.children==='Leave webinar'));
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
player=find(tree,'WebinarPlayer');player.props.onProgress(60);tree=render();prompt=all(tree).find(n=>n.props?.className==='wb-chat-composer');
fields=all(prompt).filter(n=>n.type==='input');assert.deepEqual(fields.map(n=>n.props.type),['text']);
assert.equal(fields[0].props.name,'message','Chat never becomes an email or phone opt-in');
assert.equal(all(tree).some(n=>n.type==='input'&&['email','tel','checkbox'].includes(n.props.type)),false);
assert.equal(requestLog.filter(r=>r.url.endsWith('/contact')).length,2);
assert.deepEqual(requestLog.filter(r=>r.url.endsWith('/contact')).at(-1).body,{sessionId,name:'Casey',onlyName:true});
find(tree,'WebinarPlayer').props.onProgress(500);tree=render();
// An outgoing question appears immediately, duplicate submits are blocked, and
// the eventual reply cannot delete a second draft or scroll away from old notes.
const input=()=>all(tree).find(n=>n.props?.id==='wb-question');
input().props.onChange({target:{value:'How does setup work?'}});tree=render();let reply;chatGate=new Promise(resolve=>{reply=resolve;});
const sendForm=all(tree).find(n=>n.props?.className==='wb-chat-composer');const pending=sendForm.props.onSubmit({preventDefault(){}});void sendForm.props.onSubmit({preventDefault(){}});tree=render();
assert.equal(requestLog.filter(r=>r.url.endsWith('/chat')).length,1);assert.equal(input().props.value,'');assert.ok(all(tree).some(n=>n.props?.['aria-label']==='Sending your message'));
assert.equal(requestLog.find(r=>r.url.endsWith('/chat')).body.seconds,500);
find(tree,'WebinarPlayer').props.onProgress(502);tree=render();
const streamTexts=()=>all(all(tree).find(n=>n.props?.className==='wb-chat-log')).filter(n=>n.type==='p').map(n=>n.props.children);
assert.deepEqual(streamTexts(),['Before submission','How does setup work?','After submission'],'Pending submissions join the timed discussion');
input().props.onChange({target:{value:'What happens next?'}});tree=render();
let log=all(tree).find(n=>n.props?.className==='wb-chat-log'),scroll={scrollHeight:1200,scrollTop:100,clientHeight:200};log.props.ref.current=scroll;log.props.onScroll({currentTarget:scroll});
reply();await pending;tree=render();tree=render();assert.equal(input().props.value,'What happens next?');assert.equal(scroll.scrollTop,100,'Incoming reply does not move a reader');assert.deepEqual(streamTexts(),['Before submission','How does setup work?','After submission'],'Saved submission stays in place without a duplicate');
assert.equal(all(tree).some(n=>['Awaiting review','Only visible to you','Messages are reviewed before being shared.'].includes(n.props?.children)),false,'Saved viewer messages have no review labels');
assert.ok(all(tree).filter(n=>n.type==='article').every(n=>n.props.className==='wb-message'),'All chat messages use the same bubble');
all(tree).find(n=>n.props?.className==='wb-new-messages').props.onClick();assert.equal(scroll.scrollTop,1200,'New messages button scrolls only the chat container');
// Offers open automatically, even with a draft. Chat waits until the countdown ends.
find(tree,'WebinarPlayer').props.onProgress(w.durationSeconds-1);tree=render();tree=render();
const chatSection=()=>all(tree).find(n=>n.props?.['aria-labelledby']==='wb-chat-title');
assert.equal(all(tree).find(n=>n.props?.id==='webinar-offer').props.hidden,false,'Checkout is open at the cue');
assert.equal(chatSection().props.hidden,true,'Chat is hidden during the offer');
assert.equal(all(tree).some(n=>n.type==='button'&&n.props.children==='Show chat'),false,'Public viewers never receive the owner preview override');
assert.equal(input().props.value,'What happens next?','Offer retains the chat draft');
assert.equal(all(tree).some(n=>n.props?.['aria-label']==='Minimize offer'),false);
assert.equal(all(tree).some(n=>n.props?.className==='wb-bottom'),false,'No extra Sign Up footer');
const beforeLockedSend=requestLog.filter(r=>r.url.endsWith('/chat')).length;
await all(tree).find(n=>n.props?.className==='wb-chat-composer').props.onSubmit({preventDefault(){}});
assert.equal(requestLog.filter(r=>r.url.endsWith('/chat')).length,beforeLockedSend,'Hidden chat cannot submit during countdown');
find(tree,'WebinarPlayer').props.onProgress(w.durationSeconds);tree=render();
assert.equal(chatSection().props.hidden,false,'Chat returns after countdown');
input().props.onChange({target:{value:''}});tree=render();tree=render();
// Failed sends retain the unsent message and do not overwrite a newer draft.
chatGate=null;failChat=true;input().props.onChange({target:{value:'Can I continue later?'}});tree=render();await all(tree).find(n=>n.props?.className==='wb-chat-composer').props.onSubmit({preventDefault(){}});await flush();tree=render();assert.equal(input().props.value,'Can I continue later?');assert.ok(all(tree).some(n=>n.props?.role==='alert'));failChat=false;
emptyChat=true;await all(tree).find(n=>n.props?.className==='wb-chat-composer').props.onSubmit({preventDefault(){}});await flush();tree=render();assert.equal(input().props.value,'Can I continue later?','Empty save response restores the draft');emptyChat=false;
// A successful completion opens express checkout, but a checkout started during
// the completion request is never interrupted by its late response.
find(tree,'WebinarPlayer').props.onProgress(w.durationSeconds);tree=render();find(tree,'WebinarPlayer').props.onEnded();await flush();assert.deepEqual(redirects,['/webinar/checkout']);
let finish;completionGate=new Promise(resolve=>{finish=resolve;});tree=render();find(tree,'WebinarPlayer').props.onEnded();find(tree,'WebinarCheckout').props.onEngaged();finish();await flush();assert.deepEqual(redirects,['/webinar/checkout'],'Late completion cannot replace an engaged checkout');
// A Standard buyer enters the paired VIP video when the main webinar ends.
tree=render();find(tree,'WebinarCheckout').props.onPurchased('standard');await flush();assert.equal(redirects.at(-1),'/live/123457');
h.close();
store.delete('icash-webinar-prompts:'+sessionId);
const returningRoom=await harness('components/webinar-room.tsx',roomDeps);returningRoom.render('WebinarRoom',{webinarCode:'129339'});await flush();let returningTree=returningRoom.render('WebinarRoom',{webinarCode:'129339'});find(returningTree,'WebinarPlayer').props.onProgress(65);returningTree=returningRoom.render('WebinarRoom',{webinarCode:'129339'});assert.equal(all(returningTree).some(n=>n.props?.className?.startsWith('wb-prompt ')),false,'A remembered email avoids another contact request in a fresh session');returningRoom.close();

// VIP viewers already bought Standard: no contact prompts, independent upgrade state.
for(const [scenario,[version,preview,outcome]] of [['day',false,'unpaid'],['night',false,'paid'],['day',true,'unpaid'],['night',true,'paid'],['night',false,'pending']].entries()){
 const events=[],navigated=redirects.length;
 const vipSessionId='00000000-0000-4000-8000-00000000070'+scenario;
 const vip={...w,parentWebinarId:'00000000-0000-4000-8000-000000000999',recordingVersion:version,redirectAtEnd:false,chat:[{id:'taylor',at:805,name:'Taylor',text:'Joined',kind:'purchase'},{id:'emilio',at:810,name:'Emilio',text:'Joined',kind:'purchase'}],offers:[{id:'vip',at:800,replaySpots:3,title:'VIP offer',description:'',ctaLabel:'Upgrade',action:'checkout',url:'',expiresAt:null},{id:'vip-last',at:1200,replaySpots:1,title:'VIP last chance',description:'',ctaLabel:'Upgrade',action:'checkout',url:'',expiresAt:null}]};
 const vh=await harness('components/webinar-room.tsx',{...roomDeps,post:async(url,body)=>{
  events.push({url,body});
  if(url.endsWith('/start'))return {sessionId:vipSessionId,webinar:policy.publicWebinar(vip),progress:0,name:version==='day'?'Casey':'',email:'',phone:'',contactSaved:false,messages:[],preview,serverNow:Date.now()};
  if(url.endsWith('/chat'))return {messages:[{id:'vip-message',role:'user',text:body.text,playback_seconds:body.seconds}]};
  if(url.endsWith('/contact'))throw Error('VIP must never collect contact details');
  return {saved:true,redirect:'/webinar/upgrade'};
 }});
 const renderVip=()=>vh.render('WebinarRoom',{});renderVip();await flush();let vt=renderVip();
 assert.equal(listeners.has('beforeunload'),!preview,'Only verified live VIP viewers receive an exit reminder');
 for(const seconds of [0,65,600]){
  find(vt,'WebinarPlayer').props.onProgress(seconds);vt=renderVip();
  assert.equal(all(vt).find(n=>n.props?.id==='wb-question')?.props.name,'message',version+' VIP immediately allows chat');
  assert.ok(!all(vt).some(n=>n.props?.className?.startsWith('wb-prompt ')||n.props?.id==='wb-contact-label'||n.props?.className==='wb-chat-identity'));
 }
 all(vt).find(n=>n.props?.id==='wb-question').props.onChange({target:{value:"I'm in"}});vt=renderVip();await all(vt).find(n=>n.props?.className==='wb-chat-composer').props.onSubmit({preventDefault(){}});await flush();vt=renderVip();
 assert.equal(events.filter(e=>e.url.endsWith('/chat')).length,1);assert.equal(events.filter(e=>e.url.endsWith('/contact')).length,0);
 find(vt,'WebinarPlayer').props.onProgress(800);vt=renderVip();vt=renderVip();
 assert.equal(find(vt,'WebinarCheckout').props.vipWebinar,true,'The scheduled VIP offer opens upgrade checkout');
 find(vt,'WebinarCheckout').props.onPurchased('standard');vt=renderVip();
 assert.equal(all(vt).find(n=>n.props?.id==='webinar-chat').props.hidden,true,'Standard access does not complete the VIP offer');
 assert.equal(redirects.length,navigated);
 find(vt,'WebinarPlayer').props.onProgress(805);vt=renderVip();
 assert.equal(find(vt,'WebinarOfferSpots').props.spots.remaining,2);
 assert.equal(find(find(vt,'WebinarPlayer').props.overlay,'WebinarPurchaseNotifications').props.replayPurchase.name,'Taylor');
 assert.equal(find(all(vt).find(n=>n.props?.id==='webinar-chat'),'WebinarPurchaseNotifications'),undefined,'Pop-ups are outside the hidden chat');
 const priorExit=listeners.get('beforeunload');
 find(vt,'WebinarCheckout').props.onUpgradeActive(true);
 priorExit?.({isTrusted:true,preventDefault(){throw Error('Active payment must not show an exit prompt');}});
 vt=renderVip();assert.equal(listeners.has('beforeunload'),false,'Checkout disarms the reminder');
 find(vt,'WebinarPlayer').props.onProgress(810);vt=renderVip();
 assert.equal(find(vt,'WebinarOfferSpots').props.spots.remaining,1,'The counter keeps updating during payment');
 assert.equal(find(find(vt,'WebinarPlayer').props.overlay,'WebinarPurchaseNotifications').props.replayPurchase.name,'Emilio');
 find(vt,'WebinarCheckout').props.onUpgradeActive(false);vt=renderVip();
 assert.equal(listeners.has('beforeunload'),!preview,'Watching can resume without consuming the one reminder');
 find(vt,'WebinarPlayer').props.onProgress(1200);vt=renderVip();vt=renderVip();
 assert.ok(all(vt).some(n=>n.type==='h2'&&n.props.children==='VIP last chance'),'Later VIP offers still open');
 if(outcome==='pending'){
  find(vt,'WebinarCheckout').props.onUpgradeActive(true);vt=renderVip();find(vt,'WebinarPlayer').props.onEnded();await flush();vt=renderVip();
  assert.equal(redirects.length,navigated,'Finishing cannot interrupt an upgrade in progress');
 }
 if(outcome!=='unpaid'){
  find(vt,'WebinarCheckout').props.onPurchased('vip');vt=renderVip();
  assert.equal(redirects.length,preview?navigated:navigated+1);
  if(!preview)assert.equal(redirects.at(-1),'/','Verified VIP opens the workspace immediately');
 }else{
  find(vt,'WebinarPlayer').props.onEnded();await flush();
  assert.equal(redirects.length,navigated+1);
  if(preview)assert.ok(redirects.at(-1).startsWith('/webinar/checkout/preview?')&&redirects.at(-1).includes('vip=1'));
  else assert.equal(redirects.at(-1),'/webinar/upgrade','Unupgraded viewers go to the VIP offer at the end');
 }
 vh.close();
 assert.equal(listeners.has('beforeunload'),false,'Completed, purchased and unmounted rooms release the exit listener');
}
console.log('PASS VIP room: no repeated contact, timed offers, unpaid ending, protected in-progress payment, paid workspace routing and isolated previews.');

// Public owner sessions keep the real player and measurement through paid callbacks and completion.
for(const vipRoom of [false,true])for(const paidState of ['standard','vip']){
 const before=redirects.length,ready=[],events=[];
 const config={...w,...(vipRoom?{parentWebinarId:'00000000-0000-4000-8000-000000000999'}:{})};
 const ownerRoom=await harness('components/webinar-room.tsx',{...roomDeps,webinarBrowserReady:(...args)=>ready.push(args),post:async(url,body)=>{
  events.push({url,body});
  if(url.endsWith('/start'))return {sessionId,webinar:policy.publicWebinar(config),progress:w.durationSeconds-1,name:'Owner',messages:[],preview:false,ownerWatching:true,serverNow:Date.now()};
  return {saved:true,redirect:'/'};
 }});
 const renderOwner=()=>ownerRoom.render('WebinarRoom',{});renderOwner();await flush();let ownerTree=renderOwner();ownerTree=renderOwner();
 assert.deepEqual(ready,[[sessionId,false]],'Owner enters the live measurement path');
 assert.equal(find(ownerTree,'WebinarCheckout').props.stayOnWebinar,true);
 find(ownerTree,'WebinarCheckout').props.onPurchased(paidState,'/live/123457');ownerTree=renderOwner();
 assert.ok(find(ownerTree,'WebinarPlayer'));assert.equal(find(ownerTree,'WebinarVipWelcome'),undefined);
 find(ownerTree,'WebinarPlayer').props.onEnded();await flush();ownerTree=renderOwner();
 assert.ok(events.some(e=>e.body?.kind==='completed'),'Completion still records normally');
 assert.equal(redirects.length,before,'Neither paid membership nor video completion removes the owner from the webinar');
 ownerRoom.close();
}
console.log('PASS owner public viewing retains player, live measurement and completion without workspace or VIP handoff.');

// Recorded purchases are visible in preview; live updates never call billing in preview.
for(const vip of [false,true]){
 let calls=0;
 const instance=await harness('components/webinar-purchase-notifications.tsx',{activityMessage,recordedPurchaseMessage,recentActivity,X:'X',webinarSite:roomDeps.webinarSite,webinarRequest:async()=>{calls++;throw Error('Preview must stay local');}});
 const props={sessionId:'preview-popups-'+vip,preview:true,enabled:false,intervalSeconds:30,vip,replayPurchase:{name:'Taylor',at:805}};
 let tree=instance.render('WebinarPurchaseNotifications',props);await flush();tree=instance.render('WebinarPurchaseNotifications',props);
 assert.equal(all(tree).find(n=>n.type==='strong').props.children,recordedPurchaseMessage('Taylor',vip));
 assert.ok(all(tree).some(n=>n.type==='small'&&n.props.children==='Recorded activity'));
 assert.equal(tree.props.className,'wb-purchase-toast-region');assert.equal(calls,0);
 all(tree).find(n=>n.type==='button').props.onClick();tree=instance.render('WebinarPurchaseNotifications',props);
 assert.equal(all(tree).some(n=>n.type==='strong'),false,'Dismissal hides recorded and verified updates for the session');instance.close();
}
{
 let calls=0;
 const event={id:'a'.repeat(32),kind:'membership',amountCents:5000,occurredAt:new Date().toISOString(),region:null};
 const instance=await harness('components/webinar-purchase-notifications.tsx',{activityMessage,recordedPurchaseMessage,recentActivity,X:'X',webinarSite:roomDeps.webinarSite,webinarRequest:async()=>{calls++;return {events:[event],serverNow:Date.now()};}});
 const props={sessionId:'live-popup',preview:false,enabled:true,intervalSeconds:30};
 instance.render('WebinarPurchaseNotifications',props);await flush();const tree=instance.render('WebinarPurchaseNotifications',props);
 assert.equal(all(tree).find(n=>n.type==='strong').props.children,activityMessage(event));assert.equal(calls,1);
 assert.equal(all(tree).some(n=>n.props?.children==='Recorded activity'),false);instance.close();
}
console.log('PASS visible purchase pop-ups: recorded names and VIP wording, preview isolation, dismissal and verified live feed.');

// Owner preview uses the configured timers and can inspect the unpaid end page.
const timerFixture={id:'offer-timer',label:'Time remaining',at:1355,mode:'duration',durationSeconds:121,endsAt:null,placement:'offer',onExpire:'hide',expiredMessage:'Ended'};
let previewNow=Date.now();const previewDeadline=new Date(previewNow+90000).toISOString();
const previewRoom=await harness('components/webinar-room.tsx',{...roomDeps,useWebinarTimers:input=>{timerInput=input;return {deadlines:{'offer-timer':previewDeadline},offerDeadlines:{},offset:0,now:previewNow};},post:async()=>({sessionId,webinar:policy.publicWebinar({...w,timers:[timerFixture]}),progress:1385,name:'Owner',messages:[],preview:true,serverNow:previewNow})});
const renderPreview=()=>previewRoom.render('WebinarRoom',{});
renderPreview();await flush();let previewTree=renderPreview();previewTree=renderPreview();
assert.equal(listeners.has('beforeunload'),false,'Owner preview never installs an exit reminder');
const previewExit=find(previewTree,'dialog'),previewExitButton=all(previewTree).find(n=>n.type==='button'&&n.props.children==='Preview exit pop-up');
assert.ok(previewExit&&previewExitButton);
const exitPreviewState={open:false,shown:0,showModal(){this.open=true;this.shown++;},close(){this.open=false;}};
previewExit.props.ref.current=exitPreviewState;
const previewExitNavigationCount=redirects.length,previewExitRequestCount=requestLog.length,exitSeenBefore=store.get('icash.webinar.vip-exit-reminder.v1');
for(const label of ['Keep watching','Leave webinar']){
 previewExitButton.props.onClick();assert.equal(exitPreviewState.open,true);
 all(previewExit).find(n=>n.type==='button'&&n.props.children===label).props.onClick();assert.equal(exitPreviewState.open,false);
}
assert.equal(exitPreviewState.shown,2,'Owner can reopen the actual pop-up for review');
assert.equal(redirects.length,previewExitNavigationCount,'Preview choices never navigate away');assert.equal(requestLog.length,previewExitRequestCount);
assert.equal(store.get('icash.webinar.vip-exit-reminder.v1'),exitSeenBefore,'Preview never consumes or resets a viewer reminder');
assert.equal(listeners.has('beforeunload'),false);
assert.deepEqual(timerInput.timers,[timerFixture],'Room passes saved timers into deadline synchronization');
assert.ok(find(previewTree,'WebinarCountdownBanner'),'A single top countdown banner is mounted');
const previewLink=all(previewTree).find(n=>n.type==='a'&&n.props.href?.startsWith('/webinar/checkout/preview'));
assert.ok(previewLink,'Owner can open the unpaid checkout preview at any time');
assert.equal(all(previewTree).find(n=>n.props?.['aria-labelledby']==='wb-chat-title').props.hidden,true);
const previewChat=()=>all(previewTree).find(n=>n.props?.['aria-labelledby']==='wb-chat-title');
const previewOffer=()=>all(previewTree).find(n=>n.props?.id==='webinar-offer');
const previewToggle=label=>all(previewTree).find(n=>n.type==='button'&&n.props.children===label);
find(previewTree,'WebinarCheckout').props.onEngaged();previewTree=renderPreview();
all(previewTree).find(n=>n.props?.id==='wb-question').props.onChange({target:{value:'Owner preview draft'}});previewTree=renderPreview();
assert.equal(find(previewTree,'WebinarCountdownBanner').props.countdown.remaining,90);
previewToggle('Show chat').props.onClick();previewTree=renderPreview();
assert.equal(previewChat().props.hidden,false,'Owner can inspect chat during an active offer');
assert.equal(previewOffer().props.hidden,true,'The offer is minimized while the owner inspects chat');
assert.ok(find(previewOffer(),'WebinarCheckout'),'Checkout stays mounted and keeps its form state');
assert.equal(all(previewTree).find(n=>n.props?.id==='wb-question').props.value,'Owner preview draft');
all(previewTree).find(n=>n.props?.['aria-label']==='Minimize chat').props.onClick();previewTree=renderPreview();
assert.equal(all(previewTree).find(n=>n.props?.id==='wb-chat-body').props.hidden,true);
all(previewTree).find(n=>n.props?.['aria-label']==='Expand chat').props.onClick();previewTree=renderPreview();
assert.equal(all(previewTree).find(n=>n.props?.id==='wb-chat-body').props.hidden,false);
previewNow+=1000;previewTree=renderPreview();
assert.equal(find(previewTree,'WebinarCountdownBanner').props.countdown.remaining,89,'Countdown continues while chat is visible');
previewToggle('Show offer').props.onClick();previewTree=renderPreview();
assert.equal(previewOffer().props.hidden,false);assert.equal(previewChat().props.hidden,true);
assert.equal(find(previewTree,'WebinarCountdownBanner').props.countdown.remaining,89,'Returning to the offer does not restart its timer');
previewToggle('Show chat').props.onClick();previewTree=renderPreview();
find(previewTree,'WebinarPlayer').props.onPreviewSeek(1385);previewTree=renderPreview();
assert.equal(previewOffer().props.hidden,false,'Seeking resets the preview to the normal offer view');
assert.equal(previewChat().props.hidden,true);
const redirectsBeforePayment=redirects.length;
find(previewTree,'WebinarCheckout').props.onPurchased('vip');previewTree=renderPreview();
assert.equal(all(previewTree).find(n=>n.props?.['aria-labelledby']==='wb-chat-title').props.hidden,false,'Confirmed payment immediately restores chat');
assert.equal(find(previewTree,'WebinarCountdownBanner').props.countdown,null,'Paid viewers stop hearing the countdown');
assert.equal(redirects.length,redirectsBeforePayment,'Paying while watching leaves time to comment');
const countBeforePreview=requestLog.length;
find(previewTree,'WebinarPlayer').props.onEnded();
assert.equal(redirects.at(-1),previewLink.props.href,'Preview completion opens the unpaid customer page');
assert.equal(requestLog.length,countBeforePreview,'Preview completion does not write conversion events');
previewRoom.close();

// The timed email request cannot replace a message already being written.
store.delete('icash-webinar-prompts:'+sessionId);rememberedEmail='';
const draftRoom=await harness('components/webinar-room.tsx',roomDeps),renderDraftRoom=()=>draftRoom.render('WebinarRoom',{});renderDraftRoom();await flush();let dr=renderDraftRoom();
find(dr,'WebinarPlayer').props.onProgress(0);dr=renderDraftRoom();
all(dr).find(n=>n.props?.id==='wb-question').props.onChange({target:{value:'What happens after I sign up?'}});dr=renderDraftRoom();find(dr,'WebinarPlayer').props.onProgress(65);dr=renderDraftRoom();
assert.equal(all(dr).find(n=>n.props?.id==='wb-question').props.name,'message');assert.equal(all(dr).find(n=>n.props?.id==='wb-question').props.value,'What happens after I sign up?');assert.equal(all(dr).some(n=>n.props?.id==='wb-contact-label'),false);draftRoom.close();
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
// The owner's timeline is persistent, drives real seeks, and never appears publicly.
{
 const h=await harness('components/webinar-player.tsx',{...icons,...playback,...policy}),seeks=[];
 const props={...vp,preview:true,onPreviewSeek:n=>seeks.push(n)};
 const render=()=>h.render('WebinarPlayer',props);
 const m={...media,currentTime:0,paused:true,duration:1800,async play(){this.paused=false;},pause(){this.paused=true;}};
 let tree=render();find(tree,'video').props.ref.current=m;
 assert.equal(find(tree,'input').props.disabled,true);
 find(tree,'video').props.onLoadedMetadata();await flush();tree=render();
 let slider=find(tree,'input');assert.equal(slider.props.max,1800);assert.equal(slider.props.disabled,false);
 slider.props.onChange({target:{value:'1394'}});assert.equal(m.currentTime,1394);assert.equal(seeks.at(-1),1394);
 tree=render();assert.equal(find(tree,'input').props.value,1394);
 slider.props.onChange({target:{value:'120'}});assert.equal(seeks.at(-1),120,'Backward seeks reset the room cues');
 find(render(),'video').props.onPlaying();tree=render();assert.ok(find(tree,'input'),'Timeline stays present while playing');
 all(tree).find(n=>n.props?.['aria-label']==='Pause preview').props.onClick();assert.equal(m.paused,true);
 all(render()).find(n=>/mute preview/i.test(n.props?.['aria-label']??'')).props.onClick();
 assert.equal(all(h.render('WebinarPlayer',vp)).some(n=>n.props?.['aria-label']==='Preview video timeline'),false);
 h.close();sessionStorage.removeItem('icash-webinar-muted');
}
// Sound-first autoplay, policy fallback, and explicit viewer choices use the real
// handlers. These fixtures never load media or contact a provider.
async function audioPlayer(play,extra={}){
 const h=await harness('components/webinar-player.tsx',{...icons,...playback,...extra}),calls=[];
 const render=()=>h.render('WebinarPlayer',vp);
 const media={currentTime:0,duration:1800,paused:true,muted:find(render(),'video').props.muted,ended:false,error:null,readyState:4,
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
// A download stall is not a playback failure. Recovery disappears on progress.
{
 let timeout=null;const p=await audioPlayer(async()=>{}, {setTimeout:fn=>{timeout=fn;return 1;},clearTimeout:()=>{timeout=null;}});
 p.start();await flush();p.render();
 find(p.render(),'video').props.onStalled();p.render();assert.equal(timeout,null,'Buffered playback does not start a slow warning');
 p.media.readyState=2;find(p.render(),'video').props.onWaiting();p.render();assert.ok(timeout);timeout();
 assert.ok(all(p.render()).some(n=>n.props?.className==='wb-player-recovery'),'A real stalled playback offers recovery');
 p.media.currentTime=42;find(p.render(),'video').props.onTimeUpdate();
 assert.equal(all(p.render()).some(n=>n.props?.className==='wb-player-recovery'),false,'Advancing video clears a stale warning without needing another playing event');
 find(p.render(),'video').props.onWaiting();p.render();const pendingSlow=timeout;
 document.hidden=true;pendingSlow();assert.equal(all(p.render()).some(n=>n.props?.className==='wb-player-recovery'),false,'Hidden tabs cannot create a slow warning');document.hidden=false;
 p.media.pause();p.render();assert.equal(timeout,null,'Pausing clears the buffering timer');p.close();
}
console.log('PASS webinar flows: name-only chat without email/phone opt-ins, immediate chat echo, draft and scroll preservation, automatic offers, countdown chat gating, payment continuity, player recovery and empty draft guidance.');
console.log('PASS webinar audio: audible autoplay, one muted policy fallback, tap to listen, persistent mute, blocked playback recovery, stale rejection protection, and no retry on media errors.');

// A locked mobile preview returns through password unlock, never customer sign-in.
{
 const priorSearch=location.search,priorPath=location.pathname,priorReplace=location.replace;let unlockPath='';location.replace=path=>{unlockPath=path;};location.search='?preview='+w.id+'&variant=night';location.pathname='/webinar';
 const h=await harness('components/webinar-room.tsx',{...roomDeps,post:async()=>({previewLocked:true,publicPath:'/live/129340'})});
 h.render('WebinarRoom',{});await flush();
 assert.equal(unlockPath,'/dashboard-unlock?next='+encodeURIComponent('/webinar?preview='+w.id+'&variant=night'));
 h.close();location.search=priorSearch;location.pathname=priorPath;location.replace=priorReplace;
}

// Restoring a hidden tab or BFCache page must not revive an expired session.
{
 const realNow=Date.now;let now=realNow(),reloads=0;Date.now=()=>now;location.reload=()=>reloads++;
 try{
  for(const preview of [false,true]){
   let writes=0;
   const h=await harness('components/webinar-room.tsx',{...roomDeps,post:async(url)=>{if(url.endsWith('/start'))return {sessionId,webinar:policy.publicWebinar(w),progress:100,name:'Viewer',messages:[],preview,serverNow:now};writes++;return {saved:true};}});
   const render=()=>h.render('WebinarRoom',{});render();await flush();let tree=render();
   document.hidden=true;listeners.get('visibilitychange')();now+=3599999;document.hidden=false;listeners.get('visibilitychange')();assert.equal(reloads,0);
   document.hidden=true;listeners.get('visibilitychange')();now+=3600000;
   const before=writes;document.hidden=false;listeners.get('pageshow')();
   assert.equal(reloads,preview?0:1,'Expired live restores reload; owner previews stay open');
   find(tree,'WebinarPlayer').props.onCheckpoint();await flush();assert.equal(writes,before,'Expired playback cannot refresh the server checkpoint');
   h.close();reloads=0;
  }
  // Even a brief absence rechecks when sunrise/sunset passed, before stale checkpoints.
  for(const preview of [false,true]){
   let writes=0;const recheckAt=now+300000;
   const h=await harness('components/webinar-room.tsx',{...roomDeps,post:async(url)=>{if(url.endsWith('/start'))return {sessionId,webinar:policy.publicWebinar(w),progress:100,name:'Viewer',messages:[],preview,recordingRecheckAt:recheckAt,serverNow:now};writes++;return {saved:true};}});
   const render=()=>h.render('WebinarRoom',{});render();await flush();let tree=render();
   document.hidden=true;listeners.get('visibilitychange')();now=recheckAt-1;document.hidden=false;listeners.get('pageshow')();assert.equal(reloads,0,'The same period resumes');
   now=recheckAt+1000;tree=render();assert.equal(reloads,0,'Continuous watching never changes recording mid-video');
   document.hidden=true;listeners.get('visibilitychange')();now+=1000;const before=writes;document.hidden=false;listeners.get('pageshow')();
   assert.equal(reloads,preview?0:1,'Returning after the period boundary reloads even inside one hour');
   find(tree,'WebinarPlayer').props.onCheckpoint();await flush();assert.equal(writes,before);
   h.close();reloads=0;
  }
  // Leaving an active checkout open must not erase payment fields on return.
  const h=await harness('components/webinar-room.tsx',{...roomDeps,post:async(url)=>url.endsWith('/start')?{sessionId,webinar:policy.publicWebinar(w),progress:1500,name:'Buyer',messages:[],preview:false,recordingRecheckAt:now+60000,serverNow:now}:{saved:true}});
  const render=()=>h.render('WebinarRoom',{});render();await flush();let tree=render();const exitBeforeCheckout=listeners.get('beforeunload');assert.ok(exitBeforeCheckout);find(tree,'WebinarCheckout').props.onEngaged();
  exitBeforeCheckout({isTrusted:true,preventDefault(){throw Error('Checkout must suppress the reminder before React rerenders');}});
  tree=render();assert.equal(listeners.has('beforeunload'),false);
  document.hidden=true;listeners.get('visibilitychange')();now+=3600000;document.hidden=false;listeners.get('pageshow')();assert.equal(reloads,0);h.close();
 }finally{Date.now=realNow;document.hidden=false;}
 console.log('PASS one-hour browser return: short absence resumes, expired restored pages reload before checkpoints, owner previews and active checkout remain intact.');
}

{
 let canRemind;
 const instance=await harness('components/webinar-room.tsx',{...roomDeps,installWebinarExitReminder:predicate=>{canRemind=predicate;return ()=>{};}}),render=()=>instance.render('WebinarRoom',{webinarCode:'129339'});
 render();await flush();let tree=render();find(tree,'WebinarPlayer').props.onProgress(1500);tree=render();
 const before=redirects.length,player=find(tree,'WebinarPlayer');find(tree,'WebinarCheckout').props.onEngaged();tree=render();
 assert.equal(canRemind(),false,'An active payment is not interrupted');
 find(tree,'WebinarCheckout').props.onPurchased('standard','/live/123457');tree=render();
 assert.equal(find(tree,'WebinarVipWelcome'),undefined,'Payment must not replace the playing video');
 assert.equal(find(tree,'WebinarPlayer').props.sessionId,player.props.sessionId,'Payment keeps the same player mounted');
 assert.equal(find(tree,'WebinarPlayer').props.progress,player.props.progress,'Payment must not reset playback');
 assert.equal(canRemind(),true,'A buyer still watching gets the normal one-time leave protection');
 assert.equal(redirects.length,before,'No navigation on payment');
 find(tree,'WebinarPlayer').props.onProgress(1510);tree=render();assert.ok(find(tree,'WebinarPlayer'));
 find(tree,'WebinarPlayer').props.onEnded();tree=render();await flush();
 assert.equal(find(tree,'WebinarVipWelcome').props.href,'/live/123457');assert.equal(find(tree,'WebinarVipWelcome').props.fullScreen,true);
 assert.equal(find(tree,'WebinarPlayer'),undefined,'The video is replaced only after it ends');
 assert.equal(canRemind(),false,'The intended next session never triggers the old leave warning');
 assert.equal(redirects.length,before,'The welcome owns navigation after its visible countdown');instance.close();
 console.log('PASS main purchase: playback survives payment, paid viewers retain leave protection, and the VIP handoff waits for the video to end.');
}
