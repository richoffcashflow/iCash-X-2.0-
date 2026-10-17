'use client';
import type {WebinarPixelRuntime} from './webinar-pixel';
export function webinarBrowserReady(sessionId:string,preview:boolean){
 if(preview)return;
 try{sessionStorage.setItem('icash-webinar-session',sessionId);}catch{/* Playback works without browser storage. */}
 window.dispatchEvent(new CustomEvent('icash-webinar-ready',{detail:{sessionId}}));
}
export type WebinarCommerce={product:'membership'|'vip_upgrade';checkoutId?:string;valueCents?:number};
export function webinarBrowserEvent(kind:'started'|'offer_viewed'|'contact_saved'|'add_to_cart'|'checkout_opened'|'checkout_started',sessionId?:string,commerce?:WebinarCommerce){
 try{sessionId=sessionId||sessionStorage.getItem('icash-webinar-session')||undefined;}catch{/* Optional measurement. */}
 // Direct checkout visitors have no webinar session. Use the existing page
 // event scope so their cart/checkout stages still deduplicate on this page.
 if(!sessionId&&commerce)sessionId=(window as Window&{icashWebinarPixel?:WebinarPixelRuntime}).icashWebinarPixel?.pageViewId||undefined;
 if(sessionId)window.dispatchEvent(new CustomEvent('icash-webinar-track',{detail:{sessionId,kind,commerce}}));
}
/** Give the receipt lookup a bounded chance to queue conversions before navigation.
 * No listener, ad blocking, or a measurement failure can hold up paid access. */
export async function webinarBrowserPurchaseReady(){
 const pending:Promise<unknown>[]=[];
 window.dispatchEvent(new CustomEvent('icash-webinar-payment-confirmed',{detail:{waitUntil:(promise:Promise<unknown>)=>pending.push(promise)}}));
 if(!pending.length)return;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([Promise.allSettled(pending),new Promise<void>(resolve=>{timer=setTimeout(resolve,2000);})]);}finally{clearTimeout(timer);}
}
