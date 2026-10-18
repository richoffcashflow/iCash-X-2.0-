import {reminderHintCookie,reminderPage} from './webinar-reminder-policy.ts';
type Signal={action:'visit'}|{action:'watch';sessionId:string};
const denied=()=>{
 if((navigator as Navigator&{globalPrivacyControl?:boolean}).globalPrivacyControl)return true;
 try{return localStorage.getItem('wb-meta-choice')==='deny';}catch{return false;}
};
/** A redirect/preview is not a confirmed click: the landing page must be visible. */
export function installReminderTracking(send:(input:Signal)=>Promise<boolean>){
 const hint=document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith(reminderHintCookie+'='))?.slice(reminderHintCookie.length+1);
 if(!hint||!/^[0-9a-f-]{36}$/i.test(hint)||!reminderPage(location.pathname,location.search)||denied())return()=>{};
 let stopped=false,confirmed=false,watchSent=false,session:string|undefined,timer:ReturnType<typeof setTimeout>|undefined,attempts=0;
 const active=()=>!stopped&&!document.hidden&&!denied()&&reminderPage(location.pathname,location.search)&&(location.pathname!=='/'||!!document.querySelector('[data-public-checkout="true"]'));
 const watch=async()=>{
  if(!confirmed||!session||watchSent||!active())return;watchSent=true;
  try{if(!await send({action:'watch',sessionId:session}))watchSent=false;}catch{watchSent=false;}
 };
 const confirm=async()=>{
  if(!active()||confirmed||attempts>=3)return;attempts++;
  try{confirmed=await send({action:'visit'});}catch{/* A later visible check can retry. */}
  if(confirmed)void watch();else if(active()&&attempts<3)timer=setTimeout(()=>void confirm(),3000);
 };
 const visible=()=>{clearTimeout(timer);if(active()){if(confirmed)void watch();else timer=setTimeout(()=>void confirm(),1500);}};
 const played=(event:Event)=>{const d=(event as CustomEvent<{kind:string;sessionId:string}>).detail;if(d?.kind==='started'&&/^[0-9a-f-]{36}$/i.test(d.sessionId)){session=d.sessionId;void watch();}};
 document.addEventListener('visibilitychange',visible);window.addEventListener('icash-webinar-track',played);window.addEventListener('icash-public-checkout-change',visible);visible();
 return()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('icash-webinar-track',played);window.removeEventListener('icash-public-checkout-change',visible);};
}
