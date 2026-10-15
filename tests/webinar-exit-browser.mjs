// Real browser departure events against the production reminder module. No providers.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {chromium} from 'playwright';
import {newWebinar,publicWebinar} from '../lib/webinar-policy.ts';

// Real React room and CSS with local API fixtures; no billing or provider access.
export async function verifyRegularWebinarRoom(browser,base,options={}){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});context.setDefaultTimeout(10000);
 const webinar=publicWebinar({...newWebinar('00000000-0000-4000-8000-000000000123'),title:'Exit reminder fixture',videoUrl:base+'/fixture-video.mp4',status:'published',publicCode:'123456',showAudienceCount:false});
 const errors=[];
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!==base)return route.abort();
  const json=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  if(url.pathname==='/api/webinar/start')return json({sessionId:'00000000-0000-4000-8000-000000000456',webinar,progress:0,name:'Viewer',contactSaved:true,messages:[],preview:false,serverNow:Date.now()});
  if(url.pathname==='/api/webinar/chat/feed')return json({messages:[],statuses:[]});
  if(url.pathname==='/api/webinar/event')return json({saved:true});
  if(url.pathname==='/api/webinar/timers')return json({deadlines:{},offerDeadlines:{},serverNow:Date.now()});
  if(url.pathname.startsWith('/api/'))return json({});
  if(url.pathname==='/fixture-away')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Left webinar</title><p>Left webinar</p>'});
  if(url.pathname==='/fixture-video.mp4')return route.fulfill({status:404,body:''});
  return route.continue();
 });
 try{
  for(const choice of ['Keep watching','Leave webinar']){
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));let nativePrompts=0;page.on('dialog',async d=>{nativePrompts++;await d.dismiss();});
   await page.goto(base+'/live/123456');
   try{await page.getByRole('heading',{name:webinar.title}).waitFor({state:'attached'});}catch(error){throw Error(`${error.message}\n${page.url()}\n${await page.locator('body').innerText()}\n${errors.join('\n')}`);}
   // A normal departing link exercises actual pointer navigation through the room.
   await page.evaluate(()=>{const a=document.createElement('a');a.href='/fixture-away';a.id='fixture-exit';a.textContent='Return to site';document.body.prepend(a);});
   const dialog=page.getByRole('dialog');assert.equal(await dialog.isVisible(),false);
   await page.mouse.move(0,0);await page.mouse.wheel(0,100);assert.equal(await dialog.isVisible(),false);
   await page.locator('#fixture-exit').click();await dialog.waitFor({state:'visible'});
   assert.match(await dialog.innerText(),/find leads, follow up with sellers, and move deals forward/);
   assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Keep watching');
   const box=await dialog.boundingBox(),viewport=page.viewportSize();assert.ok(box.x>=0&&box.x+box.width<=viewport.width&&box.y>=0&&box.y+box.height<=viewport.height,'Benefit and both choices fit the viewport');
   if(process.env.WEBINAR_EXIT_SCREENSHOT&&choice==='Keep watching')await page.screenshot({path:process.env.WEBINAR_EXIT_SCREENSHOT});
   await dialog.getByRole('button',{name:choice,exact:true}).click();
   if(choice==='Keep watching'){
    await dialog.waitFor({state:'hidden'});assert.equal(page.url(),base+'/live/123456');
    await page.reload();await page.getByRole('heading',{name:webinar.title}).waitFor({state:'attached'});
    await page.evaluate(()=>{const a=document.createElement('a');a.href='/fixture-away';a.id='fixture-exit';a.textContent='Return to site';document.body.prepend(a);});
    await page.locator('#fixture-exit').click();
   }
   await page.waitForURL(base+'/fixture-away');assert.equal(nativePrompts,0,'Custom and native confirmations never stack');await page.close();
  }
  assert.deepEqual(errors,[]);console.log('PASS regular webinar benefit: actual room, accessible dialog, Stay/Leave, reload persistence, viewport fit, and no stacked native warning.');
 }finally{await context.close();}
}

export async function verifyWebinarExit(browser){
 const origin='https://webinar-exit.example.test';
 const code=ts.transpileModule(readFileSync(new URL('../lib/webinar-exit-reminder.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const context=await browser.newContext();context.setDefaultTimeout(5000);
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());assert.equal(url.origin,origin);
  if(url.pathname==='/reminder.js')return route.fulfill({contentType:'text/javascript',body:code});
  const custom=url.pathname==='/regular'?`leave=>{document.querySelector('#benefit').showModal();document.querySelector('#leave').onclick=leave;return true;}`:'undefined';
  const script=url.pathname==='/away'?'':`<script type="module">import {installWebinarExitReminder,navigateWebinar} from '/reminder.js';installWebinarExitReminder(()=>true,${custom});document.querySelector('#next').onclick=()=>navigateWebinar('/next');window.ready=true;</script>`;
  return route.fulfill({contentType:'text/html',body:`<!doctype html><html><body><button id="play">Keep watching</button><button id="next">Watch VIP now</button><dialog id="benefit"><p>See your AI bot in action.</p><button id="leave">Leave webinar</button></dialog><div style="height:1500px"></div>${script}</body></html>`});
 });
 async function open(path='/watch'){
  const page=await context.newPage();await page.goto(origin+path);
  if(path!=='/away')await page.waitForFunction(()=>window.ready);return page;
 }
 async function attempt(page,action,accept=false){
  const dialogReady=page.waitForEvent('dialog');
  const pending=Promise.resolve().then(action).catch(error=>{assert.match(error.message,/ERR_ABORTED|Navigation.*cancelled/i);});
  const dialog=await dialogReady;assert.equal(dialog.type(),'beforeunload');
  if(accept)await dialog.accept();else await dialog.dismiss();await pending;
 }
 try{
  // A real tab close asks once; Stay keeps the page, and refresh/remount cannot rearm it.
  const page=await open();let prompts=0;page.on('dialog',()=>prompts++);
  await page.getByText('Keep watching',{exact:true}).click();
  await page.mouse.move(0,0);await page.mouse.wheel(0,300);
  await page.evaluate(()=>{window.dispatchEvent(new Event('blur'));document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('beforeunload',{cancelable:true}));});
  assert.equal(prompts,0,'Movement, scrolling, focus and synthetic events are quiet');
  // Page.close() marks Playwright's routing layer closed even when Stay cancels
  // the real close. Use the browser's close command so reload fixtures still work.
  const tab=await context.newCDPSession(page);
  await attempt(page,()=>tab.send('Page.close'));assert.equal(page.isClosed(),false);assert.equal(prompts,1);await tab.detach();
  await page.reload();await page.waitForFunction(()=>window.ready);await page.getByText('Keep watching',{exact:true}).click();
  const closed=page.waitForEvent('close');await page.close({runBeforeUnload:true});await closed;assert.equal(prompts,1);

  // Browser Back is genuine navigation, and the second attempt always works.
  const back=await open('/away');await back.goto(origin+'/watch');await back.waitForFunction(()=>window.ready);await back.getByText('Keep watching',{exact:true}).click();
  const backTab=await context.newCDPSession(back),history=await backTab.send('Page.getNavigationHistory');
  await attempt(back,()=>backTab.send('Page.navigateToHistoryEntry',{entryId:history.entries[history.currentIndex-1].id}));assert.equal(back.url(),origin+'/watch');
  await back.goBack();assert.equal(back.url(),origin+'/away');await backTab.detach();await back.close();

  // A real Back departure uses custom wording only when the browser permits it.
  // Resume the original history entry rather than adding a replacement Back trap.
  const regular=await open('/away');await regular.goto(origin+'/regular');await regular.waitForFunction(()=>window.ready);await regular.getByText('Keep watching',{exact:true}).click();
  let fallback=0;regular.on('dialog',async d=>{fallback++;await d.dismiss();await regular.evaluate(()=>{window.nativeFallback=true;});});
  await regular.evaluate(()=>navigation.addEventListener('navigate',event=>{window.exitEvent={cancelable:event.cancelable,userInitiated:event.userInitiated};}));
  const regularTab=await context.newCDPSession(regular),entries=await regularTab.send('Page.getNavigationHistory');
  await regularTab.send('Page.navigateToHistoryEntry',{entryId:entries.entries[entries.currentIndex-1].id});
  await regular.waitForFunction(()=>window.exitEvent||window.nativeFallback);
  const supported=await regular.evaluate(()=>!!window.exitEvent?.cancelable&&!!window.exitEvent?.userInitiated);
  if(supported){await regular.getByRole('dialog').waitFor({state:'visible'});assert.equal(fallback,0);await regular.getByRole('button',{name:'Leave webinar'}).click();}
  else {assert.equal(fallback,1);await regular.goBack();}
  await regular.waitForURL(origin+'/away');const after=await regularTab.send('Page.getNavigationHistory');assert.equal(after.entries.length,entries.entries.length,'Leaving preserves real history without extra entries');await regularTab.detach();await regular.close();

  // The intended next video has no prompt; its first real exit remains eligible.
  const next=await open();let nextPrompts=0;next.on('dialog',()=>nextPrompts++);
  await next.getByText('Watch VIP now',{exact:true}).click();await next.waitForURL(origin+'/next');await next.waitForFunction(()=>window.ready);assert.equal(nextPrompts,0);
  await next.getByText('Keep watching',{exact:true}).click();
  const left=next.waitForEvent('close');await attempt(next,()=>next.close({runBeforeUnload:true}),true);await left;assert.equal(nextPrompts,1);
  console.log('PASS real browser exits: actual close/back, Stay then leave, refresh persistence, quiet hover/scroll/focus, and uninterrupted VIP handoff.');
 }finally{await context.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const browser=await chromium.launch({headless:true});try{await verifyWebinarExit(browser);}finally{await browser.close();}}
