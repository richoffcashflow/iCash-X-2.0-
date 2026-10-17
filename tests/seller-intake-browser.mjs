import assert from 'node:assert/strict';
import {sellerConsentVersion} from '../lib/seller-leads.ts';
import {optinCallNowVersion} from '../lib/optin-call-now.ts';
export async function verifySellerIntake(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
 const submissions=[],errors=[],opens=[];
 try{
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==base)return route.abort();
   if(url.pathname==='/api/seller/experiment'){opens.push(route.request().postDataJSON());return route.fulfill({json:{measured:false}});}
   if(url.pathname==='/api/seller/intake'){submissions.push(route.request().postDataJSON());return route.fulfill({json:{saved:true}});}
   if(url.pathname==='/api/seller/status')return route.fulfill({json:{phase:'review',title:'Your request needs a closer look.',message:'Your property is saved.',terminal:true}});
   if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,json:{error:'Fixture only'}});
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/sell?ad=hon-i01&utm_source=meta&utm_campaign=hon_cbo&utm_content=hon-i01');
  await page.locator('#seller-address').fill('123 Example St, Dallas, TX 75210');
  await page.locator('.seller-address-form button[type="submit"]').click();
  await page.locator('#seller-phone').waitFor();
  assert.equal(await page.locator('.seller-card').locator('#seller-name,input[autocomplete="name"],input[type="email"]').count(),0,await page.locator('.seller-card').innerHTML());
  await page.waitForFunction(()=>document.activeElement?.id==='seller-phone');
  await page.locator('#seller-phone').fill('2145550123');
  const submit=page.getByRole('button',{name:'Get My Cash Offer',exact:true});
  assert.equal(await submit.isDisabled(),true);assert.equal(submissions.length,0);
  await page.locator('.seller-ai-consent input').check();await submit.click();
  await page.getByRole('heading',{name:'Your request needs a closer look.'}).waitFor();
  assert.equal(submissions.length,1);assert.equal(submissions[0].name,undefined);assert.equal(submissions[0].email,undefined);
  assert.equal(submissions[0].address,'123 Example St, Dallas, TX 75210');assert.equal(submissions[0].phone,'2145550123');
  assert.equal(submissions[0].consented,true);assert.equal(submissions[0].consentVersion,sellerConsentVersion);assert.equal(submissions[0].callNowVersion,optinCallNowVersion);
  assert.equal(opens[0].ad,'hon-i01');assert.equal(opens[0].source,'meta');assert.equal(opens[0].campaign,'hon_cbo');assert.equal(submissions[0].campaign,'hon_cbo');assert.equal(submissions[0].source,'meta');
  assert.deepEqual(errors,[]);
  console.log(`PASS ${name}: address → phone focus → explicit unchecked consent → saved nameless request. Intercepted APIs only.`);
 }finally{await context.close();}
}
