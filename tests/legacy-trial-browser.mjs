import assert from 'node:assert/strict';
/** Real offer/access UI, intercepted synthetic HTTP only; no provider or OTP. */
export async function verifyLegacyTrial(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
 const id='00000000-0000-4000-8000-000000000001';let posts=0,checks=0,codes=0,verifications=0,external=0;const errors=[];
 try{
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==base){external++;return route.abort();}
   const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(url.pathname==='/api/billing/legacy-trial'){
    posts++;const body=route.request().postDataJSON();assert.equal(body.email,'returning@example.invalid');assert.equal(body.accepted,true);assert.equal(body.version,'legacy-trial-2026-10-25.1');
    return posts===1?json({error:'Verify your email to resume your unfinished checkout.'},409):json({url:base+'/mock-trial-checkout'});
   }
   if(url.pathname==='/mock-trial-checkout')return route.fulfill({contentType:'text/html',body:'Synthetic hosted checkout; no provider contacted'});
   if(url.pathname==='/api/auth/email'){codes++;assert.equal(route.request().postDataJSON().email,'returning@example.invalid');return json({message:'If eligible, a code will be sent.'});}
   if(url.pathname==='/api/auth/verify'){verifications++;assert.equal(route.request().postDataJSON().code,'123456');return json({signedIn:true,accessPending:true});}
   if(url.pathname==='/api/billing/membership'){checks++;return json({membership:{accessible:checks>1}});}
   if(url.pathname==='/api/account/access')return json({signedIn:false,signInReady:true});
   if(url.pathname.startsWith('/api/'))return json({});
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(base+'/legacy-offer');await page.getByRole('heading',{name:'$0 now. Then $50/month.'}).waitFor();
  assert(await page.getByRole('button',{name:'Continue to secure checkout',exact:true}).isDisabled());
  await page.getByLabel('Original purchase email',{exact:true}).fill('returning@example.invalid');await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Continue to secure checkout',exact:true}).click();await page.getByText('Verify your email to resume your unfinished checkout.',{exact:true}).waitFor();assert.equal(posts,1);
  await page.getByRole('button',{name:'Resume a checkout from another device',exact:true}).click();
  await page.getByText('This verifies your email only',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Use my checkout phone',exact:true}).count(),0);
  await page.getByRole('button',{name:'Email me a code',exact:true}).click();await page.getByLabel('Email code',{exact:true}).fill('123456');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByText('Email verified. Continue to secure checkout above to resume your offer.',{exact:true}).waitFor();assert.equal(posts,1,'Email proof alone never starts checkout');assert.equal(codes,1);assert.equal(verifications,1);
  await page.getByRole('button',{name:'Continue to secure checkout',exact:true}).click();await page.waitForURL(base+'/mock-trial-checkout');assert.equal(posts,2);
  await page.goto(base+'/legacy-offer?purchase='+id+'&session_id=cs_test_fixture');await page.getByText('Your checkout is being confirmed.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Check again',exact:true}).click();await page.waitForURL(base+'/access?purchase='+id);await page.getByRole('heading',{name:'Open your iCash X account.'}).waitFor();
  assert.equal(posts,2,'Confirmation/claim never creates another subscription');assert.equal(codes,1,'Access handoff does not send an OTP automatically');
  assert.equal(errors.length,0,errors.join('\n'));assert.equal(external,0,'Every external request is blocked');
  console.log(`PASS ${name}: trial price/consent, rejected checkout, email-only pending recovery, explicit resume, pending confirmation retry and access handoff. Synthetic APIs only.`);
 }finally{await context.close();}
}
