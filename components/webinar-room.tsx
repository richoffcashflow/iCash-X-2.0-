'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {safeVipSession,webinarPurchaseDestination,type WebinarPurchaseState} from '@/lib/webinar-purchase-flow';
import {allowWebinarLinkNavigation,allowWebinarNavigation,installWebinarExitReminder,navigateWebinar} from '@/lib/webinar-exit-reminder';
import {installWebinarRecovery} from '@/lib/webinar-recovery-client';
import {useWebinarSharedChat} from '@/components/use-webinar-shared-chat';
import {WebinarAudience} from '@/components/webinar-audience';
import {WebinarPurchaseNotifications} from '@/components/webinar-purchase-notifications';
import {withOfferDeadlines} from '@/packages/webinar-engine/src/offer-deadlines';
import {WebinarOfferImage} from '@/components/webinar-offer-image';
import {WebinarOfferSpots} from '@/components/webinar-offer-spots';
import {replayOfferActivity} from '@/packages/webinar-engine/src/replay-offer-spots';
import {recordedPurchaseMessage} from '@/lib/webinar-activity';
import {availableOffers,selectOffer} from '@/packages/webinar-engine/src/index';
import {webinarChatStream,type WebinarMessage,type PendingWebinarMessage} from '@/lib/webinar-chat-stream';
import {webinarSite} from '@/lib/webinar-site';
import {webinarBrowserReady,webinarBrowserEvent} from '@/lib/webinar-browser-events';
import {MessageCircle,Send,X,ChevronDown,ShieldCheck,Check} from 'lucide-react';
import {WebinarTimers,useWebinarTimers} from '@/components/webinar-timers';
import {WebinarCountdownBanner} from '@/components/webinar-countdown-banner';
import {webinarOfferFocus} from '@/lib/webinar-offer-focus';
import {observeWebinarOfferView} from '@/lib/webinar-offer-view';
import {WebinarVipWelcome} from '@/components/webinar-vip-welcome';
import {WebinarPlayer} from '@/components/webinar-player';
import {WebinarPanelBoundary} from '@/components/webinar-panel-boundary';
import {webinarPost as post,webinarBeacon,webinarRequest} from '@/lib/webinar-client';
import {restoredPosition,savePosition,clearPosition,withinWebinarResumeWindow,webinarReturnNeedsReload} from '@/lib/webinar-playback';
import {webinarPrompt,readPromptHistory,savePromptHistory,emptyPromptHistory} from '@/lib/webinar-prompts';
import {publicWebinar,webinarSchema,formatWatchTime,webinarOffers,webinarPitchAt,offerDestination,webinarConsent,webinarConsentVersion,webinarSmsConsent,webinarSmsConsentVersion,type Webinar,type WebinarEvent} from '@/lib/webinar-policy';
const WebinarCheckout=dynamic(()=>import('@/components/webinar-checkout-adapter').then(m=>m.WebinarCheckout),{loading:()=> <p role="status">Getting checkout ready…</p>});
type PublicWebinar=ReturnType<typeof publicWebinar>;
type Message=WebinarMessage;
type Session={webinar:PublicWebinar;canonicalPath?:string;sessionId:string;progress:number;name:string;email?:string;phone?:string;contactSaved:boolean;messages:Message[];preview:boolean;ownerWatching?:boolean;recordingRecheckAt?:number|null;serverNow:number};
export function WebinarRoom({webinarCode}:{webinarCode?:string}){
 const [vipWelcomeUrl,setVipWelcomeUrl]=useState<string|null>(null),vipWelcomeRef=useRef<string|null>(null);
 const [previewPublicPath,setPreviewPublicPath]=useState<string|null>(null);
 const [previewLocked,setPreviewLocked]=useState(false);
 const [session,setSession]=useState<Session|null>(null),[error,setError]=useState(''),[unavailable,setUnavailable]=useState('');
 const [time,setTime]=useState(0),[playing,setPlaying]=useState(false),[funding,setFunding]=useState(false),[messages,setMessages]=useState<Message[]>([]),[question,setQuestion]=useState(''),[chatBusy,setChatBusy]=useState(false),[chatError,setChatError]=useState('');
 const [name,setName]=useState(''),[draftName,setDraftName]=useState(''),[email,setEmail]=useState(''),[phone,setPhone]=useState(''),[consent,setConsent]=useState(false),[contactSaved,setContactSaved]=useState(false),[formBusy,setFormBusy]=useState(false),[formError,setFormError]=useState('');
 const [selectedOfferId,setSelectedOfferId]=useState(''),[checkoutEngaged,setCheckoutEngaged]=useState(false);
 const [now,setNow]=useState(Date.now()),[endCountdown,setEndCountdown]=useState<number|null>(null),[saved,setSaved]=useState(true);
 const [ended,setEnded]=useState(false),[paid,setPaid]=useState(false);
 const [chatExpanded,setChatExpanded]=useState<boolean|null>(null);
 const [previewChatOfferId,setPreviewChatOfferId]=useState('');
 const endedRef=useRef(false),purchasedRef=useRef<WebinarPurchaseState>(null),upgradeActiveRef=useRef(false),purchaseRedirected=useRef(false);
 const starting=useRef(false),syncing=useRef(false),completed=useRef(false),sessionRef=useRef<Session|null>(null);
 const [editingName,setEditingName]=useState(false),[promptHistory,setPromptHistory]=useState({...emptyPromptHistory});
 const [smsConsent,setSmsConsent]=useState(false);
 const [contactStep,setContactStep]=useState<'email'|'phone'>('email');
 const contactOperation=useRef(false);
 const [contactEditing,setContactEditing]=useState(false),[chatFocused,setChatFocused]=useState(false),[inputActive,setInputActive]=useState(false),[unread,setUnread]=useState(false),[sendingMessage,setSendingMessage]=useState<PendingWebinarMessage|null>(null),[contactNotice,setContactNotice]=useState('');
 const messageInput=useRef<HTMLInputElement>(null),focusChat=useRef(false);
 const chatLog=useRef<HTMLDivElement>(null),followChat=useRef(true),chatOperation=useRef(false);
 const offerHeading=useRef<HTMLHeadingElement>(null);
 const checkoutEngagedRef=useRef(false),completionPending=useRef(false),completionSyncing=useRef(false),completionRedirected=useRef(false);
 const lastSync=useRef(0),pitchSeen=useRef(false),startSeen=useRef(false),alive=useRef(true),offset=useRef(0),position=useRef(0),shownOffers=useRef(new Set<string>());
 const awaySince=useRef<number|null>(null),returnExpired=useRef(false);
 const exitDialog=useRef<HTMLDialogElement>(null),exitNavigation=useRef<(()=>void)|null>(null);
 const sharedChat=useWebinarSharedChat(session?.sessionId,position);
 const sharedIds=sharedChat.messages.map(m=>m.id).join(',');
 const w=session?.webinar;
 const isVip=!!w?.parentWebinarId;
 const recovery=useRef<ReturnType<typeof installWebinarRecovery>|null>(null);
 useEffect(()=>{
  if(!session||session.preview||session.ownerWatching||isVip)return;
  const control=installWebinarRecovery(session.sessionId,()=>!endedRef.current&&!checkoutEngagedRef.current&&!purchaseRedirected.current&&!returnExpired.current&&!upgradeActiveRef.current&&!purchasedRef.current,
   signal=>webinarBeacon('/api/webinar/recovery',signal));
  recovery.current=control;
  return()=>{control.stop();recovery.current=null;};
 },[session?.sessionId,session?.preview,session?.ownerWatching,isVip]);
 useEffect(()=>{recovery.current?.sync();},[checkoutEngaged,paid,ended]);
 useEffect(()=>{
  if(!session||session.preview||ended||paid||checkoutEngaged)return;
  const stop=installWebinarExitReminder(()=>!endedRef.current&&!checkoutEngagedRef.current&&!purchaseRedirected.current&&!returnExpired.current&&!upgradeActiveRef.current&&(isVip?purchasedRef.current!=='vip':!purchasedRef.current),isVip?undefined:leave=>{
   if(!exitDialog.current)return false;
   exitNavigation.current=leave;exitDialog.current.showModal();return true;
  });
  return()=>{stop();exitDialog.current?.close();exitNavigation.current=null;};
 },[session?.sessionId,session?.preview,isVip,ended,paid,checkoutEngaged]);
 const rawOffers=useMemo(()=>w?webinarOffers(w):[],[w]);
 const timerState=useWebinarTimers({sessionId:session?.sessionId??'',timers:w?.timers??[],offers:rawOffers,seconds:time,preview:session?.preview??true,now});
 const offers=useMemo(()=>withOfferDeadlines(rawOffers,timerState.offerDeadlines),[rawOffers,timerState.offerDeadlines]);
 const offerState=useRef({offers,offset:timerState.offset});
 offerState.current={offers,offset:timerState.offset};
 const available=availableOffers(offers,time,timerState.now),currentOffer=checkoutEngaged?rawOffers.find(o=>o.id===selectedOfferId):selectOffer(offers,time,timerState.now,selectedOfferId);
 const focus=webinarOfferFocus({offer:offers.find(o=>o.id===currentOffer?.id)??currentOffer,timers:w?.timers??[],deadlines:timerState.deadlines,seconds:time,now:timerState.now,duration:w?.durationSeconds??0,paid,ended});
 const previewChatVisible=!!session?.preview&&!!currentOffer&&previewChatOfferId===currentOffer.id;
 const chatLocked=focus.locked&&!previewChatVisible;
 const chatCollapsed=chatExpanded===false;
 const checkoutPreviewHref=w?`/webinar/checkout/preview?webinar=${encodeURIComponent(w.id)}&variant=${w.recordingVersion}${isVip?'&vip=1':''}`:'/webinar/checkout/preview';
 const checkoutHref=session?.preview?checkoutPreviewHref:isVip?'/webinar/upgrade':`${webinarSite.checkoutPath}?webinar_session=${session?.sessionId}`;
 const {spots,purchase:replayPurchase}=useMemo(()=>replayOfferActivity(rawOffers,w?.chat??[],time),[rawOffers,w?.chat,time]);
 const allOffersEnded=!checkoutEngaged&&rawOffers.length>0&&rawOffers.every(o=>{
  const fixed=Date.parse(o.expiresAt??'');
  const saved=o.durationSeconds?Date.parse(timerState.offerDeadlines[o.id]??''):NaN;
  return Math.min(Number.isFinite(fixed)?fixed:Infinity,Number.isFinite(saved)?saved:Infinity)<=timerState.now;
 });
 useEffect(()=>{if(!currentOffer&&!checkoutEngaged){setFunding(false);}},[currentOffer?.id,checkoutEngaged]);
 useEffect(()=>{
  const heading=offerHeading.current;
  if(!heading||!session||session.preview||!currentOffer||previewChatVisible)return;
  return observeWebinarOfferView(heading,()=>{
   if(returnExpired.current)return;
   webinarBrowserEvent('offer_viewed',session.sessionId,{product:isVip?'vip_upgrade':'membership'});
  });
 },[session?.sessionId,session?.preview,currentOffer?.id,previewChatVisible,isVip]);
 const load=useCallback(async()=>{if(starting.current)return;starting.current=true;setError('');setUnavailable('');setPreviewLocked(false);setPreviewPublicPath(null);try{
  const params=new URLSearchParams(location.search),attribution=Object.fromEntries(['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ad_id','adset_id','campaign_id','fbclid'].flatMap(k=>params.has(k)?[[k,params.get(k)!]]:[]));
  const d=await post<Session&{previewLocked?:boolean;publicPath?:string|null;redirect?:string;unavailable?:boolean;message?:string}>('/api/webinar/start',{...(webinarCode?{code:webinarCode}:{}),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Chicago',...(params.get('r')?{resume:params.get('r')}:{}),...(params.get('watch')==='1'?{returnToWebinar:true}:{}),...(params.get('preview')?{preview:params.get('preview'),variant:params.get('variant')==='night'?'night':'day'}:{}),attribution});
  if(d.previewLocked){const preview=params.get('preview');if(preview){const next='/webinar?preview='+encodeURIComponent(preview)+'&variant='+(params.get('variant')==='night'?'night':'day');navigateWebinar('/dashboard-unlock?next='+encodeURIComponent(next),true);return;}setPreviewLocked(true);setPreviewPublicPath(d.publicPath&&/^\/live\/\d{6,12}$/.test(d.publicPath)?d.publicPath:null);setError('This preview is for your owner account. Use the public webinar link for Instagram and other visitors.');return;}
  if(!alive.current)return;
  if(d.redirect){navigateWebinar(d.redirect,true);return;}if(d.unavailable){setUnavailable(d.message||'The next session is being prepared.');return;}
  if(typeof d.sessionId!=='string'||!Number.isFinite(d.progress)||!Number.isFinite(d.serverNow))throw Error('The session could not load. Please try again.');
  d.webinar=publicWebinar(webinarSchema.parse({...d.webinar,faq:'',chatStyle:''}));
  const canonical=d.canonicalPath&&/^\/live\/\d{6,12}$/.test(d.canonicalPath)?d.canonicalPath:location.pathname;
  if(params.has('r')||params.has('watch')||canonical!==location.pathname){params.delete('r');params.delete('watch');history.replaceState(null,'',canonical+(params.size?'?'+params.toString():'')+location.hash);}
  d.messages=Array.isArray(d.messages)?d.messages.filter(m=>m&&typeof m.id==='string'&&typeof m.text==='string'&&['user','assistant'].includes(m.role)):[];
  d.name=typeof d.name==='string'?d.name.trim():'';
  d.progress=d.preview?d.progress:restoredPosition(d.sessionId,d.progress,d.webinar.durationSeconds);
  webinarBrowserReady(d.sessionId,d.preview);offset.current=d.serverNow-Date.now();setNow(d.serverNow);sessionRef.current=d;setSession(d);setName(d.name);setDraftName(d.name);setEmail(d.email||'');setPhone(d.phone||'');setPromptHistory(readPromptHistory(d.sessionId));setContactSaved(d.contactSaved||!!d.email||!!d.phone);setMessages(d.messages);setTime(d.progress);position.current=d.progress;
 }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not open the session.');}finally{starting.current=false;}},[webinarCode]);
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;};},[load]);
 const track=useCallback((kind:WebinarEvent,beacon=false,key='once')=>{
  if(!session||session.preview||returnExpired.current||awaySince.current!==null&&!withinWebinarResumeWindow(awaySince.current)&&!checkoutEngagedRef.current)return;const body={sessionId:session.sessionId,seconds:Math.floor(position.current),kind,key};
  if(kind==='completed')completionPending.current=true;
  else if(!completed.current)savePosition(session.sessionId,position.current);
  if(beacon){webinarBeacon('/api/webinar/event',body);if(key==='once'&&kind==='add_to_cart')webinarBrowserEvent('add_to_cart',session.sessionId,{product:isVip?'vip_upgrade':'membership'});return;}
  if(kind==='progress'&&syncing.current)return;if(kind==='progress')syncing.current=true;
  if(kind==='completed'&&completionSyncing.current)return;
  if(kind==='completed')completionSyncing.current=true;
  return post<{saved:boolean;redirect?:string}>('/api/webinar/event',body,10000).then(result=>{
   if(result.saved!==true)throw Error('Session progress was not confirmed.');
   if(kind==='completed'){
    completed.current=true;completionPending.current=false;clearPosition(session.sessionId);
    // Reconnects and bounded retries must finish the same end-of-video journey.
    const destination=webinarPurchaseDestination(purchasedRef.current,checkoutEngagedRef.current,upgradeActiveRef.current,!!session.webinar.parentWebinarId);
    if(!session.ownerWatching&&alive.current&&endedRef.current&&!purchaseRedirected.current&&!completionRedirected.current&&destination==='checkout'&&result.redirect){completionRedirected.current=true;navigateWebinar(result.redirect);}
   }
   if(alive.current)setSaved(true);if(key==='once'&&['started','contact_saved','checkout_opened'].includes(kind))webinarBrowserEvent(kind as 'started'|'contact_saved'|'add_to_cart'|'checkout_opened',session.sessionId);return result;
  }).catch(()=>{if(alive.current)setSaved(false);return null;}).finally(()=>{if(kind==='progress')syncing.current=false;if(kind==='completed')completionSyncing.current=false;});
 },[session]);
 // Revalidate a restored page before playback checkpoints can revive an old session.
 // Capture phase runs before the player's visibility/pagehide handlers.
 useEffect(()=>{
  const leave=()=>{if(awaySince.current===null)awaySince.current=Date.now();};
  const resume=()=>{
   if(document.hidden||awaySince.current===null||!sessionRef.current||purchaseRedirected.current)return;
   if(!sessionRef.current.preview&&webinarReturnNeedsReload(awaySince.current,sessionRef.current.recordingRecheckAt,Date.now(),offset.current)){
    if(checkoutEngagedRef.current)return; // Preserve an active payment form.
    if(!returnExpired.current){returnExpired.current=true;allowWebinarNavigation();location.reload();}
    return;
   }
   awaySince.current=null;
  };
  const visibility=()=>{if(document.hidden)leave();else resume();};
  document.addEventListener('visibilitychange',visibility,true);window.addEventListener('pagehide',leave,true);window.addEventListener('pageshow',resume,true);
  resume();
  return()=>{document.removeEventListener('visibilitychange',visibility,true);window.removeEventListener('pagehide',leave,true);window.removeEventListener('pageshow',resume,true);};
 },[checkoutEngaged]);
 useEffect(()=>{if(session)savePromptHistory(session.sessionId,promptHistory);},[session,promptHistory]);
 useEffect(()=>{const online=()=>{if(sessionRef.current){if(!document.hidden)track(completionPending.current?'completed':'progress');}else void load();};window.addEventListener('online',online);return()=>window.removeEventListener('online',online);},[load,track]);
 useEffect(()=>{
  if(!ended||!session||session.preview)return;
  let stopped=false,attempt=0;const delays=[3000,10000,30000];let timer:ReturnType<typeof setTimeout>;
  const retry=async()=>{
   if(stopped||completed.current||!completionPending.current)return;
   if(!document.hidden&&navigator.onLine)await track('completed');
   if(!stopped&&completionPending.current&&++attempt<delays.length)timer=setTimeout(()=>void retry(),delays[attempt]);
  };
  timer=setTimeout(()=>void retry(),delays[0]);return()=>{stopped=true;clearTimeout(timer);};
 },[ended,session,track]);
 useEffect(()=>{const id=setInterval(()=>setNow(Date.now()+offset.current),1000);return()=>clearInterval(id);},[]);
 useEffect(()=>{if(endCountdown===null||!session||checkoutEngaged)return;if(endCountdown===0){const offer=selectOffer(offerState.current.offers,session.webinar.durationSeconds,Date.now()+offerState.current.offset,session.webinar.endOfferId);if(offer?.action==='checkout'){setSelectedOfferId(offer.id);setFunding(true);setEndCountdown(null);}else if(offer)navigateWebinar(offerDestination(offer));else setEndCountdown(null);return;}const id=setTimeout(()=>setEndCountdown(n=>n===null?null:n-1),1000);return()=>clearTimeout(id);},[endCountdown,session,checkoutEngaged]);
 function latestMessages(){const log=chatLog.current;if(log)log.scrollTop=log.scrollHeight;followChat.current=true;setUnread(false);}
 function tick(n:number){if(!session||returnExpired.current)return;position.current=n;setTime(n);
  if(Date.now()-lastSync.current>15000){lastSync.current=Date.now();track('progress');}
 }
 function previewSeek(n:number){
  if(!session?.preview)return;
  endedRef.current=false;setEnded(false);setEndCountdown(null);
  checkoutEngagedRef.current=false;setCheckoutEngaged(false);
  shownOffers.current.clear();setSelectedOfferId('');setFunding(false);setChatExpanded(null);setPreviewChatOfferId('');
  followChat.current=true;setUnread(false);tick(n);
 }
 // Open the offer at its cue, retaining any chat draft until chat returns.
 useEffect(()=>{
  if(!session||checkoutEngaged)return;
  const offer=selectOffer(offers,time,timerState.now);
  if(!offer||shownOffers.current.has(offer.id))return;
  shownOffers.current.add(offer.id);if(!pitchSeen.current){pitchSeen.current=true;track('pitch_shown');}track('pitch_shown',false,'offer:'+offer.id);setSelectedOfferId(offer.id);setFunding(true);
 },[session,checkoutEngaged,time,now,track,offers,timerState.now]);
 function continuePurchase(){
  if(session?.preview||session?.ownerWatching||vipWelcomeRef.current)return;
  if(!alive.current||purchaseRedirected.current)return;
  const next=webinarPurchaseDestination(purchasedRef.current,checkoutEngagedRef.current,upgradeActiveRef.current,isVip);
  if(next&&next!=='checkout'&&(endedRef.current||isVip&&purchasedRef.current==='vip')){
   purchaseRedirected.current=true;
   if(purchasedRef.current==='standard'&&!sessionRef.current?.webinar.parentWebinarId){
    void webinarRequest<{postPurchaseUrl?:string|null}>('/api/billing/membership',{cache:'no-store'},10000).then(data=>navigateWebinar(safeVipSession(data?.postPurchaseUrl)??next)).catch(()=>navigateWebinar(next));
   }else navigateWebinar(next);
  }
 }
 function finishWebinar(){
  endedRef.current=true;setEnded(true);
  if(session?.preview&&(w?.redirectAtEnd||isVip)&&(!isVip||purchasedRef.current!=='vip')){const next=selectOffer(offers,w.durationSeconds,Date.now()+timerState.offset,w.endOfferId);if(isVip||next?.action==='checkout'){navigateWebinar(checkoutPreviewHref);return;}}
  const done=track('completed');continuePurchase();
  if(checkoutEngagedRef.current)return;
  const offer=w?selectOffer(offers,w.durationSeconds,Date.now()+timerState.offset,w.endOfferId):null;if(offer)setSelectedOfferId(offer.id);setFunding(!!offer);
  void done?.then(()=>continuePurchase());
 }
 function finishContact(){setFormError('');setContactEditing(false);setContactSaved(true);setPromptHistory(h=>({...h,contactDismissedAt:time,contactAttempts:2}));focusChat.current=true;}
 function nextContact(){setFormError('');setContactStep('phone');setContactEditing(true);focusChat.current=true;}
 function skipContact(){if(formBusy||contactOperation.current)return;if(contactStep==='email'){setEmail('');setConsent(false);}else{setPhone('');setSmsConsent(false);}setContactNotice('You can keep chatting.');finishContact();}
 async function saveContact(onlyName:boolean){if(!session||contactOperation.current)return;if(!draftName.trim()){setFormError('Enter your first name.');return;}contactOperation.current=true;setFormBusy(true);setFormError('');try{
  const d=await post<{name:string;contactSaved:boolean}>('/api/webinar/contact',{sessionId:session.sessionId,name:draftName.trim(),email:onlyName?'':email,phone:onlyName?'':phone,consent:!onlyName&&!!email.trim()&&consent,smsConsent:!onlyName&&!!phone.trim()&&smsConsent,smsVersion:webinarSmsConsentVersion,version:webinarConsentVersion,onlyName});if(!d.name?.trim())throw Error('Your name could not be saved. Please try again.');setName(d.name.trim());setDraftName(d.name.trim());setChatError('');setEditingName(false);
  if(onlyName){focusChat.current=true;setContactEditing(false);setContactNotice('Name saved. You’re ready to chat.');setPromptHistory(h=>({...h,nameSavedAt:time}));}
  else if(contactStep==='email'&&!phone.trim()){setContactNotice('Email saved.');nextContact();}
  else {setContactNotice('Details saved.');finishContact();}
  track(onlyName?'name_saved':'contact_saved');
 }catch(e){setFormError(e instanceof Error?e.message:'Could not save.');}finally{contactOperation.current=false;setFormBusy(false);}}
 async function send(e:React.FormEvent){e.preventDefault();if(chatLocked||!question.trim()||chatOperation.current||!session)return;if(!isVip&&!name.trim()){setEditingName(true);setChatError('Add your name before sending a message.');return;}chatOperation.current=true;setChatBusy(true);setChatError('');const text=question.trim();setSendingMessage({text,playback_seconds:Math.floor(position.current)});setQuestion('');followChat.current=true;try{const d=await post<{messages:Message[]}>('/api/webinar/chat',{sessionId:session.sessionId,text,seconds:Math.floor(position.current),share:true});if(!Array.isArray(d.messages)||!d.messages.length||d.messages.some(m=>!m||typeof m.id!=='string'||typeof m.text!=='string'||!['user','assistant'].includes(m.role)))throw Error('Your message could not be saved. Your video is still playing.');setMessages(m=>[...m,...d.messages]);}catch(e){setQuestion(draft=>draft||text);setChatError((e instanceof Error?e.message:'Message was not sent.')+' Your message: '+text);}finally{chatOperation.current=false;setSendingMessage(null);setChatBusy(false);}}
 const stream=useMemo(()=>{const statuses=new Map(sharedChat.statuses.map(s=>[s.id,s.public_status]));return webinarChatStream(w?.chat??[],[...messages.map(m=>({...m,public_status:statuses.get(m.id)??m.public_status})),...sharedChat.messages.filter(m=>!messages.some(own=>own.id===m.id))],time,sendingMessage);},[w?.chat,messages,sharedChat,time,sendingMessage]);
 useEffect(()=>{if(followChat.current)latestMessages();else setUnread(true);},[messages,stream.length,sendingMessage,sharedIds]);
 const automaticPrompt=w&&!isVip&&!paid&&!question.trim()&&!chatBusy&&!checkoutEngaged?webinarPrompt({name,contactSaved,seconds:time,nameAt:w.nameAt,contactAt:w.contactAt,history:promptHistory}):null;
 const needsChatName=!isVip&&!name.trim();
 const namePrompt=!!w&&!isVip&&(needsChatName||editingName);
 const contactPrompt=!!w&&!isVip&&!namePrompt&&(contactEditing||automaticPrompt==='contact');
 useEffect(()=>{if(name&&!editingName&&focusChat.current){focusChat.current=false;messageInput.current?.focus({preventScroll:true});}},[name,editingName,contactPrompt,contactStep]);
 function dismissPrompt(){setFormError('');setContactEditing(false);if(namePrompt){setPromptHistory(h=>({...h,nameDismissedAt:time,nameAttempts:Math.min(2,h.nameAttempts+1)}));setEditingName(false);setDraftName(name);}else setPromptHistory(h=>({...h,contactDismissedAt:time,contactAttempts:Math.min(2,h.contactAttempts+1)}));}
 const nameForm=namePrompt&&<form className="wb-prompt wb-name-prompt" onSubmit={e=>{e.preventDefault();void saveContact(true);}}>
     <div className="wb-prompt-heading"><strong>{needsChatName?'Enter your name to chat':'Edit your name'}</strong>{!needsChatName&&<button type="button" className="wb-icon" aria-label="Dismiss contact request" disabled={formBusy} onClick={dismissPrompt}><X size={16}/></button>}</div>
     <div className="wb-name-row"><label className="wb-label"><span className="wb-sr">First name</span><input required name="given-name" autoComplete="given-name" enterKeyHint="done" maxLength={80} value={draftName} onChange={e=>setDraftName(e.target.value)} placeholder="Your first name"/></label><button className="wb-primary" disabled={formBusy||!draftName.trim()}>{formBusy?'Saving…':needsChatName?'Join chat':'Save'}</button></div>
     {formError&&<p role="alert">{formError}</p>}
    </form>;
 if(vipWelcomeUrl)return <WebinarVipWelcome href={vipWelcomeUrl} fullScreen/>;
 if(!session&&!error&&!unavailable&&!previewLocked)return <div className="wb-room"><main className="wb-stage" aria-busy="true" aria-label="Webinar"><section className="wb-watch"><div className="wb-player"/></section><aside className="wb-side"><section className="wb-chat wb-entry-chat" aria-hidden="true"><div className="wb-chat-heading"><span><MessageCircle size={18}/><strong>Chat</strong></span></div></section></aside></main></div>;
 return <div className={`wb-room${focus.countdown?' wb-has-countdown':''}${inputActive?' wb-input-active':''}`} onFocusCapture={e=>{setInputActive(e.target.matches('input:not([type=checkbox]):not([type=radio]),textarea'));}} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setInputActive(false);}}>
  {session&&!isVip&&<dialog ref={exitDialog} className="wb-exit-dialog" aria-labelledby="wb-exit-title" aria-describedby="wb-exit-benefit" onClose={()=>{exitNavigation.current=null;}}>
   <span className="wb-eyebrow">BEFORE YOU GO</span>
   <h2 id="wb-exit-title">See what your AI bot could take off your plate.</h2>
   <p id="wb-exit-benefit">Stay to see how iCash X helps you find leads, follow up with sellers, and move deals forward—and how to get your own AI bot.</p>
   <div className="wb-exit-actions"><button type="button" className="wb-primary" autoFocus onClick={()=>exitDialog.current?.close()}>Keep watching</button><button type="button" className="wb-text" onClick={()=>{const leave=exitNavigation.current;exitDialog.current?.close();exitNavigation.current=null;leave?.();}}>Leave webinar</button></div>
  </dialog>}
  {session?.preview&&<nav className="wb-preview-tools" aria-label="Owner preview"><span>Owner preview</span>{currentOffer&&<button type="button" aria-controls="webinar-chat webinar-offer" onClick={()=>{setPreviewChatOfferId(previewChatVisible?'':currentOffer.id);setChatExpanded(true);setChatFocused(false);}}>{previewChatVisible?'Show offer':'Show chat'}</button>}{!isVip&&<button type="button" aria-haspopup="dialog" onClick={()=>{exitNavigation.current=null;exitDialog.current?.showModal();}}>Preview exit pop-up</button>}<a href={checkoutPreviewHref} target="_blank" rel="noopener noreferrer">After webinar · Didn’t buy ↗</a></nav>}
  <WebinarCountdownBanner countdown={focus.countdown}/>
  {!session?<main className="wb-empty"><span className="wb-eyebrow">{webinarSite.hostName} · {webinarSite.brandName}</span><h1>{unavailable?'Your next session is coming.':previewLocked?'Open the webinar.':'Let’s get you connected.'}</h1><p>{unavailable||error}</p>{previewLocked?<div className="ws-row-actions">{previewPublicPath&&<a className="wb-primary" href={previewPublicPath}>Watch webinar</a>}<a className="ws-secondary" href={`/dashboard-unlock?next=${encodeURIComponent(typeof location!=='undefined'?location.pathname+location.search:'/webinar-studio')}`}>Owner sign in</a></div>:error&&<button className="wb-primary" onClick={()=>void load()}>Try again</button>}{unavailable&&<a className="wb-primary" href="/">Open iCash X</a>}</main>:<main className={`wb-stage ${currentOffer?'wb-selling':''}`}>
   <section className="wb-watch">
    <h1 className="wb-sr">{w!.title}</h1>
    <WebinarPlayer key={session.sessionId} sessionId={session.sessionId} videoUrl={w!.videoUrl} posterUrl={w!.posterUrl} title={w!.title} progress={session.progress} preview={session.preview} overlay={<WebinarPanelBoundary quiet><WebinarPurchaseNotifications sessionId={session.sessionId} preview={session.preview} vip={isVip} replayPurchase={w!.purchaseNotifications.enabled?replayPurchase:null} enabled={w!.purchaseNotifications.enabled&&time>=Math.max(webinarPitchAt(w!),w!.purchaseNotifications.startAt??0)} intervalSeconds={w!.purchaseNotifications.intervalSeconds}/></WebinarPanelBoundary>} onPreviewSeek={previewSeek} onProgress={tick} onPlayingChange={setPlaying} onCheckpoint={()=>track(completionPending.current?'completed':'progress',true)} onStarted={()=>{if(!startSeen.current){startSeen.current=true;track('started');}}} onEnded={finishWebinar}/>
    {spots&&<div className={`wb-purchase-summary${isVip?' wb-purchase-summary-vip':''}`}><WebinarOfferSpots spots={spots} compact/></div>}
    <WebinarTimers timers={w!.timers} placement="video" seconds={time} now={timerState.now} deadlines={timerState.deadlines}/>
    {!saved&&<span className="wb-sr" role="status">Your progress will sync when the connection returns.</span>}
    {endCountdown!==null&&<div className="wb-prompt"><strong>Opening your next step in {endCountdown} seconds</strong><button className="wb-text" onClick={()=>setEndCountdown(null)}>Stay here</button></div>}
   </section>
   <aside className={`wb-side${paid?' wb-paid':''}`}><WebinarPanelBoundary label="Chat and offers">
    {currentOffer&&<section className="wb-offer" id="webinar-offer" hidden={previewChatVisible} tabIndex={-1} aria-label="Your next step"><div className="wb-panel-heading"><span className="wb-eyebrow">YOUR NEXT STEP</span></div>{available.length>1&&<div className="wb-offer-options" aria-label="Available offers">{available.map(offer=><button key={offer.id} disabled={checkoutEngaged} aria-pressed={currentOffer.id===offer.id} onClick={()=>{setSelectedOfferId(offer.id);track('pitch_shown',false,'offer:'+offer.id);}}>{offer.title}</button>)}</div>}<h2 ref={offerHeading}>{currentOffer.title}</h2>{currentOffer.description&&<p className="wb-offer-description">{currentOffer.description}</p>}<WebinarOfferImage offer={currentOffer} className="wb-offer-image"/>{currentOffer.action==='checkout'?<div className="wb-embedded-checkout"><WebinarPanelBoundary label="Checkout" fallbackHref={checkoutHref}><WebinarCheckout sessionId={session.sessionId} preview={session.preview} stayOnWebinar={session.ownerWatching} vipWebinar={isVip} phase={ended?'ended':'watching'} onPurchased={(state,vipSessionUrl)=>{purchasedRef.current=state;if(!session.preview&&!session.ownerWatching&&!isVip&&state==='standard'){const destination=safeVipSession(vipSessionUrl);if(destination){vipWelcomeRef.current=destination;track('progress',true);setVipWelcomeUrl(destination);setEndCountdown(null);}}setPaid(isVip?state==='vip':!!state);if(state&&(!isVip||state==='vip')){setChatExpanded(true);setContactEditing(false);}if(!session.preview)continuePurchase();}} onUpgradeActive={active=>{upgradeActiveRef.current=active;if(isVip){checkoutEngagedRef.current=active;setCheckoutEngaged(active);}if(!active)continuePurchase();}} onEngaged={()=>{checkoutEngagedRef.current=true;setCheckoutEngaged(true);setSelectedOfferId(currentOffer.id);setEndCountdown(null);track('add_to_cart');track('checkout_opened');track('checkout_opened',false,'offer:'+currentOffer.id);}}/></WebinarPanelBoundary></div>:<a className="wb-primary wb-offer-link" href={offerDestination(currentOffer)} onClick={event=>{if(!availableOffers(offers,position.current,Date.now()+timerState.offset).some(o=>o.id===currentOffer.id)){event.preventDefault();return;}if(event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey)checkoutEngagedRef.current=true;allowWebinarLinkNavigation(event);track('add_to_cart',true);track('checkout_opened',true);track('checkout_opened',true,'offer:'+currentOffer.id);track('progress',true);}}>{currentOffer.ctaLabel}</a>}<p className="wb-secure"><ShieldCheck size={14}/>Your video keeps playing while you review.</p></section>}
    {allOffersEnded&&time>=webinarPitchAt(w!)&&<section className="wb-offer"><h2>This session’s offers have ended.</h2><p>You can keep watching and use the chat.</p></section>}
    <section className={`wb-chat${chatCollapsed?' wb-chat-collapsed':''}`} id="webinar-chat" hidden={chatLocked} aria-labelledby="wb-chat-title" onFocusCapture={()=>setChatFocused(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setChatFocused(false);}}>
     <div className="wb-chat-heading"><span><MessageCircle size={18}/><h2 id="wb-chat-title" title="This chat includes prerecorded discussion and approved viewer messages. New messages are reviewed before being shared with other viewers.">Chat</h2></span><div className="wb-chat-heading-actions"><WebinarPanelBoundary quiet><WebinarAudience sessionId={session.sessionId} enabled={w!.showAudienceCount} preview={session.preview} playing={playing} display={w!.audienceDisplay} seconds={time} durationSeconds={w!.durationSeconds}/></WebinarPanelBoundary><button type="button" className="wb-icon" aria-label={chatCollapsed?'Expand chat':'Minimize chat'} aria-expanded={!chatCollapsed} aria-controls="wb-chat-body" onClick={()=>{setChatExpanded(chatCollapsed);setChatFocused(false);}}><ChevronDown size={18} style={{transform:chatCollapsed?'rotate(180deg)':undefined}}/></button></div></div>
     <div id="wb-chat-body" hidden={chatCollapsed}>
     <div className="wb-chat-log" ref={chatLog} role="log" aria-label="Session messages" tabIndex={0} onScroll={e=>{const log=e.currentTarget;followChat.current=log.scrollHeight-log.scrollTop-log.clientHeight<80;if(followChat.current)setUnread(false);}}>
      {stream.map(entry=>{
       if(entry.kind==='message'){const m=entry.message;return <article className="wb-message" key={entry.key} aria-label={entry.pending?'Sending your message':undefined}><div><b>{m.display_name||(m.shared?'Viewer':name||'You')}</b>{entry.pending&&<span className="wb-sr">Sending…</span>}<p>{m.text}</p></div></article>;}
       const c=entry.cue;
       return c.kind==='purchase'?<article className="wb-chat-purchase" key={entry.key}><span className="wb-activity-check"><Check size={17}/></span><div><strong>{recordedPurchaseMessage(c.name,isVip)}</strong>{c.location&&<span className="wb-chat-purchase-location">{c.location}</span>}<small>Recorded activity</small></div></article>:<article className="wb-message" key={entry.key}><div><b>{c.name}</b><p>{c.text.replace('Welcome! Ask a question here while you watch. The AI assistant can help with this session.','Welcome! Follow along and share your thoughts in the chat.').replaceAll('{{name}}',name||'there')}</p></div></article>;
      })}
     </div>
     {unread&&<button type="button" className="wb-new-messages" onClick={latestMessages}>New messages <ChevronDown size={14}/></button>}
     {nameForm}
     {!namePrompt&&<>{!isVip&&<div className="wb-chat-identity"><b>{name}</b><button type="button" disabled={formBusy} onClick={()=>{setDraftName(name);setEditingName(true);setFormError('');}}>Edit name</button></div>}
      <form className="wb-chat-composer" onFocusCapture={()=>{if(contactPrompt)setContactEditing(true);}} onSubmit={e=>{if(contactPrompt){e.preventDefault();if(!chatLocked)return saveContact(false);}else return send(e);}}>
       {contactPrompt&&<div className="wb-chat-contact-heading"><span id="wb-contact-label">{contactStep==='email'?'Add your email (optional)':'Add your phone (optional)'}</span><button type="button" className="wb-contact-skip" disabled={formBusy} onClick={skipContact}>Skip</button></div>}
       <div className="wb-chat-input">
        <label className="wb-sr" htmlFor="wb-question">{contactPrompt?(contactStep==='email'?'Email':'Phone'):'Send a message'}</label>
        <input ref={messageInput} id="wb-question" name={contactPrompt?(contactStep==='email'?'email':'tel'):'message'} type={contactPrompt?contactStep==='email'?'email':'tel':'text'} inputMode={contactPrompt?contactStep==='email'?'email':'tel':undefined} autoComplete={contactPrompt?contactStep==='email'?'email':'tel':'off'} autoCapitalize={contactPrompt?'none':undefined} spellCheck={contactPrompt?false:undefined} enterKeyHint={contactPrompt?contactStep==='email'?'next':'done':'send'} aria-describedby={contactPrompt?'wb-contact-label':undefined} required={contactPrompt} disabled={formBusy} value={contactPrompt?contactStep==='email'?email:phone:question} maxLength={contactPrompt?contactStep==='email'?254:25:1200} onChange={e=>{if(!contactPrompt){setQuestion(e.target.value);return;}setContactEditing(true);setFormError('');if(contactStep==='email'){setEmail(e.target.value);if(!e.target.value.trim())setConsent(false);}else{setPhone(e.target.value);if(!e.target.value.trim())setSmsConsent(false);}}} placeholder={contactPrompt?contactStep==='email'?'Your email (optional)':'Your phone (optional)':'Send a message…'}/>
        <button disabled={chatLocked||chatBusy||formBusy||!(contactPrompt?contactStep==='email'?email:phone:question).trim()} aria-label={contactPrompt?contactStep==='email'?'Save email':'Save phone':'Send message'}>{formBusy?<span aria-hidden="true">…</span>:<Send size={18}/>}</button>
       </div>
       {contactPrompt&&<div className="wb-chat-contact-details">{contactStep==='email'&&!!email.trim()&&<label className="wb-check"><input type="checkbox" checked={consent} disabled={formBusy} onChange={e=>setConsent(e.target.checked)}/><span>{webinarConsent}</span></label>}{contactStep==='phone'&&!!phone.trim()&&<label className="wb-check"><input type="checkbox" checked={smsConsent} disabled={formBusy} onChange={e=>setSmsConsent(e.target.checked)}/><span>{webinarSmsConsent}</span></label>}<a className="wb-privacy-link" href="/webinar/privacy" target="_blank" rel="noopener noreferrer">Privacy &amp; follow-ups</a>{formError&&<p className="wb-chat-note" role="alert">{formError}</p>}</div>}
      </form></>}
     {contactNotice&&<p className="wb-sr" role="status">{contactNotice}</p>}
     {chatError&&<p className="wb-chat-note" role="alert">{chatError}</p>}
     </div>
    </section>
   </WebinarPanelBoundary></aside>
  </main>}


 </div>;
}
