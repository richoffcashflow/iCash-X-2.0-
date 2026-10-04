'use client';
export function webinarBrowserReady(sessionId:string,preview:boolean){
 if(preview)return;
 try{sessionStorage.setItem('icash-webinar-session',sessionId);}catch{/* Playback works without browser storage. */}
 window.dispatchEvent(new CustomEvent('icash-webinar-ready',{detail:{sessionId}}));
}
export function webinarBrowserEvent(kind:'started'|'contact_saved'|'add_to_cart'|'checkout_opened'|'checkout_started',sessionId?:string){
 try{sessionId=sessionId||sessionStorage.getItem('icash-webinar-session')||undefined;}catch{/* Optional measurement. */}
 if(sessionId)window.dispatchEvent(new CustomEvent('icash-webinar-track',{detail:{sessionId,kind}}));
}
