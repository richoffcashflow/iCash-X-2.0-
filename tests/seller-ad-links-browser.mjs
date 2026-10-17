import assert from 'node:assert/strict';
export async function verifySellerAdLinks(browser,base,options,name,fixtureCookies){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
 const rows=[{slug:'hon-i01',label:'Image 01 · Fast cash',format:'image',source:'meta',campaign:'hon_cbo',assetUrl:'',createdAt:new Date().toISOString(),visitors:20,responses:5,qualified:2},{slug:'hon-v01',label:'Video 01 · Fast cash',format:'video',source:'meta',campaign:'hon_cbo',assetUrl:'',createdAt:new Date().toISOString(),visitors:0,responses:0,qualified:0}];
 let denied=false,failed=false;const errors=[],saved=[];
 try{
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==base)return route.abort();
   if(u.pathname==='/api/seller/operations')return route.fulfill({json:{journey:{checks:[],pending:0,needsAttention:0,started:0},optin:null,leadSupply:null,controls:[{enabled:false,lookup_used_micros:0,lookup_reserved_micros:0,lookup_allowance_micros:0}],stats:{received:0,qualified:0,assigned:0,waitingForBudget:0,review:0},metaConfigured:false}});
   if(u.pathname==='/api/seller/ad-links'){
    if(denied||failed)return route.fulfill({status:denied?403:503,json:{error:denied?'Platform owner access required.':'Ad reporting is temporarily unavailable.'}});
    if(route.request().method()==='POST'){
     const b=route.request().postDataJSON();saved.push(b);
     if(b.action==='asset')rows.find(r=>r.slug===b.slug).assetUrl=b.assetUrl;
     else rows.push({slug:'hon-fixture-new',...b,createdAt:new Date().toISOString(),visitors:0,responses:0,qualified:0});
     return route.fulfill({json:{saved:true,slug:'hon-fixture-new'}});
    }
    return route.fulfill({json:{rows}});
   }
   if(u.pathname.startsWith('/api/'))return route.fulfill({status:401,json:{error:'Fixture only'}});
   if(u.pathname==='/seller-operations')return route.fulfill({response:await route.fetch({headers:{...route.request().headers(),cookie:fixtureCookies},maxRedirects:0})});
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));const failures=[];page.on('requestfailed',r=>failures.push({url:r.url(),error:r.failure()?.errorText}));page.on('response',r=>{if(r.status()>=400)failures.push({url:r.url(),status:r.status()});});await page.goto(base+'/seller-operations');
  const panel=page.getByRole('region',{name:'Ad links & response rates'});
  try{await panel.getByRole('cell',{name:'25.0%',exact:true}).waitFor();}catch(e){console.error({url:page.url(),errors,failures,body:await page.locator('body').innerText()});throw e;}assert.equal(await panel.locator('tbody tr').count(),2);
  const image=panel.locator('tbody tr').filter({hasText:'Image 01'});await image.getByText('View links',{exact:true}).click();
  const link=await image.getByLabel('Tracking link',{exact:true}).inputValue();assert.equal(new URL(link).searchParams.get('ad'),'hon-i01');
  await image.getByLabel('Media link',{exact:true}).fill('https://media.example/image.png');await image.getByRole('button',{name:'Save media link'}).click();await image.getByRole('link',{name:'Open image'}).waitFor();assert.equal(saved[0].action,'asset');
  await panel.getByLabel('Show',{exact:true}).selectOption('video');assert.equal(await panel.locator('tbody tr').count(),1);await panel.getByLabel('Show',{exact:true}).selectOption('all');
  const create=panel.locator('.seller-ad-create');await create.getByText('Create a tracking link',{exact:true}).click();
  await create.getByLabel('Ad name',{exact:true}).fill('Video 06 · Fixture');await create.getByLabel('Format',{exact:true}).selectOption('video');await create.getByLabel('Campaign ID',{exact:true}).fill('hon_new_cbo');await create.getByRole('button',{name:'Create tracking link',exact:true}).click();
  await panel.getByRole('rowheader').filter({hasText:'Video 06 · Fixture'}).waitFor();assert.equal(saved[1].format,'video');assert.equal(saved[1].campaign,'hon_new_cbo');
  const download=page.waitForEvent('download');await panel.getByRole('button',{name:'Download CSV'}).click();assert.equal((await download).suggestedFilename(),'HomeOffer-ad-links-and-results.csv');
  if(process.env.AD_LINK_SCREENSHOT)await panel.screenshot({path:process.env.AD_LINK_SCREENSHOT});
  failed=true;await panel.getByRole('button',{name:'Refresh results'}).click();await panel.getByRole('alert').waitFor();assert.match(await panel.getByRole('alert').innerText(),/last loaded results/);assert.equal(await panel.locator('tbody tr').count(),3);
  failed=false;denied=true;await panel.getByRole('button',{name:'Refresh results'}).click();await panel.getByText('Results unavailable.',{exact:true}).waitFor();assert.equal(await panel.locator('tbody tr').count(),0);
  assert.deepEqual(errors,[]);console.log(`PASS ${name}: ad results, media attachment, image/video filter, new link, CSV, refresh failure and denied-access clearing. Intercepted APIs only.`);
 }finally{await context.close();}
}
