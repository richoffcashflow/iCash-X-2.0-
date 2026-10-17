export type WebinarPresence={pageId:string;sequence:number;stage:'webinar'|'checkout'|'vip';state:'active'|'left'|'handoff'|'payment'};
let pageId:string|undefined,sequence=0;
/** One page identity survives React effect remounts; late beacons cannot undo a return. */
export function installWebinarPresence(touch:(presence:WebinarPresence)=>void,doc:Pick<Document,'hidden'|'addEventListener'|'removeEventListener'|'activeElement'>=document,win:Pick<Window,'addEventListener'|'removeEventListener'|'setInterval'|'clearInterval'>=window,initialStage:WebinarPresence['stage']='webinar'){
 pageId??=crypto.randomUUID();let stage=initialStage,handoff:WebinarPresence['state']|null=null;
 const send=(state:WebinarPresence['state'])=>touch({pageId:pageId!,sequence:++sequence,stage,state});
 const visible=()=>{if(!doc.hidden){handoff=null;send('active');}};
 const changed=()=>{if(doc.hidden)send(handoff??(stage==='checkout'&&doc.activeElement?.tagName==='IFRAME'?'payment':'left'));else visible();};
 const leave=()=>send(handoff??'left');
 const checkout=()=>{if(stage!=='vip'){stage='checkout';visible();}};
 const navigation=(event:Event)=>{const path=(event as CustomEvent<string>).detail;try{const url=new URL(path,window.location.href);if(url.origin===window.location.origin&&(/^\/(live\/|webinar(?:\/|$))/.test(url.pathname)||url.pathname==='/workspace')){handoff='handoff';send(handoff);}else if(url.protocol==='https:'&&url.hostname==='checkout.stripe.com'){stage='checkout';handoff='payment';send(handoff);}}catch{}};
 visible();const timer=win.setInterval(visible,30000);
 doc.addEventListener('visibilitychange',changed);win.addEventListener('pagehide',leave);win.addEventListener('pageshow',visible);win.addEventListener('icash-webinar-checkout',checkout);win.addEventListener('icash-webinar-navigation',navigation);
 return()=>{win.clearInterval(timer);doc.removeEventListener('visibilitychange',changed);win.removeEventListener('pagehide',leave);win.removeEventListener('pageshow',visible);win.removeEventListener('icash-webinar-checkout',checkout);win.removeEventListener('icash-webinar-navigation',navigation);};
}
