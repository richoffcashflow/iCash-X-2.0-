import assert from 'node:assert/strict';
import {newWebinar,publicWebinar} from '../lib/webinar-policy.ts';

// Real player/room recovery against intercepted local HTTP. No live providers.
export async function verifyWebinarRecovery(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});context.setDefaultTimeout(5000);
 const id='00000000-0000-4000-8000-000000000123',sessionId='00000000-0000-4000-8000-000000000456';
 const webinar=publicWebinar({...newWebinar(id),title:'Recovery fixture',status:'published',publicCode:'123456',videoUrl:base+'/fixture-stalled.mp4',durationSeconds:600,nameAt:0,contactAt:0,pitchAt:300,offers:[{id:'primary',at:300,title:'Continue to checkout',description:'',ctaLabel:'Continue',action:'checkout',url:'',expiresAt:null}],showAudienceCount:false});
 let completionAttempts=0,failCompletion=true,videoRequests=0;const held=new Set(),errors=[];
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==base)return route.abort();
  const json=body=>route.fulfill({json:body});
  if(url.pathname==='/api/webinar/start')return json({sessionId,webinar,progress:0,name:'Viewer',contactSaved:true,messages:[],preview:false,serverNow:Date.now()});
  if(url.pathname==='/api/webinar/chat/feed')return json({messages:[],statuses:[]});
  if(url.pathname==='/api/webinar/timers')return json({deadlines:{},offerDeadlines:{},serverNow:Date.now()});
  if(url.pathname==='/api/webinar/event'){
   if(route.request().postDataJSON().kind==='completed'&&route.request().resourceType()==='fetch'){
    completionAttempts++;
    if(failCompletion)return route.fulfill({status:503,json:{error:'Fixture interruption'}});
    return json({saved:true,redirect:'/fixture-checkout'});
   }
   return json({saved:true});
  }
  if(url.pathname==='/fixture-stalled.mp4'){
   videoRequests++;await new Promise(resolve=>held.add(resolve));
   return route.abort().catch(()=>{});
  }
  if(url.pathname==='/fixture-checkout')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Checkout recovered</title><p>Checkout recovered</p>'});
  if(url.pathname.startsWith('/api/'))return json({enabled:false,events:[],serverNow:Date.now()});
  return route.continue();
 });
 try{
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.install();
  await page.goto(base+'/live/123456',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Recovery fixture'}).waitFor({state:'attached'});
  await page.waitForFunction(()=>!!document.querySelector('video'));
  await page.clock.fastForward(13000);
  const resume=page.getByRole('button',{name:'Resume video',exact:true});await resume.waitFor({state:'visible'});
  const before=videoRequests;await resume.click();await page.waitForFunction(()=>document.querySelector('video')?.networkState===2);
  assert(videoRequests>before,'Resume reloads a video whose initial metadata never arrived');
  await page.close();
  for(const reconnect of [false,true]){
   failCompletion=true;completionAttempts=0;
   const end=await context.newPage();end.on('pageerror',e=>errors.push(e.message));await end.clock.install();
   await end.goto(base+'/live/123456',{waitUntil:'domcontentloaded'});
   await end.getByRole('heading',{name:'Recovery fixture'}).waitFor({state:'attached'});
   await end.locator('video').evaluate(video=>video.dispatchEvent(new Event('ended')));
   await end.waitForResponse(r=>r.url().endsWith('/api/webinar/event')&&r.request().postDataJSON().kind==='completed');
   assert.equal(completionAttempts,1);
   failCompletion=false;
   if(reconnect)await end.evaluate(()=>window.dispatchEvent(new Event('online')));
   else await end.clock.fastForward(4000);
   await end.waitForURL(base+'/fixture-checkout');assert.equal(completionAttempts,2,'A completion retry recovers the redirect without creating checkout twice');
   await end.close();
  }
  assert.deepEqual(errors,[]);
  console.log(`PASS ${name}: stalled initial video can reload; failed webinar completion recovers checkout after a bounded retry or reconnect.`);
 }finally{for(const resolve of held)resolve();await context.close();}
}
