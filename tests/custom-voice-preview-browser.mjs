import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeWorkspaceFixture,fixtureAccount} from './fixtures/workspace-volume.mjs';
const audio=readFileSync(new URL('./fixtures/custom-voice-preview.mp3',import.meta.url));

export async function verifyCustomVoicePreview(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true}),page=await context.newPage();
 page.setDefaultTimeout(15000);
 const errors=[],writes=[];let vip=true,saved=false,posts=0,reads=0,pending=0;
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;
  if(url.origin!==base)return route.abort();
  if(!p.startsWith('/api/'))return route.continue();
  if(p==='/api/account/custom-voice/preview'){
   if(req.method()==='POST'){posts++;assert.equal(req.postData(),null);saved=true;return route.fulfill({contentType:'audio/mpeg',body:audio});}
   reads++;if(pending>0){pending--;return route.fulfill({status:202,json:{state:'pending'}});}
   return saved?route.fulfill({contentType:'audio/mpeg',body:audio}):route.fulfill({status:404,json:{state:'empty'}});
  }
  if(req.method()!=='GET'){if(p==='/api/work/experience')return route.fulfill({json:{recorded:true}});writes.push(p);return route.fulfill({status:403,json:{error:'Fixture only'}});}
  if(p==='/api/account')return route.fulfill({json:{...fixtureAccount,balanceCents:0,paused:true,mode:'live',vip,vipFeatures:vip,billingModel:'membership_credits',membershipActive:true}});
  if(p==='/api/account/custom-voice')return route.fulfill({json:{vip,state:'ready',enabled:false}});
  if(p==='/api/account/walkthrough')return route.fulfill({json:{tour:{state:'completed',step:3},course:null}});
  if(p==='/api/work/activity')return route.fulfill({json:makeWorkspaceFixture({count:0})});
  if(p==='/api/work/events')return route.continue();
  if(p==='/api/funding/status')return route.fulfill({json:{enabled:true,mode:'live',paidCents:0,needsClaim:false,packs:[]}});
  if(p==='/api/billing/membership')return route.fulfill({json:{membership:{state:'active',accessible:true,vip,priceCents:10000,paidThrough:'2027-11-16T05:00:00Z',cancelAtPeriodEnd:false}}});
  if(p==='/api/work/progress')return route.fulfill({json:{progress:null}});
  if(p==='/api/work/assistant')return route.fulfill({json:{items:[]}});
  if(p==='/api/work/next-action')return route.fulfill({json:{offer:null,balanceCents:0,paused:true,checkedAt:new Date().toISOString()}});
  if(p==='/api/notifications/updates')return route.fulfill({json:{items:[],preferences:{seenAt:null}}});
  return route.fulfill({status:401,json:{error:'Local preview fixture only'}});
 });
 const dialog=page.getByRole('dialog',{name:'Customize bot'});
 async function open(){await page.goto(base+'/');await page.getByLabel('Account menu',{exact:true}).click();await page.getByRole('button',{name:'Customize bot',exact:true}).click();await dialog.waitFor();}
 try{
  await open();await dialog.getByRole('button',{name:'Play my cloned voice'}).waitFor();assert.equal(posts,0,'Opening customization generates nothing');assert.equal(reads,0);
  assert.equal(await dialog.getByText('No credits used. Replay anytime.').count(),1);
  const button=dialog.getByRole('button',{name:'Play my cloned voice'});
  await button.click();const player=dialog.getByLabel('Your cloned voice preview');await player.waitFor();
  await page.waitForFunction(()=>{const el=document.querySelector('audio[aria-label="Your cloned voice preview"]');return el&&el.readyState>=2;});
  assert.equal(posts,1);await player.evaluate(el=>el.play());await page.waitForFunction(()=>document.querySelector('audio[aria-label="Your cloned voice preview"]').currentTime>0);
  await player.evaluate(el=>el.pause());await button.click();assert.equal(posts,1,'Replay uses the browser audio blob');assert.equal(reads,1);
  assert.equal(await dialog.getByRole('button',{name:'Use my voice',exact:true}).count(),1,'Listening leaves the standard live voice selected');
  assert(await button.evaluate(el=>{const r=el.getBoundingClientRect();return r.height>=44&&r.left>=0&&r.right<=innerWidth;}));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await dialog.screenshot({path:`/tmp/icash-clone-preview-${name.startsWith('mobile')?'mobile':'desktop'}.png`});
  await open();await dialog.getByRole('button',{name:'Play my cloned voice'}).click();await player.waitFor();assert.equal(posts,1,'Reopening reads the saved preview without generation');
  pending=1;await open();await dialog.getByRole('button',{name:'Play my cloned voice'}).click();await dialog.getByRole('status').filter({hasText:'Preparing your saved'}).waitFor();
  assert(await dialog.getByRole('button',{name:'Preparing your voice'}).isDisabled());await player.waitFor();assert.equal(posts,1,'A concurrent preparation polls read-only status');
  vip=false;await open();assert.equal(await dialog.getByRole('button',{name:'Play my cloned voice'}).count(),0);
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log(`PASS ${name}: free clone preview at $0, audio playback/replay, cached reopen, concurrent preparation, VIP visibility, mobile fit and unchanged live voice.`);
 }finally{await context.close();}
}
