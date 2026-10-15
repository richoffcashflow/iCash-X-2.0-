// One reminder across the regular webinar, payment handoff and VIP journey.
// Keep the existing key so a previously dismissed VIP reminder stays dismissed.
const seenKey='icash.webinar.vip-exit-reminder.v1';
const active=new Set<()=>void>();
let reminded=false;

type ExitNavigation=Event&{userInitiated:boolean;navigationType:string;hashChange:boolean;formData:FormData|null;downloadRequest:string|null;destination:{url:string;key:string}};
type BrowserNavigation=EventTarget&{traverseTo:(key:string)=>{finished:Promise<unknown>}};

export function installWebinarExitReminder(canRemind:()=>boolean=()=>true,confirmNavigation?:(leave:()=>void)=>boolean){
 const nothing=()=>{};
 if(typeof window==='undefined'||reminded)return nothing;
 try{if(sessionStorage.getItem(seenKey))return nothing;}catch{return nothing;}
 const navigation=(window as Window&{navigation?:BrowserNavigation}).navigation;
 const stop=()=>{
  window.removeEventListener('beforeunload',leave);
  if(confirmNavigation){document.removeEventListener('click',click);navigation?.removeEventListener('navigate',navigate);}
  active.delete(stop);
 };
 const claim=()=>{
  if(navigator.userActivation?.hasBeenActive===false||!canRemind())return false;
  // Persist before asking so Stay, Back, refreshing or entering VIP cannot loop.
  try{
   if(reminded||sessionStorage.getItem(seenKey)){stop();return false;}
   sessionStorage.setItem(seenKey,'1');
  }catch{stop();return false;}
  reminded=true;allowWebinarNavigation();return true;
 };
 const leave=(event:BeforeUnloadEvent)=>{
  if(!event.isTrusted||!claim())return;
  event.preventDefault();event.returnValue='1';
 };
 const ask=(proceed:()=>void)=>{
  if(!confirmNavigation||!claim())return false;
  try{return confirmNavigation(proceed);}catch{return false;}
 };
 const click=(event:MouseEvent)=>{
  if(!event.isTrusted||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const link=event.target instanceof Element?event.target.closest('a[href]'):null;
  if(!(link instanceof HTMLAnchorElement)||link.hasAttribute('download')||(link.target&&link.target!=='_self'))return;
  const url=new URL(link.href),current=new URL(window.location.href);
  if(!['https:','http:'].includes(url.protocol)||(url.origin===current.origin&&url.pathname===current.pathname&&url.search===current.search))return;
  if(ask(()=>navigateWebinar(url.href)))event.preventDefault();
 };
 const navigate=(raw:Event)=>{
  const event=raw as ExitNavigation;
  if(!event.isTrusted||!event.userInitiated||!event.cancelable||event.defaultPrevented||event.hashChange||event.formData||event.downloadRequest!=null||event.navigationType==='reload')return;
  const url=new URL(event.destination.url);
  if(!['https:','http:'].includes(url.protocol))return;
  const proceed=()=>{
   allowWebinarNavigation();
   if(event.navigationType==='traverse'&&navigation&&event.destination.key){
    try{void navigation.traverseTo(event.destination.key).finished.catch(()=>navigateWebinar(url.href,true));return;}catch{}
   }
   navigateWebinar(url.href,event.navigationType==='replace'||event.navigationType==='traverse');
  };
  if(ask(proceed))event.preventDefault();
 };
 active.add(stop);window.addEventListener('beforeunload',leave);
 if(confirmNavigation){document.addEventListener('click',click);navigation?.addEventListener('navigate',navigate);}
 return stop;
}

/** Intended next steps must never display the exit confirmation. */
export function allowWebinarNavigation(){for(const stop of active)stop();}
export function allowWebinarLinkNavigation(event:Pick<MouseEvent,'button'|'defaultPrevented'|'metaKey'|'ctrlKey'|'shiftKey'|'altKey'>){
 if(!event.defaultPrevented&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey)allowWebinarNavigation();
}
export function navigateWebinar(path:string,replace=false){
 allowWebinarNavigation();
 if(replace)window.location.replace(path);else window.location.assign(path);
}
