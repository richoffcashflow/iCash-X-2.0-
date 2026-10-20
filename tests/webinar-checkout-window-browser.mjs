import assert from 'node:assert/strict';
import {newWebinar,publicWebinar} from '../lib/webinar-policy.ts';

// Local, intercepted payment UI only. No Stripe/provider request or real card data.
export async function verifyWebinarCheckoutWindow(browser,base,options={},name='browser'){
 for(const scenario of ['untouched','email','card','vip']){
  const context=await browser.newContext({...options,ignoreHTTPSErrors:true});context.setDefaultTimeout(10000);
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const start=new Date('2026-10-20T05:00:00Z');await page.clock.install({time:start});
  const vip=scenario==='vip',id='00000000-0000-4000-8000-000000000123',sessionId='00000000-0000-4000-8000-000000000456';
  const webinar=publicWebinar({...newWebinar(id),title:'Checkout timer fixture',status:'published',publicCode:'123456',videoUrl:base+'/fixture-video.mp4',showAudienceCount:false,parentWebinarId:vip?'00000000-0000-4000-8000-000000000999':null,offers:[{id:'primary',at:0,title:'Your original offer',description:'',ctaLabel:'Continue',action:'checkout',url:'',expiresAt:new Date(+start+30000).toISOString()}]});
  let preparations=0,vipAttempts=0,paid=false;
  const status=()=>({ready:true,mode:'test',embeddedReady:true,needsClaim:false,customerName:'Fixture',email:scenario==='card'||vip?'fixture@example.invalid':null,offer:{revision:1,priceCents:5000},membership:vip||paid?{accessible:true,vip:vip&&paid}:null,postPurchaseUrl:'/live/123457'});
  const stripe=`window.fixtureMounts=0;window.fixtureDestroys=0;window.Stripe=()=>({createEmbeddedCheckoutPage:async({onComplete})=>({mount(node){window.fixtureMounts++;const frame=document.createElement('iframe');frame.title='Fixture secure payment';frame.src='https://checkout.stripe.com/form';node.append(frame);window.fixtureComplete=onComplete;},destroy(){window.fixtureDestroys++;}})});`;
  await context.route('**/*',route=>{
   const url=new URL(route.request().url()),json=body=>route.fulfill({json:body});
   if(url.href==='https://js.stripe.com/endive/stripe.js')return route.fulfill({contentType:'text/javascript',body:stripe});
   if(url.origin==='https://checkout.stripe.com')return route.fulfill({contentType:'text/html',body:'<!doctype html><label>Sample payment field<input aria-label="Sample payment field" autocomplete="off"></label>'});
   if(url.origin!==base)return route.abort();
   if(url.pathname==='/api/webinar/start')return json({sessionId,webinar,progress:100,name:'Fixture',messages:[],preview:false,serverNow:+start});
   if(url.pathname==='/api/webinar/event')return json({saved:true,redirect:vip?'/webinar/upgrade':'/webinar/checkout'});
   if(url.pathname==='/api/webinar/chat/feed')return json({messages:[],statuses:[]});
   if(url.pathname==='/api/webinar/timers')return json({deadlines:{},offerDeadlines:{},serverNow:+start});
   if(url.pathname==='/api/billing/membership'){
    if(route.request().method()==='POST'){preparations++;return json({clientSecret:'fixture-secret',publishableKey:'pk_test_fixture',sessionId:'cs_test_fixture'});}
    return json(status());
   }
   if(url.pathname==='/api/billing/vip'){
    if(route.request().method()==='POST'){vipAttempts++;if(vipAttempts===1)return route.fulfill({status:503,json:{error:'Fixture: payment connection unavailable'}});return json({clientSecret:'fixture-vip',publishableKey:'pk_test_fixture',sessionId:'cs_test_vip'});}
    return json({membership:{accessible:true,vip:paid}});
   }
   if(url.pathname.startsWith('/api/'))return json({});
   if(url.pathname==='/fixture-video.mp4')return route.fulfill({status:404,body:''});
   return route.continue();
  });
  try{
   await page.goto(base+'/live/123456');await page.getByRole('heading',{name:'Your original offer'}).waitFor();
   const field=page.frameLocator('iframe[title="Fixture secure payment"]').getByRole('textbox',{name:'Sample payment field'});
   if(scenario==='email')await page.getByRole('textbox',{name:'Payment email'}).fill('partially-entered');
   if(scenario==='card')await field.fill('fixture draft');
   if(vip){await page.getByRole('checkbox').check();}
   if(scenario!=='untouched')await page.getByText('Your checkout stays open while you finish.',{exact:true}).waitFor({state:'attached'});
   await page.clock.fastForward(31000);
   if(scenario==='untouched'){
    await page.getByText('This session’s offers have ended.',{exact:true}).waitFor();
    assert.equal(await page.locator('#webinar-offer').count(),0);assert.equal(preparations,0);
   }else{
    await page.getByRole('heading',{name:'Your original offer'}).waitFor();
    if(scenario==='email'){
     assert.equal(await page.getByRole('textbox',{name:'Payment email'}).inputValue(),'partially-entered');
     await page.getByRole('textbox',{name:'Payment email'}).fill('fixture@example.invalid');await page.getByRole('button',{name:'Continue to payment'}).click();await field.fill('fixture draft');
    }
    if(vip){
     await page.getByRole('button',{name:'Upgrade to VIP — $50'}).click();await page.getByRole('alert').filter({hasText:'Fixture: payment connection unavailable'}).waitFor();
     await page.clock.fastForward(1000);assert.equal(page.url(),base+'/live/123456');
     await page.getByRole('button',{name:'Upgrade to VIP — $50'}).click();await field.fill('fixture draft');
    }
    await page.locator('video').dispatchEvent('ended');await page.clock.fastForward(10000);
    assert.equal(page.url(),base+'/live/123456','Video completion cannot navigate away from payment');
    assert.equal(await field.inputValue(),'fixture draft','The same payment field survives expiry and video end');
    assert.deepEqual(await page.evaluate(()=>[window.fixtureMounts,window.fixtureDestroys]),[1,0]);
    assert.equal(preparations,vip?0:1,'Timer ticks never prepare a second checkout');
    paid=true;await page.evaluate(()=>window.fixtureComplete());
    if(vip)await page.waitForURL(base+'/');else await page.getByRole('button',{name:'Watch VIP now',exact:true}).waitFor();
   }
   assert.deepEqual(errors,[]);
  }catch(error){throw Error(`${name} ${scenario}: ${error.message}\n${page.url()}\n${await page.locator('body').innerText()}\n${errors.join('\n')}`);}finally{await context.close();}
 }
 console.log(`PASS ${name}: untouched offer expires; email, cross-origin payment fields and VIP retry stay mounted through expiry/video end; verified payment advances.`);
}
