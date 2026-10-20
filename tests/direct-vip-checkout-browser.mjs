import assert from 'node:assert/strict';

// Actual homepage/post-webinar checkout, entirely intercepted billing fixtures.
export async function verifyDirectVipCheckout(browser,base,options={},name='browser'){
 for(const path of ['/','/webinar/checkout?membership=paid&session_id=cs_test_fixture']){
  const context=await browser.newContext({...options,ignoreHTTPSErrors:true});context.setDefaultTimeout(10000);
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  let paid=false,preparations=0,destinations=0;
  const returned=path!=='/';
  await page.addInitScript(()=>{window.fixtureWelcomeSeen=false;new MutationObserver(()=>{if(document.body?.textContent?.includes('Don’t leave yet.')){window.fixtureWelcomeSeen=true;sessionStorage.setItem('fixture-welcome-seen','yes');}}).observe(document,{childList:true,subtree:true});});
  await context.route('**/*',route=>{
   const url=new URL(route.request().url()),json=body=>route.fulfill({json:body});
   if(url.href==='https://js.stripe.com/endive/stripe.js')return route.fulfill({contentType:'text/javascript',body:"window.Stripe=()=>({createEmbeddedCheckoutPage:async({onComplete})=>({mount(node){node.innerHTML='<button type=button>Complete fixture payment</button>';node.querySelector('button').onclick=onComplete;},destroy(){}})});"});
   if(url.origin!==base)return route.abort();
   if(url.pathname==='/api/account')return json({signedIn:false,signInReady:true});
   if(url.pathname==='/api/billing/membership'){
    if(route.request().method()==='POST'){preparations++;return json({clientSecret:'fixture-secret',publishableKey:'pk_test_fixture',sessionId:'cs_test_fixture'});}
    return json({offer:{revision:1,priceCents:5000},ready:true,mode:'test',embeddedReady:true,email:'fixture@example.invalid',needsClaim:false,postPurchaseUrl:'/live/123457',membership:paid?{accessible:true,vip:false}:null});
   }
   if(url.pathname.startsWith('/api/'))return json({});
   if(url.pathname==='/live/123457'){
    destinations++;assert.equal(paid,true,'Only server-confirmed payment may navigate');
    return route.fulfill({contentType:'text/html',body:'<!doctype html><h1>Your VIP session</h1>'});
   }
   return route.continue();
  });
  try{
   await page.goto(base+path);
   if(!returned)await page.getByRole('button',{name:'Complete fixture payment',exact:true}).click();
   await page.getByRole('heading',{name:'Confirming your payment',exact:true}).waitFor();
   assert.equal(destinations,0,'Neither a completion callback nor a paid URL flag grants access');
   assert.equal(await page.evaluate(()=>window.fixtureWelcomeSeen),false);
   paid=true;
   await page.getByRole('button',{name:'Check payment',exact:true}).click();
   await page.waitForURL(base+'/live/123457');await page.getByRole('heading',{name:'Your VIP session',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('fixture-welcome-seen')),null,'The welcome screen never mounts, even briefly');
   assert.equal(destinations,1);assert.equal(preparations,returned?0:1,'No repeat checkout during paid handoff');
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 }
 console.log(`PASS ${name}: homepage and checkout return go directly to VIP only after verified payment, without a welcome screen or repeat checkout.`);
}
