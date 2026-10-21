import assert from 'node:assert/strict';
export async function verifyOwnerAccounts(browser,base,options,name,fixtureCookies){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
 const id='22222222-2222-4222-8222-222222222222',viewId='33333333-3333-4333-8333-333333333333',screen='44444444-4444-4444-8444-444444444444',recording='55555555-5555-4555-8555-555555555555';
 const now=new Date().toISOString(),account={id,name:'Example Customer',email:'customer@example.invalid',ownAccount:false,fundedCents:50000,balanceCents:12345,reservedCents:200,leadCount:27,paused:true,assistantName:'Alex',createdAt:now,billingModel:'membership_credits',vip:true,membership:{state:'active',paidThrough:'2099-01-01T00:00:00Z'}};
 const view={id:viewId,expiresAt:new Date(Date.now()+1800000).toISOString(),account};
 let expired=false,denied=false;const writes=[],reads=[],errors=[];
 try{
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),path=u.pathname;
   if(u.origin!==base)return route.abort();
   if(path.startsWith('/api/')){
    const method=req.method();if(method==='GET')reads.push(u);else writes.push({path,method,body:req.postData()?req.postDataJSON():null});
    if(path==='/api/admin/accounts')return route.fulfill({status:denied?403:200,json:denied?{error:'Owner access only.'}:{report:{sort:u.searchParams.get('sort'),query:u.searchParams.get('q'),page:Number(u.searchParams.get('page')),pageSize:25,total:u.searchParams.get('q')==='missing'?0:27,accounts:u.searchParams.get('q')==='missing'?[]:[account]}}});
    if(path==='/api/admin/accounts/view'&&method==='POST')return route.fulfill({json:{url:'/admin/accounts/'+viewId,expiresAt:view.expiresAt}});
    const root='/api/admin/accounts/view/'+viewId;
    if(path===root&&method==='DELETE')return route.fulfill({json:{ended:true}});
    if(path.startsWith(root)&&expired)return route.fulfill({status:410,json:{error:'This account view has ended. Open the account again from Accounts.'}});
    if(path===root)return route.fulfill({json:{view}});
    if(path===root+'/leads')return route.fulfill({json:{query:u.searchParams.get('q'),page:Number(u.searchParams.get('page')),pageSize:12,total:1,leads:[{id:screen,address:'123 Example Street, Dallas, TX',state:'complete',financialStatus:'eligible',responded:true,interested:true,optedOut:false,createdAt:now,dealId:screen}]}});
    if(path===root+'/details')return route.fulfill({json:{conversations:[],contacts:[{name:'Fixture Seller',phones:[{number:'+12025550123',type:'mobile'}]}]}});
    if(path===root+'/call-history')return route.fulfill({json:{recordings:[{id:recording,source:'outbound',party:'seller',conversationId:screen,createdAt:now,status:'available',durationSeconds:60,audioExpiresAt:'2099-01-01T00:00:00Z'}],next:null}});
    if(path===root+'/conversation')return route.fulfill({json:{transcript:[{role:'user',message:'Yes, I would like to discuss the property.'}],next:null}});
    if(path===root+'/messages')return route.fulfill({json:{threads:[{id:screen,recipient:'+12025550123',party:'seller'}],threadId:screen,messages:[{id:recording,direction:'incoming',body:'What is your offer?',state:'received',created_at:now}],next:null,nextThread:null}});
    throw Error('Unexpected API request: '+method+' '+path);
   }
   if(path.startsWith('/admin/accounts'))return route.fulfill({response:await route.fetch({headers:{...req.headers(),cookie:fixtureCookies},maxRedirects:0})});
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/admin/accounts');await page.getByText('Example Customer',{exact:true}).waitFor();
  assert.equal(await page.getByRole('combobox',{name:'Sort by'}).inputValue(),'funded');
  await Promise.all([page.waitForResponse(r=>r.url().includes('sort=leads')),page.getByRole('combobox',{name:'Sort by'}).selectOption('leads')]);
  await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('Page 2 of 2',{exact:true}).waitFor();
  await page.getByLabel('Search accounts by name or email').fill('missing');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByText('No accounts match this search.',{exact:true}).waitFor();
  await page.getByLabel('Search accounts by name or email').fill('');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByText('Example Customer',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'account directory fits viewport');
  await page.getByRole('button',{name:'View account for Example Customer'}).click();await page.getByText('Viewing Example Customer',{exact:true}).waitFor();
  await page.getByText('$123.45',{exact:true}).waitFor();await page.getByText('123 Example Street, Dallas, TX',{exact:true}).click();await page.getByText('Fixture Seller',{exact:false}).waitFor();await page.getByText('What is your offer?',{exact:true}).waitFor();
  const audio=page.locator('audio');await audio.waitFor();assert((await audio.getAttribute('src')).startsWith('/api/admin/accounts/view/'+viewId+'/recording/audio?'));
  await page.getByText('Call details and transcript',{exact:true}).click();await page.getByText('Yes, I would like to discuss the property.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/Pause bot|Run bot|Add money|Send text|Sign contract/}).count(),0,'support inspection exposes no customer work or payment controls');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'customer view fits viewport');
  if(process.env.BROWSER_SCENARIOS==='owner-accounts')await page.screenshot({path:'/tmp/owner-account-'+(name.includes('mobile')?'mobile':'desktop')+'.png',fullPage:true});
  expired=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.getByText('Back to Accounts',{exact:true}).waitFor();assert.equal(await page.locator('audio').count(),0);assert.equal(await page.getByText('What is your offer?',{exact:true}).count(),0,'expired views clear private content');
  await page.getByRole('button',{name:'Return to admin'}).click();await page.getByRole('heading',{name:'Accounts',exact:true}).waitFor();await page.getByText('Example Customer',{exact:true}).waitFor();
  assert.equal(writes.length,2);assert.equal(writes[0].method,'POST');assert.deepEqual(writes[0].body,{accountId:id});assert.equal(writes[1].method,'DELETE');assert(!reads.some(u=>u.pathname.startsWith('/api/work/')),'customer reads never fall through to the owner’s ordinary workspace API');
  denied=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Owner access only.',{exact:false}).waitFor();assert.equal(await page.getByText('Example Customer',{exact:true}).count(),0);assert.deepEqual(errors,[]);
  console.log(`PASS ${name}: account sorting/search/paging → audited customer view → scoped recording/transcript/messages → expiry clears data → return to admin; no customer writes.`);
 }finally{await context.close();}
}
