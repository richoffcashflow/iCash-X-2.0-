import assert from 'node:assert/strict';
import {newWebinar,publicWebinar} from '../lib/webinar-policy.ts';
export async function verifyWebinarMeasurement(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
 let consent=false,scriptLoads=0,reads=0,upgraded=false,checkoutFixture=false,ownerFixture=false;
 const errors=[],pixelId='1104248230721457';
 try{
  await context.addInitScript(()=>{if(window.top!==window)return;sessionStorage.setItem('icash-webinar-session','fixture-webinar');window.__pixelCalls=[];});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href==='https://connect.facebook.net/en_US/fbevents.js'){
    scriptLoads++;return route.fulfill({contentType:'application/javascript',body:'window.__pixelCalls.push(...window.fbq.queue);window.fbq.callMethod=(...args)=>window.__pixelCalls.push(args);'});
   }
   if(checkoutFixture&&url.href==='https://js.stripe.com/endive/stripe.js')return route.fulfill({contentType:'application/javascript',body:`window.Stripe=()=>({createEmbeddedCheckoutPage:async options=>({mount:node=>{const frame=document.createElement('iframe');frame.title='Fixture payment';frame.sandbox='allow-scripts';frame.srcdoc='<input placeholder="Fixture payment field">';node.appendChild(frame);window.__completeCheckout=options.onComplete;},destroy:()=>{}})});`});
   if(url.origin!==base)return route.abort();
   if(checkoutFixture&&url.pathname==='/api/billing/membership')return route.fulfill({json:route.request().method()==='POST'?{clientSecret:'fixture-secret',publishableKey:'pk_live_fixture',sessionId:'cs_live_browser'}:{offer:{revision:1,priceCents:5000},ready:true,mode:'live',embeddedReady:true,needsClaim:false,membership:null}});
   if(url.pathname==='/api/webinar/measurement'){
    reads++;if(route.request().method()==='POST'){consent=route.request().postDataJSON().allow;return route.fulfill({json:{consent}});}
    if(checkoutFixture)await new Promise(resolve=>setTimeout(resolve,600));
    const events=['pi_fixture',...(upgraded?['pi_vip']:[])].flatMap(id=>[{eventName:'AddPaymentInfo',eventId:'webinar:payment-info:'+id,data:{value:50,currency:'USD'}},{eventName:'Purchase',eventId:'webinar:purchase:'+id,data:{value:50,currency:'USD'}}]);
    return route.fulfill({json:{enabled:true,pixelId,consent,events:consent?events:[]}});
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
  await page.getByRole('button',{name:'Allow measurement',exact:true}).waitFor();
  assert.equal(scriptLoads,0,'No Meta script before consent');
  await page.getByRole('button',{name:'Allow measurement',exact:true}).click();
  await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[2]==='PageView'));
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
  await page.waitForFunction(()=>window.fbq!==undefined);await page.getByRole('button',{name:'Ad privacy',exact:true}).click();
  assert.equal((await tracks('PageView')).length,1,'Repeated session refresh does not duplicate a page view');
  assert.equal((await tracks('Purchase')).length,2,'Purchase IDs remain deduplicated');
  await page.getByRole('button',{name:'No thanks',exact:true}).click();
  await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[0]==='consent'&&c[1]==='revoke'));
  const beforeOptOut=(await tracks('AddToCart')).length;
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('icash-webinar-track',{detail:{sessionId:'another',kind:'add_to_cart',commerce:{product:'membership'}}})));
  assert.equal((await tracks('AddToCart')).length,beforeOptOut,'Opt-out suppresses checkout stages too');
  await page.reload();await page.getByRole('button',{name:'Ad privacy',exact:true}).waitFor();
  assert.deepEqual(await calls(),[],'Declined measurement stays off on reload');assert.equal(scriptLoads,1);
  await page.getByRole('button',{name:'Ad privacy',exact:true}).click();await page.getByRole('button',{name:'Allow measurement',exact:true}).click();
  await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[2]==='PageView'));
  assert.notEqual((await tracks('PageView'))[0][4].eventID,firstView,'A real reload has a new PageView');assert.equal((await tracks('Purchase')).length,0,'Reload cannot resend a settled purchase');
  await page.goto(base+'/live/123457');await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[2]==='PageView'));
  assert.equal((await tracks('PageView')).length,1,'VIP uses the shared pixel integration');
  const before=reads;
  for(const path of ['/webinar?preview=00000000-0000-4000-8000-000000000123','/webinar/privacy','/preview/workspace']){
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
  await page.goto(base+'/webinar/checkout');
  const field=page.frameLocator('iframe[title="Fixture payment"]').getByPlaceholder('Fixture payment field');await field.waitFor();
  await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[2]==='InitiateCheckout'));
  assert.equal((await tracks('AddToCart')).length,0,'An automatically mounted form is not a cart selection');
  // Use a new session so earlier synthetic cart tests cannot hide this event.
  await page.evaluate(()=>sessionStorage.setItem('icash-webinar-session','iframe-interaction'));
  await field.click();await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[2]==='AddToCart'));
  assert.equal((await tracks('AddToCart')).length,1,'Real cross-origin iframe interaction reaches AddToCart');
  assert.equal((await tracks('Purchase')).length,0,'Entering the form never fabricates a purchase');assert.deepEqual(errors,[]);
  console.log(`PASS ${name}: supplied Meta pixel, PageView, Standard/VIP cart and checkout, completion refresh, deduplicated payment/purchase, consent/revocation, owner public viewing through completion and preview exclusions. All Meta traffic intercepted.`);
 }finally{await context.close();}
}
