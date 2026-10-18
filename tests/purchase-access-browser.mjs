import assert from 'node:assert/strict';

/** Actual page and form, isolated HTTP fixtures; never requests a real code. */
export async function verifyPurchaseAccess(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
 let signedIn=false,wrongAccount=false,codeRequests=0,textRequests=0,external=0,failEmail=false,paidView=null;
 const errors=[];
 try{
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==base){external++;return route.abort();}
   const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(url.pathname==='/api/account/access')return wrongAccount?json({signedIn:true,error:'Sign in with the same email you used for this purchase. Your payment is saved; do not pay again.'},403):json(signedIn?{signedIn:true,destination:url.searchParams.get('destination')==='vip'?'/live/100002':'/'}:{signedIn:false,signInReady:true});
   if(url.pathname==='/api/auth/email'){codeRequests++;assert.deepEqual(route.request().postDataJSON().email,'buyer@example.invalid');if(failEmail)return json({error:'Email could not be sent right now. Enter a code you already received or use your checkout phone.'},503);return json({sent:true,message:'A sign-in code is on its way.'});}
   if(url.pathname==='/api/auth/phone'){
    const body=route.request().postDataJSON();assert.equal(body.email,'');assert.equal(body.phone,'2125551234');
    if(body.action==='send'){textRequests++;assert.equal(body.accepted,true);return json({sent:true,message:'A text code is on its way.'});}
    if(body.code!=='12345678')return json({error:'That code could not be verified. Check the code or request a new text.'},400);
    signedIn=true;return json({signedIn:true});
   }
   if(url.pathname==='/api/auth/verify'){
    if(route.request().postDataJSON().code!=='123456')return json({error:'That code could not be verified. Request a new code and try again.'},400);
    signedIn=true;return json({signedIn:true});
   }
   if(url.pathname==='/api/auth/logout'){signedIn=false;wrongAccount=false;return json({signedOut:true});}
   if(url.pathname==='/api/billing/membership'&&paidView){
    assert.equal(route.request().method(),'GET','A paid or confirming buyer must never open a second checkout');
    return json({offer:{revision:1,priceCents:5000},ready:false,mode:'test',email:'buyer@example.invalid',needsClaim:!signedIn,postPurchaseUrl:paidView==='welcome'?'/live/100002':null,membership:paidView==='pending'?null:{accessible:true,vip:false}});
   }
   if(url.pathname==='/api/setup'&&paidView)return json({error:'Setup unavailable'},503);
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
  signedIn=false;wrongAccount=false;failEmail=true;
  await page.goto(base+'/access');await page.getByLabel('Email',{exact:true}).fill('buyer@example.invalid');
  await page.getByRole('button',{name:'Email me a code',exact:true}).click();
  await page.getByText('Email could not be sent right now. Enter a code you already received or use your checkout phone.',{exact:true}).waitFor();
  await page.getByLabel('Email code',{exact:true}).fill('123456');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForURL(base+'/');
  signedIn=false;
  await page.goto(base+'/access');await page.getByLabel('Email',{exact:true}).fill('buyer@example.invalid');
  await page.getByRole('button',{name:'Use my checkout phone',exact:true}).click();
  const optionalEmail=page.getByLabel('Receipt email (optional)',{exact:true});
  assert.equal(await optionalEmail.evaluate(input=>input.required),false,'Checkout phone recovery does not require remembering the receipt email');
  await optionalEmail.fill('');
  await page.getByLabel('Checkout mobile number',{exact:true}).fill('2125551234');
  await page.getByRole('button',{name:'Text me a code',exact:true}).click();
  await page.getByLabel('Text code',{exact:true}).fill('00000000');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByText('That code could not be verified. Check the code or request a new text.',{exact:true}).waitFor();
  await page.getByLabel('Text code',{exact:true}).fill('12345678');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForURL(base+'/');assert.equal(textRequests,1);
  const beforeRecovery=codeRequests;
  paidView='setup';signedIn=false;
  await page.goto(base+'/join?setup=1');
  await page.getByText('Could not restore your setup. Your payment is saved.',{exact:false}).waitFor();
  await page.getByRole('link',{name:'Skip naming — open my workspace',exact:true}).click();
  await page.waitForURL(base+'/access');await page.getByRole('button',{name:'Email me a code',exact:true}).waitFor();
  assert.equal(codeRequests,beforeRecovery,'Skipping optional setup still uses verified sign-in and does not send a code automatically');
  paidView='welcome';signedIn=true;
  await page.goto(base+'/join');await page.getByRole('button',{name:'Open my workspace',exact:true}).click();
  await page.waitForURL(base+'/');
  paidView='pending';
  await page.goto(base+'/join?membership=paid');await page.getByRole('button',{name:'Restore access with my payment email',exact:true}).click();
  await page.waitForURL(base+'/');assert.equal(codeRequests,beforeRecovery,'An existing verified session opens without another email code');
  assert.equal(external,0);assert.deepEqual(errors,[]);
  console.log(`PASS ${name}: direct account link, wrong-code/email/phone recovery, account switching, VIP destination, and workspace entry despite optional setup failure or delayed confirmation. No real emails or texts.`);
 }finally{await context.close();}
}
