import assert from 'node:assert/strict';
const stat=(variant,positive)=>({variant,contributors:4,attempts:400,pending:40,positive,opted_out:2,contract_trials:180,contracts:12,closing_trials:100,closings:5,cost_cents:13400,costs_complete:true,updated_at:new Date().toISOString(),effective_attempts:400,effective_pending:40,effective_positive:positive,effective_opted_out:2,effective_contract_trials:180,effective_contracts:12,effective_closing_trials:100,effective_closings:5,effective_cost_cents:13400});
export const platformLearningFixture={report:{version:'shared-v1',checkedAt:new Date().toISOString(),minimumAccounts:3,contributionCap:200,maxLearnedShare:0.6,dueAccounts:2,failedAccounts:0,lastRefresh:new Date().toISOString(),cohortsTruncated:false,recoveryEnabled:0,filterEnabled:true,cohorts:[{domain:'seller_filters',context:'seller-filters-v1',market:'75217',stats:[stat('baseline',75),stat('vacant',125)]},{domain:'seller_calls',context:'reviewed',market:'*',stats:[stat('cash_interest',150),{...stat('flexible_timing',80),costs_complete:false}]}]}};
export async function verifyPlatformLearning(browser,base,options,name,cookies,overview){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});let denied=false,outage=false,external=0;const errors=[];
 try{
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==base){external++;return route.abort();}
   if(url.pathname==='/api/admin/overview')return route.fulfill({contentType:'application/json',body:JSON.stringify(overview(url))});
   if(url.pathname==='/api/admin/learning')return route.fulfill({status:denied?403:outage?503:200,contentType:'application/json',body:JSON.stringify(denied?{error:'Owner required'}:outage?{error:'Fixture outage'}:platformLearningFixture)});
   if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"error":"Fixture only"}'});
   if(url.pathname==='/admin')return route.fulfill({response:await route.fetch({headers:{...route.request().headers(),cookie:cookies},maxRedirects:0})});
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/admin');
  const panel=page.getByRole('region',{name:'Platform learning'});await panel.getByText('3 accounts',{exact:true}).waitFor();
  await panel.locator('summary').filter({hasText:'Property sourcing'}).click();await panel.getByText('ZIP 75217',{exact:false}).waitFor();
  const calls=panel.locator('summary').filter({hasText:'Seller calls'});
  await calls.click({timeout:10000});await panel.getByText('Incomplete receipts',{exact:true}).waitFor();
  assert.match(await panel.innerText(),/AM|PM/);assert.match(await panel.innerText(),/Paused by existing controls/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Learning tables scroll within the panel');
  if(process.env.ICASH_LEARNING_SCREENSHOTS==='true')await panel.screenshot({path:`/tmp/icash-platform-learning-${name.startsWith('desktop')?'desktop':'mobile'}.png`});
  outage=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await panel.getByRole('alert').waitFor();assert.match(await panel.innerText(),/last saved view/);assert.match(await panel.innerText(),/ZIP 75217/);
  outage=false;denied=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await panel.getByText('Owner access is required to view platform learning.').waitFor();assert.equal(await panel.getByText('ZIP 75217',{exact:false}).count(),0,'Revoked access clears aggregate data');
  assert.deepEqual(errors,[]);assert.equal(external,0);console.log(`PASS ${name}: shared learning report, evidence details, mobile layout, outage retention and owner revocation.`);
 }finally{await context.close();}
}
