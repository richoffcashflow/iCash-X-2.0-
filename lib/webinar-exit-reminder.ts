// A browser-owned confirmation, once per tab session, for the paid VIP journey.
// No mouse, visibility or history interception; blocked storage fails open.
const seenKey='icash.webinar.vip-exit-reminder.v1';
const active=new Set<()=>void>();
let reminded=false;

export function installWebinarExitReminder(canRemind:()=>boolean=()=>true){
 const nothing=()=>{};
 if(typeof window==='undefined'||reminded)return nothing;
 try{if(sessionStorage.getItem(seenKey))return nothing;}catch{return nothing;}
 const stop=()=>{window.removeEventListener('beforeunload',leave);active.delete(stop);};
 const leave=(event:BeforeUnloadEvent)=>{
  if(!event.isTrusted||navigator.userActivation?.hasBeenActive===false||!canRemind())return;
  // Persist before asking so choosing Stay, refreshing or remounting cannot loop.
  try{
   if(reminded||sessionStorage.getItem(seenKey)){stop();return;}
   sessionStorage.setItem(seenKey,'1');
  }catch{stop();return;}
  reminded=true;stop();
  event.preventDefault();event.returnValue='1';
 };
 active.add(stop);window.addEventListener('beforeunload',leave);
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
