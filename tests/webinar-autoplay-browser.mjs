import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newWebinar,publicWebinar} from '../lib/webinar-policy.ts';

// Real decoding/playback with synthetic 30-second clips. All APIs
// are local fixtures; no viewer records, messages, payments or providers change.
export async function verifyWebinarAutoplay(browser,base,options,name){
 const format=browser.browserType().name()==='webkit'?'mp4':'webm';
 const clip=readFileSync(new URL(`./fixtures/webinar-autoplay.${format}`,import.meta.url));
 for(const policy of ['native','muted']){
  const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
  context.setDefaultTimeout(10000);
  const id='00000000-0000-4000-8000-000000000123',sessionId='00000000-0000-4000-8000-000000000456';
  const webinar=publicWebinar({...newWebinar(id),title:'Autoplay fixture',status:'published',publicCode:'123456',videoUrl:base+`/fixture-autoplay.${format}`,durationSeconds:30,nameAt:0,contactAt:0,pitchAt:25,showAudienceCount:false});
  const errors=[];let releaseVideo,videoRequested;
  const requested=new Promise(resolve=>{videoRequested=resolve;});
  const ready=new Promise(resolve=>{releaseVideo=resolve;});
  await context.addInitScript(({policy})=>{
   window.__playCalls=[];
   const play=HTMLMediaElement.prototype.play;
   HTMLMediaElement.prototype.play=function(){
    window.__playCalls.push(this.muted);
    // Deterministically exercise the policy fallback, then use native playback.
    if(policy==='muted'&&window.__playCalls.length===1&&!this.muted)return Promise.reject(new DOMException('Sound needs a gesture','NotAllowedError'));
    return play.call(this);
   };
  },{policy});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==base)return route.abort();
   const json=body=>route.fulfill({json:body});
   if(url.pathname==='/api/webinar/start')return json({sessionId,webinar,progress:3,name:'Viewer',contactSaved:true,messages:[],preview:false,serverNow:Date.now()});
   if(url.pathname==='/api/webinar/chat/feed')return json({messages:[],statuses:[]});
   if(url.pathname==='/api/webinar/timers')return json({deadlines:{},offerDeadlines:{},serverNow:Date.now()});
   if(url.pathname==='/api/webinar/event')return json({saved:true});
   if(url.pathname===`/fixture-autoplay.${format}`){
    videoRequested();await ready;
    const range=/^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range??'');
    const start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),clip.length-1):clip.length-1;
    return route.fulfill({status:range?206:200,contentType:`video/${format}`,headers:{'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${clip.length}`}:{})},body:clip.subarray(start,end+1)});
   }
   if(url.pathname.startsWith('/api/'))return json({enabled:false,events:[],serverNow:Date.now()});
   return route.continue();
  });
  try{
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.goto(base+'/live/123456',{waitUntil:'domcontentloaded'});await requested;
   assert.equal(await page.getByRole('button',{name:/Tap to play|Continue watching|Tap for sound/}).count(),0,'Loading never becomes a tap-to-play gate');
   releaseVideo();
   await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>3.2;}).catch(async error=>{
    console.error(name,policy,await page.locator('video').evaluate(v=>({paused:v.paused,muted:v.muted,time:v.currentTime,ready:v.readyState,network:v.networkState,error:v.error?.message,calls:window.__playCalls,hidden:document.hidden,mp4:v.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')})),errors);
    throw error;
   });
   const state=await page.locator('video').evaluate(v=>({autoPlay:v.autoplay,inline:v.playsInline,muted:v.muted,time:v.currentTime,calls:window.__playCalls}));
   assert.equal(state.autoPlay,true);assert.equal(state.inline,true);assert.equal(state.calls[0],false,'Sound is attempted first');
   if(policy==='muted'){assert.equal(state.muted,true);assert.deepEqual(state.calls.slice(0,2),[false,true]);}
   if(state.muted){
    await page.getByRole('button',{name:'Tap for sound',exact:true}).click();
    await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.muted&&!v.paused;});
    assert.equal(await page.getByRole('button',{name:'Tap for sound',exact:true}).count(),0);
   }
   const before=await page.locator('video').evaluate(v=>{window.__sameVideo=v;return v.currentTime;});
   await page.waitForFunction(time=>document.querySelector('video')?.currentTime>time+1,before);
   assert.equal(await page.locator('video').evaluate(v=>v===window.__sameVideo),true,'Progress rerenders preserve the playing media element');
   assert.deepEqual(errors,[]);
  }finally{releaseVideo();await context.close();}
 }
 console.log(`PASS ${name}: native video autoplays, sound falls back to muted, one tap enables sound without restart, loading has no Play gate, and playback remains mounted.`);
}
