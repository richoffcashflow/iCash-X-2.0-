import assert from 'node:assert/strict';
export async function verifyCloseConversions(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true}),page=await context.newPage();
 const writes=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const profile={name:'Fixture Buyer',email:'buyer@example.invalid',zips:['75201'],propertyTypes:['house'],maxPriceCents:15000000,maxRepairsCents:3000000,dailyEmails:1,availableDeals:null,paused:false,expiresAt:'2099-01-01T00:00:00Z'};
 const match={id:'00000000-0000-4000-8000-000000000003',state:'matched',address:'100 Fixture Street',askingPriceCents:10000000,url:base+'/d/fixture',createdAt:'2026-10-23T00:00:00Z'};
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();
  if(url.pathname==='/api/buyer-network'){
   if(request.method()==='GET')return route.fulfill({json:{signedIn:true,email:profile.email,profile,matches:[match]}});
   const body=request.postDataJSON();writes.push({method:request.method(),body});
   if(request.method()==='POST')profile.availableDeals=body.availableDeals;
   if(request.method()==='PATCH')match.state=body.state;
   return route.fulfill({json:{saved:true}});
  }
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,json:{error:'Local fixture only'}});
  return route.continue();
 });
 try{
  await page.goto(base+'/buyers');
  await page.getByRole('button',{name:'Edit preferences',exact:true}).click();
  const capacity=page.getByLabel('How many properties can you buy in the next 30 days?',{exact:false});
  assert.equal(await capacity.inputValue(),'','existing capacity is unknown');await capacity.fill('2');
  await page.getByRole('checkbox',{name:/I request off-market property packages/}).check();
  await page.getByRole('button',{name:'Save & renew for 30 days',exact:true}).click();
  await page.getByRole('button',{name:'Edit preferences',exact:true}).waitFor();
  assert.equal(writes[0].body.availableDeals,2);
  await page.getByText('Suggest a price or explain what needs to change',{exact:true}).click();
  await page.getByLabel('My suggested total purchase price ($)',{exact:true}).fill('95000');
  await page.getByRole('button',{name:'Send feedback',exact:true}).click();
  await page.getByText('Your feedback is saved for the deal owner.',{exact:false}).waitFor();
  assert.equal(writes[1].body.counterofferCents,9500000);assert.equal(writes[1].body.reason,'price');
  assert.match(writes[1].body.key,/^[a-f0-9-]{36}$/);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'buyer controls fit viewport');
  await page.screenshot({path:`/tmp/icash-close-buyers-${name.startsWith('mobile')?'mobile':'desktop'}.png`,fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(`PASS ${name}: buyer capacity and suggested-price controls save exact session-bound inputs. No live requests.`);
 }finally{await context.close();}
}
