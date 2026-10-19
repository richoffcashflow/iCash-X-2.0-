import assert from 'node:assert/strict';
export async function verifySellerCosts(browser,base,options,name,fixtureCookies){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});const page=await context.newPage(),writes=[],errors=[];
 page.setDefaultTimeout(15000);
 const id='00000000-0000-4000-8000-000000000001',now=new Date().toISOString();let denied=false,failSave=false,accessSaved=false,failToken=true,tokenWrites=0;
 const fakeToken='synthetic-browser-meta-token-12345';
 const report={thresholdCents:1000,automation:[],estimates:[{source:'meta',campaign:'',costMicros:11200000,note:'Owner estimate',updatedAt:now}],leads:[{id,address:'123 Fixture Street',state:'assigned',createdAt:now,source:'meta',campaign:'image_ads',acquisition:null,processingMicros:40000,collectedCents:12,recipients:1,holdReason:null}]};
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==base)return route.abort();
  if(url.pathname==='/api/seller/costs'){
   if(denied)return route.fulfill({status:403,json:{error:'Platform owner access required.'}});
   if(req.method()==='POST'){
    const b=req.postDataJSON();writes.push(b);if(b.action==='lead'||b.action==='estimate'){assert.equal(b.costCents,1120);assert(!('accountId' in b));}
    if(failSave)return route.fulfill({status:503,json:{error:'Synthetic save failure. Retry the same entry.'}});
    if(b.action==='lead')report.leads[0].acquisition={costMicros:b.costCents*10000,kind:'reported',note:b.note};
    if(b.action==='meta')report.automation=[{id,campaign:b.campaign,accountId:b.accountId,metaCampaignId:b.metaCampaignId,enabled:b.enabled,status:'pending',checkedAt:null,syncedAt:null,spendMicros:0,leadCount:0,unallocatedMicros:0,averageMicros:null}];
    return route.fulfill({json:{saved:true,message:({lead:'Lead cost recorded. Existing charges are unchanged.',estimate:'Estimate saved for new leads.',meta:'Automatic Meta cost tracking saved.'})[b.action]}});
   }
   return route.fulfill({json:report});
  }
  if(url.pathname==='/api/seller/costs/meta'){
   if(denied)return route.fulfill({status:403,json:{error:'Platform owner access required.'}});
   if(req.method()==='POST'){tokenWrites++;assert.deepEqual(req.postDataJSON(),{token:fakeToken});if(failToken)return route.fulfill({status:400,json:{error:'Synthetic token needs ads_read access.'}});accessSaved=true;}
   if(!accessSaved)return route.fulfill({status:503,json:{error:'Meta needs read access. Paste a token below.'}});
   return route.fulfill({json:url.searchParams.has('account')?{campaigns:[{id:'987654321',name:'Synthetic HomeOffer campaign'}]}:{saved:true,message:'Meta access saved. Select your ad account and campaign below.',accounts:[{id:'act_123456789',name:'Synthetic ad account'}]}});
  }
  if(url.pathname==='/api/seller/operations')return route.fulfill({json:{leadSupply:null,optin:null,journey:{checks:[],pending:0,needsAttention:0,started:0},controls:[{enabled:true,lookup_allowance_micros:1000000,lookup_used_micros:0,lookup_reserved_micros:0}],stats:{received:1,qualified:1,assigned:1,waitingForBudget:0,review:0},metaConfigured:true}});
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,json:{error:'Fixture only'}});
  if(url.pathname==='/seller-operations')return route.fulfill({response:await route.fetch({headers:{...req.headers(),cookie:fixtureCookies},maxRedirects:0})});
  return route.continue();
 });
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(base+'/seller-operations#lead-costs');const panel=page.getByRole('region',{name:'Lead costs',exact:true});
  await panel.getByText('Ad cost is missing',{exact:false}).waitFor();assert.equal(writes.length,0,'Opening admin never saves a price or cost');
  const tokenField=panel.getByLabel('Meta access token',{exact:true});await tokenField.waitFor({state:'visible'});assert.equal(await tokenField.getAttribute('type'),'password');assert.equal(tokenWrites,0,'Token entry is visible without a prior connection');
  await panel.getByRole('button',{name:'Check Meta connection'}).click();await panel.getByRole('alert').getByText(/Meta needs read access/).waitFor();
  await tokenField.fill(fakeToken);await panel.getByRole('button',{name:'Save and connect'}).click();await panel.getByRole('alert').getByText(/Synthetic token needs ads_read/).waitFor();assert.equal(accessSaved,false);
  failToken=false;await panel.getByRole('button',{name:'Save and connect'}).click();await panel.getByRole('status').getByText(/Meta access saved/).waitFor();assert.equal(await tokenField.inputValue(),'');assert.equal(tokenWrites,2);
  assert.equal(await page.evaluate(value=>JSON.stringify({...localStorage,...sessionStorage}).includes(value),fakeToken),false,'Token never enters browser storage');
  await page.reload();await panel.getByText('Ad cost is missing',{exact:false}).waitFor();assert.equal(await tokenField.inputValue(),'');
  await panel.getByRole('button',{name:'Check Meta connection'}).click();await panel.getByLabel('Ad account',{exact:true}).waitFor({state:'visible'});
  await panel.screenshot({path:`/tmp/icash-meta-setup-${name.startsWith('mobile')?'mobile':'desktop'}.png`});
  const card=panel.locator('article');await card.getByLabel('Ad cost for 123 Fixture Street').fill('11.20');
  failSave=true;await card.getByRole('button',{name:'Save lead cost'}).click();await panel.getByRole('alert').getByText(/Synthetic save failure/).waitFor();
  const requestId=writes[0].requestId;failSave=false;await card.getByRole('button',{name:'Save lead cost'}).click();await panel.getByRole('status').getByText(/Lead cost recorded/).waitFor();
  assert.equal(writes[1].requestId,requestId,'Retry reuses the original idempotency key');
  await card.locator('dd').filter({hasText:'-$11.12'}).waitFor();assert.match(await card.innerText(),/\$11.24/);assert.match(await card.innerText(),/\$0.12/);assert.match(await card.innerText(),/AM|PM/);
  await panel.getByRole('button',{name:'Save estimate for new leads'}).click();await panel.getByRole('status').getByText(/Estimate saved/).waitFor();assert.equal(writes.at(-1).source,'meta');
  await panel.getByText('DealMachine research usage is 3× its saved provider cost. Other usage stays at 2×.',{exact:false}).waitFor();assert.equal(await panel.getByRole('button',{name:'Save price threshold'}).count(),0);
  await panel.getByRole('button',{name:'Check Meta connection'}).click();
  await panel.getByLabel('Ad account',{exact:true}).selectOption('act_123456789');await panel.getByLabel('Meta campaign',{exact:true}).selectOption('987654321');
  await panel.getByRole('button',{name:'Start automatic cost tracking'}).click();await panel.getByText('image_ads · First import pending').waitFor();assert.equal(writes.at(-1).metaCampaignId,'987654321');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Cost controls fit desktop and mobile');
  assert.deepEqual(errors,[]);await panel.screenshot({path:`/tmp/icash-lead-costs-${name.startsWith('mobile')?'mobile':'desktop'}.png`});
  await panel.getByText('Connect another campaign or update access',{exact:true}).click();await tokenField.fill(fakeToken);denied=true;await panel.getByRole('button',{name:'Save and connect'}).click();await panel.getByText('Platform owner access required. Sign in again.').waitFor();assert.equal(await panel.locator('article').count(),0,'Authorization loss clears private lead details');assert.equal(await tokenField.count(),0,'Authorization loss clears the token form');
  console.log('PASS '+name+' lead costs: visible private Meta setup, invalid-token recovery, reload uses saved access, cleared credentials on denial, exact dollars, historical $0.12 retained and responsive layout.');
 }catch(e){console.error({name,writes,errors,body:await page.locator('body').innerText()});throw e;}finally{await context.close();}
}
