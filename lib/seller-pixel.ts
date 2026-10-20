export const sellerPixelId='1315986669737891';
export type SellerPixelRuntime={start:()=>void;registration:(eventId:string)=>void;address:(eventId:string)=>void};

// Bootstrap before hydration, scoped to the public seller form only. Explicit
// trackSingle calls keep HON conversions separate from the iCash webinar pixel.
export const sellerPixelBootstrap=String.raw`(function(w,d){
 if(w.homeOfferPixel)return;
 var id='${sellerPixelId}',initialized=false,pageSent=false,sent={};
 function page(){return /^(www\.)?(homeoffernetwork|geticashx)\.com$/.test(w.location.hostname)&&!new URLSearchParams(w.location.search).has('preview')&&(/^\/sell\/?$/.test(w.location.pathname)||(w.location.pathname==='/'&&/^(www\.)?homeoffernetwork\.com$/.test(w.location.hostname)));}
 function blocked(){return w.navigator.globalPrivacyControl===true;}
 function start(){
  if(!page()||blocked())return;
  if(!w.fbq){!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(w,d,'script','https://connect.facebook.net/en_US/fbevents.js');}
  if(!initialized){w.fbq('set','autoConfig',false,id);w.fbq('init',id);initialized=true;}
  if(!pageSent){w.fbq('trackSingle',id,'PageView',{}, {eventID:'homeoffer:page:'+w.crypto.randomUUID()});pageSent=true;}
 }
 function conversion(eventId,name,custom){
  if(!page()||blocked()||!/^keypath:[a-f0-9-]{36}$/.test(eventId)||sent[eventId])return;
  try{if(w.localStorage.getItem('hon-meta:'+eventId)==='1')return;}catch(e){}
  start();if(!initialized)return;
  w.fbq(custom?'trackSingleCustom':'trackSingle',id,name,{}, {eventID:eventId});sent[eventId]=true;
  try{w.localStorage.setItem('hon-meta:'+eventId,'1');}catch(e){}
 }
 w.homeOfferPixel={start:start,registration:function(eventId){conversion(eventId,'CompleteRegistration',false);},address:function(eventId){conversion(eventId,'PropertyAddressConfirmed',true);}};
 start();
})(window,document);`;
