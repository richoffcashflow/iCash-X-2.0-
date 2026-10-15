// Real browser departure events against the production reminder module. No providers.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {chromium} from 'playwright';

export async function verifyWebinarExit(browser){
 const origin='https://webinar-exit.example.test';
 const code=ts.transpileModule(readFileSync(new URL('../lib/webinar-exit-reminder.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const context=await browser.newContext();context.setDefaultTimeout(5000);
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());assert.equal(url.origin,origin);
  if(url.pathname==='/reminder.js')return route.fulfill({contentType:'text/javascript',body:code});
  const script=url.pathname==='/away'?'':`<script type="module">import {installWebinarExitReminder,navigateWebinar} from '/reminder.js';installWebinarExitReminder();document.querySelector('#next').onclick=()=>navigateWebinar('/next');window.ready=true;</script>`;
  return route.fulfill({contentType:'text/html',body:`<!doctype html><html><body><button id="play">Keep watching</button><button id="next">Watch VIP now</button><div style="height:1500px"></div>${script}</body></html>`});
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

  // The intended next video has no prompt; its first real exit remains eligible.
  const next=await open();let nextPrompts=0;next.on('dialog',()=>nextPrompts++);
  await next.getByText('Watch VIP now',{exact:true}).click();await next.waitForURL(origin+'/next');await next.waitForFunction(()=>window.ready);assert.equal(nextPrompts,0);
  await next.getByText('Keep watching',{exact:true}).click();
  const left=next.waitForEvent('close');await attempt(next,()=>next.close({runBeforeUnload:true}),true);await left;assert.equal(nextPrompts,1);
  console.log('PASS real browser exits: actual close/back, Stay then leave, refresh persistence, quiet hover/scroll/focus, and uninterrupted VIP handoff.');
 }finally{await context.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const browser=await chromium.launch({headless:true});try{await verifyWebinarExit(browser);}finally{await browser.close();}}
