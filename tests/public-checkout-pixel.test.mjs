import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import {webinarPixelBootstrap,webinarMeasurementPath} from '../lib/webinar-pixel.ts';
import {webinarBrowserEvent} from '../lib/webinar-browser-events.ts';

function page(path,{checkout=false,search='',denied=false,gpc=false,allowed=true}={}){
 const stored=new Map(denied?[['wb-meta-choice','deny']]:[]),scripts=[];let reads=0,sequence=0;
 const document={querySelector:()=>checkout?{}:null,createElement:()=>({}),getElementsByTagName:()=>[{parentNode:{insertBefore:script=>scripts.push(script)}}]};
 const window={location:{pathname:path,search},navigator:{globalPrivacyControl:gpc},crypto:{randomUUID:()=>String(++sequence)},localStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)},fetch:async()=>{reads++;return {ok:true,json:async()=>({enabled:true,pixelId:'1104248230721457',trackingAllowed:allowed})};}};
 runInNewContext(webinarPixelBootstrap,{window,document,URLSearchParams,AbortSignal});
 return {window,document,scripts,get reads(){return reads;},events:()=>window.fbq?.queue.filter(call=>call[0]==='trackSingle')??[]};
}

test('homepage waits for the public checkout, then shares one pixel with VIP',async()=>{
 const p=page('/');
 assert.equal(p.reads,0,'Loading and signed-in workspaces never request the pixel');
 p.document.querySelector=()=>({});
 await p.window.icashWebinarPixel.start();
 assert.equal(p.scripts.length,1);assert.equal(p.events().length,1);
 assert.equal(p.events()[0][2],'PageView');
 await p.window.icashWebinarPixel.start();await p.window.icashWebinarPixel.start(true);
 assert.equal(p.events().length,1,'Refresh and React hydration cannot duplicate PageView');
 p.window.location.pathname='/webinar/upgrade';await p.window.icashWebinarPixel.start();
 assert.equal(p.events().length,2);assert.equal(p.scripts.length,1);
 assert.equal(p.window.fbq.queue.filter(call=>call[0]==='init').length,1);
 p.window.location.pathname='/';p.document.querySelector=()=>null;
 const reads=p.reads;await p.window.icashWebinarPixel.start(true);
 assert.equal(p.reads,reads,'Signing in excludes the private workspace again');
});

test('homepage, direct checkout, VIP checkout and both webinar types load the shared pixel',async()=>{
 for(const path of ['/','/join','/webinar/checkout','/webinar/upgrade','/webinar','/live/123456','/live/123457']){
  assert.equal(webinarMeasurementPath(path),true);
  const p=page(path,{checkout:true});await p.window.icashWebinarPixel.ready;
  assert.equal(p.events().length,1,path);assert.equal(p.events()[0][1],'1104248230721457');
 }
});

test('private routes, previews, opt-outs, GPC and restricted regions remain excluded',async()=>{
 for(const path of ['/admin','/course','/support','/preview/workspace','/dashboard-unlock','/webinar/checkout/preview','/sell']){
  assert.equal(webinarMeasurementPath(path),false);
  const p=page(path,{checkout:true});await p.window.icashWebinarPixel.ready;
  assert.equal(p.reads,0,path);assert.equal(p.scripts.length,0,path);
 }
 for(const options of [{search:'?preview=fixture'},{denied:true},{gpc:true},{allowed:false}]){
  for(const path of ['/','/webinar/upgrade']){
   const p=page(path,{checkout:true,...options});await p.window.icashWebinarPixel.ready;
   assert.equal(p.scripts.length,0);assert.equal(p.events().length,0);
  }
 }
});

test('direct Standard and VIP checkout stages do not require a webinar session',()=>{
 const priorWindow=globalThis.window,priorStorage=globalThis.sessionStorage,events=[];
 let saved=null;
 try{
  globalThis.window={icashWebinarPixel:{pageViewId:'webinar:page:direct'},dispatchEvent:event=>events.push(event.detail)};
  globalThis.sessionStorage={getItem:()=>saved};
  for(const product of ['membership','vip_upgrade'])for(const kind of ['add_to_cart','checkout_started'])webinarBrowserEvent(kind,undefined,{product,checkoutId:'cs_live_fixture',valueCents:5000});
  assert.equal(events.length,4);assert(events.every(event=>event.sessionId==='webinar:page:direct'));
  webinarBrowserEvent('started');assert.equal(events.length,4,'A checkout visit does not fabricate a webinar start');
  saved='real-webinar';webinarBrowserEvent('add_to_cart',undefined,{product:'membership'});
  assert.equal(events.at(-1).sessionId,'real-webinar');
  webinarBrowserEvent('checkout_started','explicit-webinar',{product:'vip_upgrade'});
  assert.equal(events.at(-1).sessionId,'explicit-webinar');
 }finally{
  if(priorWindow===undefined)delete globalThis.window;else globalThis.window=priorWindow;
  if(priorStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=priorStorage;
 }
});
