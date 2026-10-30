import assert from 'node:assert/strict';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export async function verifyTargeting(browser,base,options,name,cookies,overview){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});let outage=false,denied=false,writes=0,external=0;const errors=[];
 const definition={id:id(1),segment:'vacant_absentee',asOf:'2026-10-30'};
 const report={version:'seller-targeting-v1',checkedAt:new Date().toISOString(),cohortsTruncated:false,dedupPending:7,dedupReadyAccounts:0,configuredAccounts:1,settings:{enabled:false,mobile_verified:false},capabilities:{status:'verified',checkedAt:new Date().toISOString(),plan:{name:'Fixture',is_paid:true},filters:['is_vacant_home','has_absentee_owners'].map(filter_id=>({filter_id,type:'BOOLEAN',allowed_operators:[],is_premium_filter:false}))},experiments:[{id:id(1),enabled:false,definition}],cohorts:[{accountId:id(2),zip:'75217',strategy:'baseline',properties:37,attempted:12,pendingAttempts:4,validContactProperties:15,qualifiedConversations:3,offers:2,signedContracts:0,matureContractSamples:8,researchCostMicros:2200000,providerCostMicros:11000000,costCents:3300,costsComplete:true,qualifiedPerProviderDollar:3/11,qualifiedPerCustomerDollar:3/33,contractsPerProviderDollar:0,contractsPerCustomerDollar:0,evidenceStatus:'collecting',winnerDeclared:false}]};
 try{
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==base){external++;return route.abort();}
   if(url.pathname==='/api/admin/overview')return route.fulfill({contentType:'application/json',body:JSON.stringify(overview(url))});
   if(url.pathname==='/api/admin/targeting'){
    if(route.request().method()==='POST'){writes++;const body=route.request().postDataJSON();assert.deepEqual(body,{action:'set_enabled',enabled:true});report.settings.enabled=true;return route.fulfill({contentType:'application/json',body:'{"saved":true}'});}
    return route.fulfill({status:denied?403:outage?503:200,contentType:'application/json',body:JSON.stringify(denied||outage?{error:'Unavailable'}:{report})});
   }
   if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"error":"Fixture only"}'});
   if(url.pathname==='/admin')return route.fulfill({response:await route.fetch({headers:{...route.request().headers(),cookie:cookies},maxRedirects:0})});
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/admin');
  const panel=page.getByRole('region',{name:'Targeting experiments'});await panel.getByText('37 / 12 / 4',{exact:true}).waitFor();
  assert.match(await panel.innerText(),/27.27 \/ 0.00/);assert.match(await panel.innerText(),/Collecting/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Targeting tables scroll inside the panel');
  await panel.getByRole('button',{name:'Enable experiments',exact:true}).click();await panel.getByRole('button',{name:'Pause experiments',exact:true}).waitFor();assert.equal(writes,1);
  if(process.env.ICASH_TARGETING_SCREENSHOTS==='true')await panel.screenshot({path:`/tmp/icash-targeting-${name.startsWith('desktop')?'desktop':'mobile'}.png`});
  outage=true;await panel.getByRole('button',{name:'Refresh targeting',exact:true}).click();await panel.getByRole('alert').waitFor();assert.match(await panel.innerText(),/saved view/);assert.equal(await panel.getByRole('button',{name:'Pause experiments',exact:true}).isDisabled(),true);
  outage=false;denied=true;await panel.getByRole('button',{name:'Refresh targeting',exact:true}).click();await panel.getByText('37 / 12 / 4',{exact:true}).waitFor({state:'detached'});
  assert.equal(writes,1);assert.equal(external,0);assert.deepEqual(errors,[]);
  console.log(`PASS ${name}: targeting samples, costs, controls, contained tables, stale-state safety and owner revocation. Fixtures only.`);
 }finally{await context.close();}
}
