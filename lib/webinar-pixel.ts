export type WebinarPixelConfig={enabled:boolean;pixelId?:string;trackingAllowed?:boolean;consent?:boolean};
export type WebinarPixelRuntime={path:string;pageViewId:string;sentPageView:string;pixelId:string;ready:Promise<WebinarPixelConfig|null>|null;start:(force?:boolean)=>Promise<WebinarPixelConfig|null>};
const measurementPaths=['/','/join','/webinar','/webinar/checkout','/webinar/upgrade'];
export function webinarMeasurementPath(path:string){return measurementPaths.includes(path)||/^\/live\/\d{6,12}\/?$/.test(path);}

// Runs from the document head, before React or the webinar session request.
// Public purchase and webinar pages share one pixel. The homepage must first
// confirm it is showing the guest checkout, since / also hosts the workspace.
export const webinarPixelBootstrap=String.raw`(function(w,d){
 if(w.icashWebinarPixel)return;
 function page(){var path=w.location.pathname;return (/^\/live\/\d{6,12}\/?$/.test(path)||${JSON.stringify(measurementPaths)}.indexOf(path)!==-1)&&!new URLSearchParams(w.location.search).has('preview')&&(path!=='/'||!!d.querySelector('[data-public-checkout="true"]'));}
 function get(key){try{return w.localStorage.getItem(key);}catch(e){return null;}}
 function blocked(){return !!w.navigator.globalPrivacyControl||get('wb-meta-choice')==='deny';}
 var state=w.icashWebinarPixel={path:'',pageViewId:'',sentPageView:'',pixelId:'',ready:null,start:function(force){
  if(!page())return Promise.resolve(null);
  var path=w.location.pathname;
  if(state.path===path&&state.ready&&!force)return state.ready;
  if(state.path!==path){state.path=path;state.pageViewId='webinar:page:'+w.crypto.randomUUID();}
  var id=state.pageViewId;
  if(blocked()){if(w.fbq)w.fbq('consent','revoke');return state.ready=Promise.resolve({enabled:true,trackingAllowed:false});}
  state.ready=w.fetch('/api/webinar/pixel?page='+encodeURIComponent(w.location.pathname+w.location.search),{cache:'no-store',signal:AbortSignal.timeout(8000)}).then(function(response){if(!response.ok)throw Error('Pixel configuration unavailable');return response.json();}).then(function(config){
   if(!page()||state.path!==path)return null;
   if(blocked())return Object.assign({},config,{trackingAllowed:false});
   if(!config.enabled||!config.trackingAllowed||!/^\d{5,25}$/.test(config.pixelId||''))return config;
   if(!w.fbq){
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(w,d,'script','https://connect.facebook.net/en_US/fbevents.js');
   }
   if(state.pixelId!==config.pixelId){w.fbq('set','autoConfig',false,config.pixelId);w.fbq('init',config.pixelId);state.pixelId=config.pixelId;}
   w.fbq('consent','grant');
   if(state.sentPageView!==id&&get('wb-meta:'+id)!=='1'){w.fbq('trackSingle',config.pixelId,'PageView',{}, {eventID:id});state.sentPageView=id;try{w.localStorage.setItem('wb-meta:'+id,'1');}catch(e){}}
   return config;
  }).catch(function(){return null;});
  return state.ready;
 }};
 state.start();
})(window,document);`;
