import assert from 'node:assert/strict';

/** Actual page and form, isolated HTTP fixtures; never requests a real code. */
export async function verifyPurchaseAccess(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
 let signedIn=false,wrongAccount=false,codeRequests=0,external=0;
 const errors=[];
 try{
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==base){external++;return route.abort();}
   const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(url.pathname==='/api/account/access')return wrongAccount?json({signedIn:true,error:'Sign in with the same email you used for this purchase. Your payment is saved; do not pay again.'},403):json(signedIn?{signedIn:true,destination:url.searchParams.get('destination')==='vip'?'/live/100002':'/'}:{signedIn:false,signInReady:true});
   if(url.pathname==='/api/auth/email'){codeRequests++;assert.deepEqual(route.request().postDataJSON().email,'buyer@example.invalid');return json({sent:true,message:'A sign-in code is on its way.'});}
   if(url.pathname==='/api/auth/verify'){
    if(route.request().postDataJSON().code!=='123456')return json({error:'That code could not be verified. Request a new code and try again.'},400);
    signedIn=true;return json({signedIn:true});
   }
   if(url.pathname==='/api/auth/logout'){signedIn=false;wrongAccount=false;return json({signedOut:true});}
   if(url.pathname.startsWith('/api/'))return json({error:'Fixture only'},401);
   if(url.pathname==='/'||url.pathname==='/live/100002')return route.fulfill({contentType:'text/html',body:'<!doctype html><h1>Verified destination</h1>'});
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/access');await page.getByRole('button',{name:'Email me a code',exact:true}).waitFor();
  assert.equal(codeRequests,0,'Opening an emailed link never sends a code automatically');
  assert(await page.getByText('Already paid? You do not need to pay again.',{exact:true}).isVisible());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'No horizontal overflow');
  if(process.env.PURCHASE_ACCESS_SCREENSHOT)await page.screenshot({path:process.env.PURCHASE_ACCESS_SCREENSHOT,fullPage:true});
  await page.getByLabel('Email',{exact:true}).fill('buyer@example.invalid');
  await page.getByRole('button',{name:'Email me a code',exact:true}).click();
  await page.getByLabel('Email code',{exact:true}).fill('000000');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByText('That code could not be verified. Request a new code and try again.',{exact:true}).waitFor();
  await page.getByLabel('Email code',{exact:true}).fill('123456');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForURL(base+'/');assert.equal(codeRequests,1);
  signedIn=true;wrongAccount=true;
  await page.goto(base+'/access?purchase=00000000-0000-4000-8000-000000000001&destination=vip');
  await page.getByRole('button',{name:'Sign in with a different email',exact:true}).click();
  await page.getByLabel('Email',{exact:true}).fill('buyer@example.invalid');await page.getByRole('button',{name:'Email me a code',exact:true}).click();
  await page.getByLabel('Email code',{exact:true}).fill('123456');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForURL(base+'/live/100002');
  assert.equal(external,0);assert.deepEqual(errors,[]);
  console.log(`PASS ${name}: direct account link, no duplicate purchase UI, wrong code recovery, same-email sign-in, account switching and VIP destination. No real emails.`);
 }finally{await context.close();}
}
