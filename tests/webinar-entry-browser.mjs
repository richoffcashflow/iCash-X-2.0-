import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join,basename} from 'node:path';
import {newWebinar,publicWebinar} from '../lib/webinar-policy.ts';

// Hold the actual production room bundle, proving entry is independent of its
// download. All API/media responses are fixtures; no live records or providers.
export async function verifyWebinarEntry(browser,base,options,name){
 const chunks=join(process.cwd(),'.next/static/chunks');
 const roomChunks=new Set(readdirSync(chunks,{recursive:true}).filter(file=>file.endsWith('.js')&&readFileSync(join(chunks,file),'utf8').includes('wb-has-countdown')).map(file=>basename(file)));
 assert.ok(roomChunks.size,'The built room must be independently loadable');
 for(const failure of [false,true]){
  const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
  context.setDefaultTimeout(10000);
  const sessionId='00000000-0000-4000-8000-000000000456';
  const webinar=publicWebinar({...newWebinar('00000000-0000-4000-8000-000000000123'),title:'Fast entry fixture',publicCode:'123456',status:'published',videoUrl:base+'/fixture-entry.webm',durationSeconds:30,nameAt:0,contactAt:0,pitchAt:25,showAudienceCount:false});
  const clip=readFileSync(new URL('./fixtures/webinar-autoplay.webm',import.meta.url));
  let releaseRoom,entrySeen,startCalls=0,held=0;
  const roomReady=new Promise(resolve=>{releaseRoom=resolve;});
  const requested=new Promise(resolve=>{entrySeen=resolve;});
  const errors=[];
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==base)return route.abort();
   if(roomChunks.has(basename(url.pathname))){held++;await roomReady;return route.continue();}
   if(url.pathname==='/api/webinar/start'){
    startCalls++;entrySeen();
    assert.equal(route.request().postDataJSON().code,'123456');
    if(failure&&startCalls===1)return route.fulfill({status:503,json:{error:'Entry fixture unavailable'}});
    return route.fulfill({json:{sessionId,webinar,progress:0,name:'Viewer',messages:[],preview:false,serverNow:Date.now()}});
   }
   if(url.pathname==='/fixture-entry.webm')return route.fulfill({contentType:'video/webm',body:clip});
   if(url.pathname==='/api/webinar/chat/feed')return route.fulfill({json:{messages:[],statuses:[]}});
   if(url.pathname==='/api/webinar/timers')return route.fulfill({json:{deadlines:{},offerDeadlines:{},serverNow:Date.now()}});
   if(url.pathname.startsWith('/api/'))return route.fulfill({json:{saved:true,enabled:false,events:[],serverNow:Date.now()}});
   return route.continue();
  });
  let guard;
  try{
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.goto(base+'/live/123456',{waitUntil:'domcontentloaded'});
   await Promise.race([requested,new Promise((_resolve,reject)=>{guard=setTimeout(()=>reject(Error('Entry waited for the room bundle')),5000);})]);clearTimeout(guard);
   assert.equal(startCalls,1);assert.equal(await page.locator('video').count(),0,'The session begins before the room/player code arrives');
   releaseRoom();
   if(failure){await page.getByText('Entry fixture unavailable',{exact:true}).waitFor();assert.equal(startCalls,1,'An early error does not automatically retry');await page.getByRole('button',{name:'Try again',exact:true}).click();}
   await page.getByRole('heading',{name:'Fast entry fixture',exact:true}).waitFor({state:'attached'}).catch(async error=>{console.error(name,{failure,startCalls,held,errors,body:await page.locator('body').innerText()});throw error;});
   assert.ok(held>0,'The production room chunk was held');assert.equal(startCalls,failure?2:1,'Hydration consumes the same entry result; only an explicit retry posts again');
   assert.deepEqual(errors,[]);
  }finally{clearTimeout(guard);releaseRoom();await context.close();}
 }
 console.log(`PASS ${name}: session starts before the held room bundle, hydration shares one request, and an early failure retains explicit retry.`);
}
