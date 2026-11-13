import assert from 'node:assert/strict';
import {fixtureAccount,makeWorkspaceFixture} from './fixtures/workspace-volume.mjs';

// Actual owner workspace and private demo; every API/provider is intercepted.
export async function verifyOwnerReset(browser,base,options,name,fixtureCookies){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true}),page=await context.newPage();
 page.setDefaultTimeout(15000);
 const errors=[],writes=[];let resets=0,checks=0,accounts=0,pass=true,owner=true;
 const account=()=>({...fixtureAccount,mode:'live',paused:false,isBillingOwner:owner,privateDemoPhone:owner?'+12125550199':null,billingModel:'membership_credits',membershipActive:true});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(/same key|unique.*key/i.test(m.text()))errors.push(m.text());});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),p=url.pathname;
  if(url.origin!==base)return route.abort();
  // WebKit owns its Cookie header. Supply the isolated navigation proof through
  // the same local HTTP fixture boundary used by the other private-page tests.
  if(p==='/test-bot')return route.fulfill({response:await route.fetch({headers:{...request.headers(),cookie:fixtureCookies},maxRedirects:0})});
  if(!p.startsWith('/api/'))return route.continue();
  if(p==='/api/demo/reset'){
   assert.equal(request.method(),'POST');resets++;
   await new Promise(resolve=>setTimeout(resolve,120));
   return route.fulfill({json:{status:'reset',requestId:request.postDataJSON().requestId,historyPreserved:true,providerWrites:false}});
  }
  if(p==='/api/work/experience')return route.fulfill({json:{recorded:true}});
  if(request.method()!=='GET'){writes.push(p);return route.fulfill({status:403,json:{error:'Fixture only'}});}
  if(p==='/api/account'){accounts++;return route.fulfill({json:account()});}
  if(p==='/api/demo/intake')return route.fulfill({json:{ready:true,privateDemoPhone:'+12125550199'}});
  if(p==='/api/demo/readiness'){
   checks++;await new Promise(resolve=>setTimeout(resolve,120));
   return route.fulfill({json:{mode:'read_only',checkedAt:new Date().toISOString(),setupChecksPass:pass,liveCallVerified:false,callsPlaced:0,messagesSent:0,checks:['Owner account','AI and cash-offer tools','Calling connection','Text setup','Contract setup'].map((label,i)=>({id:String(i),label,status:!pass&&i===2?'unavailable':'passed',detail:'Fictional setup result.',elapsedMs:20}))}});
  }
  if(p==='/api/work/next-action')return route.fulfill({json:{card:{key:'fixture',title:'Ready for the next opportunity',detail:'Fictional saved status.',action:'none',reason:'waiting',button:null,progress:null},balanceCents:fixtureAccount.balanceCents,paused:false,checkedAt:new Date().toISOString(),variant:'progress',impressionId:null}});
  if(p==='/api/work/activity')return route.fulfill({json:makeWorkspaceFixture({count:0})});
  if(p==='/api/work/events')return route.continue();
  if(p==='/api/work/progress')return route.fulfill({json:{progress:null}});
  if(p==='/api/work/assistant')return route.fulfill({json:{items:[]}});
  if(p==='/api/notifications/updates')return route.fulfill({json:{items:[],preferences:{seenAt:null}}});
  if(p==='/api/funding/status')return route.fulfill({json:{enabled:true,mode:'live',paidCents:0,needsClaim:false,packs:[]}});
  return route.fulfill({status:503,json:{error:'Fixture unavailable'}});
 });
 try{
  await page.goto(base+'/',{waitUntil:'networkidle'});
  const reset=page.getByRole('region',{name:'Owner account reset'}),card=page.getByRole('region',{name:'Your next step'});
  await reset.waitFor();await card.waitFor();
  await reset.getByRole('button',{name:'Reset owner account',exact:true}).click();
  assert(await reset.getByRole('button',{name:'Resetting owner account…',exact:true}).isDisabled());
  await reset.getByText('Reset complete. Setup checks passed. You can start a new demo.',{exact:true}).waitFor();
  assert.equal(resets,1);assert.equal(checks,1);assert.equal(await reset.count(),1);assert.equal(await card.count(),1);
  for(let i=0;i<3;i++){
   const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/account');
   await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await response;
   await page.waitForLoadState('networkidle');
   assert.equal(await card.count(),1,'Account refresh must not duplicate sibling cards');
   assert.equal(await reset.count(),1);assert.equal(checks,1,'Refresh must not restart the completed reset check');
  }
  assert(accounts>=4);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  owner=false;const refreshed=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/account');
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await refreshed;await reset.waitFor({state:'hidden'});
  assert.equal(resets,1,'A non-owner has no reset control');
  await page.goto(base+'/test-bot',{waitUntil:'networkidle'});assert.equal(new URL(page.url()).pathname,'/test-bot','The isolated navigation proof must reach the private demo');pass=false;
  await page.locator('#seller-address').fill('123 Fixture Street, Dallas, TX 75210');await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.locator('#demo-name').fill('Fixture Owner');await page.locator('input[type=checkbox]').check();
  await page.getByText('Calling connection: not verified',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'Start my bot demo'}).isDisabled());
  pass=true;await page.getByRole('button',{name:'Reset owner account',exact:true}).click();
  await page.getByText('Reset complete. Setup checks passed. You can start a new demo.',{exact:true}).waitFor();
  assert.equal(resets,2);assert.equal(await page.locator('#seller-address').inputValue(),'');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log(`PASS ${name}: owner-only reset, one automatic setup check, repeated workspace refresh without duplicated cards, failed setup blocks Start, demo draft clears; no live calls/texts.`);
 }finally{await context.close();}
}
