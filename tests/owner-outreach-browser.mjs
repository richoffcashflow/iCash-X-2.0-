import assert from 'node:assert/strict';
import {ownerOutreachFixture} from './helpers/owner-outreach-fixture.mjs';

export async function verifyOwnerOutreach(browser,base,options,name,fixtureCookies,overviewFixture){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
 let failure=false,denied=false,external=0;const errors=[],requests=[];
 try{
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==base){external++;return route.abort();}
   if(url.pathname==='/api/admin/callback-context'){
    const body=route.request().postDataJSON(),matches=body.phone==='+12125550199'?[{account:'Example customer',accountId:'11111111-1111-4111-8111-111111111111',address:'Callback Fixture Lane',screeningId:'22222222-2222-4222-8222-222222222222',businessNumber:body.businessNumber??'+14243948384',lastContactAt:'2026-10-19T19:30:00Z',available:true}]:[];
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({report:{phone:body.phone,businessNumber:body.businessNumber,status:matches.length?'matched':'unknown',matches}})});
   }
   if(url.pathname==='/api/admin/outreach'){
    requests.push(url);
    return route.fulfill({status:denied?403:failure?503:200,contentType:'application/json',body:JSON.stringify(denied?{error:'Owner required'}:failure?{error:'Fixture outage'}:ownerOutreachFixture(url))});
   }
   if(url.pathname==='/api/admin/overview'){
    const data=overviewFixture(url),r=data.report;r.leadCount=1;r.funnel[0].count=1;r.matchedCount=url.searchParams.get('q')?0:1;r.leads=r.matchedCount?[{id:'inbound-fixture',name:'Inbound Fixture Seller',address:null,phone:'+12125550199',email:null,state:'awaiting_address',source:'meta',campaign:null,assignedTo:'Assigned Fixture Customer',createdAt:r.endAt}]:[];
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Fixture unavailable"}'});
   if(url.pathname==='/admin')return route.fulfill({response:await route.fetch({headers:{...route.request().headers(),cookie:fixtureCookies},maxRedirects:0})});
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/admin');
  const panel=page.getByRole('region',{name:'Outbound leads & outreach'});
  await panel.getByText('123 Example Street',{exact:true}).waitFor();
  assert.match(await panel.innerText(),/4\s*1 seller responses/);
  assert.match(await panel.innerText(),/3\s*2 incoming replies/);
  assert.match(await panel.innerText(),/0 with interested sellers/);
  assert.match(await panel.innerText(),/2:30 PM/);
  const inbound=page.getByRole('region',{name:'Inbound seller leads'});
  await inbound.getByText('Inbound Fixture Seller',{exact:true}).waitFor();
  await inbound.getByText('Waiting for property address',{exact:true}).waitFor();
  await inbound.getByText('Assigned Fixture Customer',{exact:true}).waitFor();
  await inbound.getByLabel('Search inbound seller or property').fill('missing');
  await inbound.getByRole('button',{name:'Search inbound',exact:true}).click();
  await inbound.getByText('No inbound leads match this period and search.',{exact:true}).waitFor();
  assert.equal(await panel.getByText('123 Example Street',{exact:true}).count(),1,'Inbound search preserves outbound results');
  await inbound.getByRole('button',{name:'Clear inbound search'}).click();
  await inbound.getByText('Inbound Fixture Seller',{exact:true}).waitFor();
  assert.equal(await page.getByRole('navigation',{name:'Lead activity'}).getByRole('link').count(),2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'No horizontal page overflow');
  await panel.getByText('Seller calling back? Find their property',{exact:true}).click();
  await panel.getByLabel('Seller’s phone',{exact:true}).fill('(212) 555-0199');
  await panel.getByRole('button',{name:'Find property',exact:true}).click();
  await panel.getByText('Callback Fixture Lane',{exact:true}).waitFor();
  assert.match(await panel.innerText(),/Confirm this is the property/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Callback lookup fits mobile');
  await panel.getByLabel('Seller’s phone',{exact:true}).fill('2125550100');
  assert.equal(await panel.getByText('Callback Fixture Lane',{exact:true}).count(),0,'Editing caller clears previous account/property');
  await panel.getByRole('button',{name:'Find property',exact:true}).click();
  await panel.getByText('No recent outreach matches. Ask which property they are calling about.',{exact:true}).waitFor();
  await panel.getByText('Seller calling back? Find their property',{exact:true}).click();
  await panel.getByRole('combobox',{name:'Show'}).selectOption('interested');
  await panel.getByText('No properties match this period and filter.',{exact:true}).waitFor();
  assert.match(await panel.innerText(),/4\s*1 seller responses/,'Filtering the list cannot change activity totals');
  await panel.getByRole('combobox',{name:'Show'}).selectOption('all');
  await panel.getByLabel('Search property or account',{exact:true}).fill('missing');
  await panel.getByRole('button',{name:'Search',exact:true}).click();
  await panel.getByText('No properties match this period and filter.',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'Clear outreach search'}).click();
  await panel.getByText('123 Example Street',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Today',exact:true}).click();
  await panel.getByText('DealMachine · Today',{exact:true}).waitFor();
  await panel.getByText('123 Example Street',{exact:true}).waitFor();
  await page.getByRole('checkbox',{name:'Include my account in usage & outreach'}).check();
  await panel.getByText('123 Example Street',{exact:true}).waitFor();
  assert(requests.some(url=>url.searchParams.get('days')==='1'&&url.searchParams.get('includeOwner')==='true'));
  failure=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await panel.getByText('Outreach refresh failed. Showing the last saved activity.',{exact:true}).waitFor();
  assert.match(await panel.innerText(),/123 Example Street/);
  failure=false;await panel.getByRole('button',{name:'Retry outreach',exact:true}).click();
  await panel.getByText('Outreach refresh failed. Showing the last saved activity.',{exact:true}).waitFor({state:'hidden'});
  if(process.env.ADMIN_OUTREACH_SCREENSHOT)await page.screenshot({path:process.env.ADMIN_OUTREACH_SCREENSHOT.replace('.png',name.startsWith('mobile')?'-mobile.png':'-desktop.png'),fullPage:true});
  denied=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await panel.getByText('Sign in with the owner account to view outreach activity.',{exact:true}).waitFor();
  assert.doesNotMatch(await panel.innerText(),/123 Example Street|Example customer|0 with interested sellers/);
  assert.deepEqual(errors,[]);assert.equal(external,0);
  console.log(`PASS ${name}: outbound calls/texts/responses, separate inbound section, search/status/period/owner filters, responsive layout, stale warning and denied-data clearing.`);
 }finally{await context.close();}
}
