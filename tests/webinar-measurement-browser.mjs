import assert from 'node:assert/strict';
import {newWebinar,publicWebinar} from '../lib/webinar-policy.ts';
export async function verifyWebinarMeasurement(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
 let explicit=false,optedOut=false,regionAllowed=true,scriptLoads=0,reads=0,upgraded=false,checkoutFixture=false,ownerFixture=false,homeFixture=false,privateHomeFixture=false;
 let membershipReadGate=null,stripeScriptGate=null;
 const errors=[],membershipRequests=[],pixelId='1104248230721457';
 try{
  await context.addInitScript(()=>{if(window.top!==window)return;window.__pixelCalls=[];});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href==='https://connect.facebook.net/en_US/fbevents.js'){
    scriptLoads++;return route.fulfill({contentType:'application/javascript',body:'window.__pixelCalls.push(...window.fbq.queue);window.fbq.callMethod=(...args)=>window.__pixelCalls.push(args);'});
   }
   if(url.origin==='https://www.facebook.com'&&url.pathname==='/signals/iwl.js')return route.fulfill({contentType:'application/javascript',body:'window.__metaSetupLoaded=true;'});
   if(checkoutFixture&&url.href==='https://js.stripe.com/endive/stripe.js'){if(stripeScriptGate)await stripeScriptGate;return route.fulfill({contentType:'application/javascript',body:`window.Stripe=()=>({createEmbeddedCheckoutPage:async options=>({mount:node=>{const frame=document.createElement('iframe');frame.title='Fixture payment';frame.sandbox='allow-scripts';frame.style.cssText='display:block;width:100%;height:860px;border:0';frame.srcdoc='<style>body{margin:12px;font-family:Arial}button,input{display:block;padding:12px;margin:0 0 12px;width:90%;box-sizing:border-box}</style><button>Fixture wallet</button><input placeholder="Fixture payment field"><div style="height:640px"></div><button>Fixture pay</button>';node.appendChild(frame);window.__completeCheckout=options.onComplete;},destroy:()=>{}})});`});}
   if(url.origin!==base)return route.abort();
   if((homeFixture||privateHomeFixture)&&url.pathname==='/api/account')return route.fulfill({json:privateHomeFixture?{signedIn:true,billingModel:'membership_credits',membershipActive:true,workspaceAcknowledged:false}:{signedIn:false,signInReady:true}});
   if(url.pathname==='/api/webinar/pixel')return route.fulfill({json:{enabled:true,pixelId,trackingAllowed:!optedOut&&(regionAllowed||explicit)}});
   if(checkoutFixture&&url.pathname==='/api/billing/membership'){
    if(route.request().method()==='GET'&&membershipReadGate)await membershipReadGate;
    if(route.request().method()==='POST')membershipRequests.push({home:homeFixture,...route.request().postDataJSON()});
    return route.fulfill({json:route.request().method()==='POST'?{clientSecret:'fixture-secret',publishableKey:'pk_live_fixture',sessionId:homeFixture?'cs_live_home_browser':'cs_live_browser'}:{offer:{revision:1,priceCents:5000},ready:true,mode:'live',embeddedReady:true,needsClaim:false,membership:null}});
   }
   if(url.pathname==='/api/webinar/measurement'){
    reads++;
    if(route.request().method()==='POST'){
     const body=route.request().postDataJSON();
     if(body.action==='automatic'){if(body.optedOut)optedOut=true;}
     else if(body.allow!==undefined){explicit=body.allow;optedOut=!body.allow;}
    }
    const trackingAllowed=!optedOut&&(regionAllowed||explicit);
    if(checkoutFixture)await new Promise(resolve=>setTimeout(resolve,600));
    const events=['pi_fixture',...(upgraded?['pi_vip']:[])].flatMap(id=>[{eventName:'AddPaymentInfo',eventId:'webinar:payment-info:'+id,data:{value:50,currency:'USD'}},{eventName:'Purchase',eventId:'webinar:purchase:'+id,data:{value:50,currency:'USD'}}]);
    return route.fulfill({json:{enabled:true,pixelId,trackingAllowed,consent:explicit&&!optedOut,events:trackingAllowed?events:[]}});
   }
   if(ownerFixture){
    if(url.pathname==='/api/webinar/start')return route.fulfill({json:{sessionId:'00000000-0000-4000-8000-000000000456',webinar:publicWebinar({...newWebinar('00000000-0000-4000-8000-000000000123'),title:'Owner public webinar',status:'published',publicCode:'123456',videoUrl:base+'/fixture-owner.mp4',showAudienceCount:false,offers:[{id:'primary',at:0,title:'Join iCash X',description:'',ctaLabel:'Continue',action:'checkout',url:'',expiresAt:null}]}),progress:0,name:'Owner',contactSaved:true,messages:[],preview:false,ownerWatching:true,serverNow:Date.now()}});
    if(url.pathname==='/api/billing/membership'){
     assert.equal(route.request().method(),'GET','Paid owner must not create another checkout');
     return route.fulfill({json:{offer:{revision:1,priceCents:5000},ready:true,mode:'live',needsClaim:false,postPurchaseUrl:'/live/123457',membership:{accessible:true,vip:false}}});
    }
    if(url.pathname==='/api/webinar/event')return route.fulfill({json:{saved:true,redirect:'/'}});
    if(url.pathname==='/api/webinar/chat/feed')return route.fulfill({json:{messages:[],statuses:[]}});
    if(url.pathname==='/api/webinar/timers')return route.fulfill({json:{deadlines:{},offerDeadlines:{},serverNow:Date.now()}});
    if(url.pathname==='/fixture-owner.mp4')return route.abort();
   }
   if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,json:{error:'Local fixture only'}});
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const calls=()=>page.evaluate(()=>window.__pixelCalls);
  const tracks=async event=>(await calls()).filter(c=>c[0]==='trackSingle'&&c[2]===event);
  await page.goto(base+'/live/123456');
  await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[2]==='PageView'));
  assert.equal(await page.locator('head script#icash-webinar-pixel').count(),1,'Base pixel is installed in the page head');
  assert.equal(await page.getByRole('link',{name:'Ad privacy',exact:true}).count(),0,'No floating privacy button');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('icash-webinar-session')),null);
  assert.equal(reads,0,'Page pixel does not wait for a webinar session or purchase lookup');
  assert.equal((await tracks('ViewContent')).length,0,'Loading the page alone does not invent a webinar session');
  assert.equal((await tracks('Purchase')).length,0);
  await page.evaluate(()=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://www.facebook.com/signals/iwl.js?pixel_id=1104248230721457';script.onload=resolve;script.onerror=reject;document.head.appendChild(script);}));
  assert.equal(await page.evaluate(()=>window.__metaSetupLoaded),true,'CSP permits Meta’s event setup bootstrap');
  await page.evaluate(()=>{sessionStorage.setItem('icash-webinar-session','fixture-webinar');window.dispatchEvent(new CustomEvent('icash-webinar-ready',{detail:{sessionId:'fixture-webinar'}}));});
  await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[2]==='Purchase'));
  assert.equal(await page.getByRole('region',{name:'Ad measurement preference'}).count(),0,'No automatic permission pop-up');
  assert.equal(await page.getByRole('button',{name:'Allow measurement',exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('wb-meta-choice')),null,'Automatic tracking never invents a saved permission');
  assert.equal(scriptLoads,1);assert.equal((await calls()).filter(c=>c[0]==='init'&&c[1]===pixelId).length,1);
  assert.equal((await tracks('PageView')).length,1);assert.equal((await tracks('ViewContent')).length,1);assert.equal((await tracks('Purchase')).length,1);
  assert.equal((await tracks('AddPaymentInfo')).length,1);
  await page.evaluate(()=>{
   for(const product of ['membership','vip_upgrade'])for(let retry=0;retry<3;retry++)for(const kind of ['add_to_cart','checkout_started'])window.dispatchEvent(new CustomEvent('icash-webinar-track',{detail:{sessionId:'fixture-webinar',kind,commerce:{product,checkoutId:'cs_live_'+product,valueCents:5000}}}));
  });
  for(const event of ['AddToCart','InitiateCheckout']){
   const events=await tracks(event);assert.equal(events.length,2,'One '+event+' per product, even in one webinar session');
   assert.deepEqual(events.map(e=>e[3].content_category),['membership','vip_upgrade']);assert(events.every(e=>e[3].value===50&&e[3].currency==='USD'));
  }
  upgraded=true;
  await page.evaluate(async()=>{const pending=[];window.dispatchEvent(new CustomEvent('icash-webinar-payment-confirmed',{detail:{waitUntil:p=>pending.push(p)}}));await Promise.all(pending);window.__receiptReady=true;});
  assert.equal((await tracks('Purchase')).length,2,'Confirmed embedded upgrade refreshes receipts before its redirect');
  assert.equal((await tracks('AddPaymentInfo')).length,2);
  const firstView=(await tracks('PageView'))[0][4].eventID;
  for(let n=0;n<3;n++)await page.evaluate(()=>window.dispatchEvent(new CustomEvent('icash-webinar-ready',{detail:{sessionId:'fixture-webinar'}})));
  await page.waitForFunction(()=>window.fbq!==undefined);
  assert.equal((await tracks('PageView')).length,1,'Repeated session refresh does not duplicate a page view');
  assert.equal((await tracks('Purchase')).length,2,'Purchase IDs remain deduplicated');
  const privacy=await context.newPage();privacy.on('pageerror',e=>errors.push(e.message));
  await privacy.goto(base+'/webinar/privacy#advertising');
  await privacy.getByRole('button',{name:'Turn off ad measurement',exact:true}).click();
  await privacy.getByText('Ad measurement is off. Your webinar access stays the same.',{exact:true}).waitFor();
  await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[0]==='consent'&&c[1]==='revoke'));
  assert.deepEqual(await privacy.evaluate(()=>window.__pixelCalls),[],'Opening privacy settings never sends ad events');
  const beforeOptOut=(await tracks('AddToCart')).length;
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('icash-webinar-track',{detail:{sessionId:'another',kind:'add_to_cart',commerce:{product:'membership'}}})));
  assert.equal((await tracks('AddToCart')).length,beforeOptOut,'Opt-out suppresses checkout stages too');
  await page.reload();await page.waitForLoadState('networkidle');
  assert.deepEqual(await calls(),[],'Declined measurement stays off on reload');assert.equal(scriptLoads,1);
  await privacy.getByRole('button',{name:'Allow ad measurement',exact:true}).click();
  await privacy.getByText('Ad measurement is on.',{exact:true}).waitFor();
  await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[2]==='PageView'));
  assert.notEqual((await tracks('PageView'))[0][4].eventID,firstView,'A real reload has a new PageView');assert.equal((await tracks('Purchase')).length,0,'Reload cannot resend a settled purchase');
  await privacy.close();
  await page.goto(base+'/live/123457');await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[2]==='PageView'));
  assert.equal((await tracks('PageView')).length,1,'VIP uses the shared pixel integration');
  const before=reads;
  for(const path of ['/webinar?preview=00000000-0000-4000-8000-000000000123','/preview/workspace']){
   await page.goto(base+path);await page.waitForLoadState('networkidle');assert.deepEqual(await calls(),[]);
  }
  assert.equal(reads,before,'Previews and non-webinar pages never request tracking configuration');assert.deepEqual(errors,[]);
  ownerFixture=true;
  await page.goto(base+'/live/123456');
  await page.getByRole('heading',{name:'Your membership is active.',exact:true}).waitFor();
  await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[2]==='PageView')&&window.__pixelCalls.some(c=>c[2]==='ViewContent'));
  assert.equal(page.url(),base+'/live/123456');assert.equal(await page.locator('video').count(),1);
  assert.equal((await tracks('AddToCart')).length,0,'Owner membership lookup does not fabricate cart engagement');
  assert.equal((await tracks('Purchase')).length,0,'Watching again does not create another purchase');
  await Promise.all([
   page.waitForResponse(r=>r.url().endsWith('/api/webinar/event')&&r.request().postDataJSON()?.kind==='completed'),
   page.locator('video').evaluate(video=>video.dispatchEvent(new Event('ended'))),
  ]);
  await page.getByText('You can keep watching this webinar.',{exact:true}).waitFor();
  assert.equal(page.url(),base+'/live/123456','Owner remains on the public webinar after completion');
  ownerFixture=false;
  checkoutFixture=true;
  let releaseMembership;
  membershipReadGate=new Promise(resolve=>{releaseMembership=resolve;});
  const stripePreload=page.waitForRequest(request=>request.url()==='https://js.stripe.com/endive/stripe.js');
  try{
   await Promise.all([page.goto(base+'/webinar/checkout'),stripePreload]);
   assert.equal(membershipRequests.length,0,'Stripe downloads while the current membership is still loading');
   await page.waitForFunction(()=>typeof window.Stripe==='function');
   assert.equal(await page.locator('iframe[title="Fixture payment"]').count(),0,'Loading the SDK does not initialize a payment form');
  }finally{releaseMembership();membershipReadGate=null;}
  const field=page.frameLocator('iframe[title="Fixture payment"]').getByPlaceholder('Fixture payment field');await field.waitFor();
  await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[2]==='InitiateCheckout'));
  assert.equal((await tracks('AddToCart')).length,0,'An automatically mounted form is not a cart selection');
  // Use a new session so earlier synthetic cart tests cannot hide this event.
  await page.evaluate(()=>sessionStorage.setItem('icash-webinar-session','iframe-interaction'));
  await field.click();await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[2]==='AddToCart'));
  assert.equal((await tracks('AddToCart')).length,1,'Real cross-origin iframe interaction reaches AddToCart');
  assert.equal((await tracks('Purchase')).length,0,'Entering the form never fabricates a purchase');assert.deepEqual(errors,[]);
  homeFixture=true;
  const previousWebinarSession=await page.evaluate(()=>{const saved=sessionStorage.getItem('icash-webinar-session');sessionStorage.removeItem('icash-webinar-session');return saved;});
  let releaseStripe;
  stripeScriptGate=new Promise(resolve=>{releaseStripe=resolve;});
  const prepared=page.waitForResponse(response=>response.url().endsWith('/api/billing/membership')&&response.request().method()==='POST');
  try{
   await page.goto(base+'/',{waitUntil:'domcontentloaded'});
   await prepared;
   assert.equal(await page.locator('iframe[title="Fixture payment"]').count(),0,'Session preparation can finish while Stripe is still downloading');
  }finally{releaseStripe();stripeScriptGate=null;}
  await field.waitFor();
  await page.getByRole('heading',{name:'Your AI wholesaling bot.',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Sign up',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Buy now',exact:true}).count(),0);
  assert.equal(await page.locator('input[type="checkbox"]').count(),0,'There is no separate agreement before the payment form');
  assert.equal(membershipRequests.filter(r=>r.home).length,1,'Checkout opens once automatically');
  assert.equal(membershipRequests.at(-1).action,'prepare');
  assert.equal(membershipRequests.at(-1).accepted,undefined,'Opening checkout does not invent purchase acceptance');
  try{await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[2]==='PageView')&&window.__pixelCalls.some(c=>c[2]==='InitiateCheckout'));}
  catch(error){console.log('Homepage pixel diagnostics',await page.evaluate(()=>({calls:window.__pixelCalls,boot:window.icashWebinarPixel?{path:window.icashWebinarPixel.path,pageViewId:window.icashWebinarPixel.pageViewId,sentPageView:window.icashWebinarPixel.sentPageView,pixelId:window.icashWebinarPixel.pixelId}:null,publicCheckout:!!document.querySelector('[data-public-checkout="true"]'),session:sessionStorage.getItem('icash-webinar-session')})),errors);throw error;}
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('icash-webinar-session')),null,'Direct buyers do not need a webinar session');
  assert.equal((await tracks('PageView')).length,1);
  assert.equal((await tracks('InitiateCheckout')).length,1);
  assert.equal((await tracks('AddToCart')).length,0,'Preparing the form is not a cart selection');
  const card=page.getByRole('region',{name:'Secure checkout',exact:true});
  const checkoutBoundsBefore=await card.boundingBox();
  await field.click();
  try{await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[2]==='AddToCart'));}
  catch(error){console.log('Homepage cart diagnostics',await page.evaluate(()=>({calls:window.__pixelCalls,activeElement:document.activeElement?.tagName,focused:document.hasFocus(),hidden:document.hidden,boot:window.icashWebinarPixel?{path:window.icashWebinarPixel.path,pageViewId:window.icashWebinarPixel.pageViewId}:null,publicCheckout:!!document.querySelector('[data-public-checkout="true"]'),session:sessionStorage.getItem('icash-webinar-session')})),errors);throw error;}
  assert.equal((await tracks('AddToCart')).length,1);
  assert.equal((await tracks('Purchase')).length,0);
  assert.deepEqual(await card.boundingBox(),checkoutBoundsBefore,'Entering payment details does not shift checkout');
  const originalViewport=page.viewportSize();
  for(const viewport of [originalViewport,{width:375,height:667},{width:320,height:568}]){
   await page.setViewportSize(viewport);
   await card.evaluate(node=>{node.scrollTop=0;});
   const bounds=await card.boundingBox(),footer=await page.locator('.wb-plan-footer').boundingBox();
   const screen=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.scrollingElement.scrollWidth,scrollHeight:document.scrollingElement.scrollHeight}));
   assert.ok(screen.scrollHeight<=screen.height+1&&screen.scrollWidth<=screen.width+1,JSON.stringify({viewport,screen}));
   assert.ok(bounds.y<160&&bounds.height>250&&bounds.y+bounds.height<=screen.height,'Checkout stays in the first screen');
   assert.ok(footer.y+footer.height<=screen.height+1,'Support and terms remain accessible');
   const wallet=page.frameLocator('iframe[title="Fixture payment"]').getByRole('button',{name:'Fixture wallet',exact:true});
   const walletBounds=await wallet.boundingBox();
   assert.ok(walletBounds.y>=bounds.y&&walletBounds.y+walletBounds.height<=bounds.y+bounds.height,'The top of the payment form is visible without scrolling');
   const pay=page.frameLocator('iframe[title="Fixture payment"]').getByRole('button',{name:'Fixture pay',exact:true});
   await pay.scrollIntoViewIfNeeded();
   const payBounds=await pay.boundingBox();
   assert.ok(payBounds.y>=bounds.y&&payBounds.y+payBounds.height<=bounds.y+bounds.height,'Longer payment forms remain reachable inside checkout');
  }
  await page.setViewportSize(originalViewport);
  assert.equal(membershipRequests.filter(r=>r.home).length,1,'Resizing or scrolling never recreates the checkout');
  homeFixture=false;privateHomeFixture=true;
  await page.goto(base+'/');await page.locator('.workspace-ack-shell').waitFor();await page.waitForLoadState('networkidle');
  assert.deepEqual(await calls(),[],'The signed-in workspace at the same URL remains private');
  await page.evaluate(saved=>{if(saved)sessionStorage.setItem('icash-webinar-session',saved);},previousWebinarSession);
  privateHomeFixture=false;checkoutFixture=false;regionAllowed=false;explicit=false;optedOut=false;
  await page.evaluate(()=>localStorage.removeItem('wb-meta-choice'));
  const beforeRestricted=scriptLoads;
  await page.goto(base+'/live/123456');await page.waitForLoadState('networkidle');
  assert.deepEqual(await calls(),[]);assert.equal(scriptLoads,beforeRestricted,'Non-US or unknown geography stays untracked without a prompt');
  assert.equal(await page.getByRole('button',{name:'Allow measurement',exact:true}).count(),0);
  regionAllowed=true;
  await page.addInitScript(()=>Object.defineProperty(navigator,'globalPrivacyControl',{get:()=>true,configurable:true}));
  await page.reload();await page.waitForLoadState('networkidle');
  assert.deepEqual(await calls(),[]);assert.equal(scriptLoads,beforeRestricted,'GPC blocks automatic pixel loading');
  assert.equal(optedOut,true,'Browser GPC is sent to the server to cancel queued measurement');
  console.log(`PASS ${name}: page-head Meta pixel before session startup, setup-tool script allowed, no floating button, PageView deduplication, Standard/VIP cart and checkout, verified receipt refresh, opt-outs/GPC/geography, owner viewing and private/preview exclusions. All Meta traffic intercepted.`);
 }finally{await context.close();}
}
