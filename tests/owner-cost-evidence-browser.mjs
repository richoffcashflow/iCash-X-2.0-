import assert from 'node:assert/strict';
import {join} from 'node:path';
export async function verifyCostEvidence(browser,base,options,name,fixtureCookies,fixture){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});let available=true;const errors=[];
 try{
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==base)return route.abort();
   if(url.pathname==='/api/admin/overview'){
    const f=fixture(url),r=f.report;r.costEvidence=available?{days:r.days,includeOwner:r.includeOwner,startAt:r.startAt,endAt:r.endAt,completedCount:3,missingManifestCount:1,mismatchedManifestCount:1,recordedCostMicros:2000000,verifiedMicros:250000,estimatedMicros:1500000,unclassifiedMicros:250000,dealmachineCredits:12,providers:[{provider:'dealmachine',verifiedMicros:0,estimatedMicros:1500000,unclassifiedMicros:250000},{provider:'elevenlabs',verifiedMicros:250000,estimatedMicros:0,unclassifiedMicros:0}]}:null;
    const zero={signingStarted:0,awaitingSeller:0,awaitingCustomer:0,needsReview:0,verifiedPurchases:0,verifiedAssignments:0,verifiedClosings:0,receivedDeals:0,receivedCents:0};
    r.dealOutcomes=available?{days:r.days,startAt:r.startAt,endAt:r.endAt,maxDeals:10000,truncated:false,cohorts:[{key:'customers',...zero},{key:'owner',...zero,signingStarted:2,verifiedPurchases:1,verifiedAssignments:1,verifiedClosings:1,receivedDeals:1,receivedCents:1000000}]}:null;
    return route.fulfill({contentType:'application/json',body:JSON.stringify(f)});
   }
   if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"error":"Offline fixture"}'});
   if(url.pathname==='/admin')return route.fulfill({response:await route.fetch({headers:{...route.request().headers(),cookie:fixtureCookies},maxRedirects:0})});
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/admin');
  const panel=page.getByRole('region',{name:'Cost evidence'});await panel.getByText('Verified components').waitFor();
  assert.match(await panel.innerText(),/12 credits for settled operations/);assert.match(await panel.innerText(),/1 missing cost breakdowns/);
  await panel.getByText('Cost breakdown by provider and allocation',{exact:true}).click();
  await panel.getByRole('rowheader',{name:'ElevenLabs'}).waitFor();
  assert.match(await panel.innerText(),/\$0.25/);assert.match(await panel.innerText(),/\$1.50/);
  const outcomes=page.getByRole('region',{name:'Customer and owner deal outcomes'});
  await outcomes.getByRole('columnheader',{name:'Customers',exact:true}).waitFor();
  assert.deepEqual(await outcomes.getByRole('row',{name:'Verified purchase contracts 0 1',exact:true}).getByRole('cell').allTextContents(),['0','1']);
  assert.deepEqual(await outcomes.getByRole('row',{name:'Proceeds received $0.00 $10,000.00',exact:true}).getByRole('cell').allTextContents(),['$0.00','$10,000.00']);
  await page.getByRole('checkbox',{name:'Include my account'}).check();
  await outcomes.getByText('Customer results always exclude your account.',{exact:false}).waitFor();
  assert.deepEqual(await outcomes.getByRole('row',{name:'Verified purchase contracts 0 1',exact:true}).getByRole('cell').allTextContents(),['0','1'],'Usage toggle cannot blend owner results into customer outcomes');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'cost panel must not cause page-level horizontal overflow');
  if(process.env.AUDIT_SCREENSHOT_DIR){await panel.scrollIntoViewIfNeeded();await panel.screenshot({path:join(process.env.AUDIT_SCREENSHOT_DIR,'cost-evidence-'+name.replace(/[^a-z0-9]+/gi,'-')+'.png')});}
  if(process.env.AUDIT_SCREENSHOT_DIR){await outcomes.scrollIntoViewIfNeeded();await outcomes.screenshot({path:join(process.env.AUDIT_SCREENSHOT_DIR,'deal-outcomes-'+name.replace(/[^a-z0-9]+/gi,'-')+'.png')});}
  available=false;await page.getByRole('button',{name:'Refresh',exact:true}).click();await panel.getByText('Cost evidence is unavailable. Usage margin remains unverified.').waitFor();
  assert.equal(await panel.getByRole('table').count(),0,'missing evidence cannot retain stale verified amounts');assert.deepEqual(errors,[]);
  await outcomes.getByText('Deal outcome evidence is unavailable. No customer results are inferred.').waitFor();
  assert.equal(await outcomes.getByRole('table').count(),0,'Missing outcomes cannot retain stale counts');
  console.log(name+': cost evidence, provider breakdown, responsive layout and unavailable-data state passed.');
 }finally{await context.close();}
}
