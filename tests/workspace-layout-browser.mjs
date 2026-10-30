import assert from 'node:assert/strict';
import {makeWorkspaceFixture,fixtureAccount,uuid} from './fixtures/workspace-volume.mjs';

// Every API is intercepted. These forms must remain usable with real-world
// text lengths, narrow screens, browser text enlargement, and failed saves.
export async function verifyWorkspaceLayout(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true}),page=await context.newPage();
 page.setDefaultTimeout(12000);
 const errors=[],unexpectedWrites=[],saved=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('dialog',dialog=>void dialog.accept());
 let mode='seller',failSave=true;
 const version='2026-10-29T04:18:51.000Z';
 const longText='Please review this property and the seller’s requested next step. '+('LongReference'.repeat(18));
 function work(url){
  const data=makeWorkspaceFixture({count:12,page:Number(url.searchParams.get('page')||0),attentionPage:Number(url.searchParams.get('attentionPage')||0)});
  Object.assign(data,{textAttention:[],contacts:[],conversations:[],propertyAttentionIds:[uuid(1)],signingConfigured:true});
  const property={screening_id:uuid(1),address:'100 Example Street, Building 2, Demo City, TX 75001'};
  data.sellerRecovery=[1,2,3,4].map(i=>({id:uuid(8000+i),screening_id:uuid(i),address:i===1?property.address:`${i} ${longText}`,reason:'no_response',quote:i===1?'No reply to delivered question':longText,review_reason:'contact_checks_expired',updated_at:version}));
  if(mode==='handoff')data.handoffs=[{...property,id:uuid(9000),party:'seller',reason:'A person was requested',summary:longText,next_action:'Confirm the next step with the seller.',state:'open'}];
  if(mode==='buyer')data.viewingRequests=[{...property,id:uuid(9001),kind:'viewing',quote:longText,timezone:'America/Chicago',created_at:version}];
  if(mode==='title'||mode==='journey')data.closingTasks=[{...property,id:uuid(9002),kind:'deadline',label:'Confirm the closing date',due_date:'2026-11-12',state:'needs_review',evidence:longText,updated_at:version,...(mode==='journey'?{recovery:{journeyId:uuid(9003),blocker:{kind:'human',note:longText,revision:1,updatedAt:version}}}:{})}];
  if(mode==='handoff')data.sellerRecovery=[];
  return data;
 }
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==base)return route.abort();
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const p=url.pathname;
  if(request.method()!=='GET'){
   if(p==='/api/work/experience')return route.fulfill({json:{recorded:true}});
   if(p==='/api/work/seller-recovery'){
    saved.push(request.postDataJSON());
    return route.fulfill(failSave?{status:503,json:{error:'Could not save this resolution. Your note is still here; please try again.'}}:{json:{saved:true}});
   }
   unexpectedWrites.push(p);return route.fulfill({status:403,json:{error:'Local layout fixture only'}});
  }
  if(p==='/api/account')return route.fulfill({json:{...fixtureAccount,mode:'live',vip:false,vipFeatures:false,billingModel:'membership_credits',membershipActive:true}});
  if(p==='/api/work/activity')return route.fulfill({json:work(url)});
  if(p==='/api/work/events')return route.continue();
  if(p==='/api/funding/status')return route.fulfill({json:{enabled:true,mode:'live',paidCents:0,needsClaim:false,packs:[]}});
  if(p==='/api/billing/membership')return route.fulfill({json:{membership:{state:'active',accessible:true,vip:false,priceCents:5000,paidThrough:'2027-11-16T05:00:00Z',cancelAtPeriodEnd:false}}});
  if(p==='/api/work/property-photo')return route.fulfill({json:{photo:null}});
  if(p==='/api/work/progress')return route.fulfill({json:{progress:null}});
  if(p==='/api/work/assistant')return route.fulfill({json:{items:[]}});
  if(p==='/api/work/next-action')return route.fulfill({json:{offer:null,balanceCents:12500,paused:true,checkedAt:version}});
  if(p==='/api/notifications/updates')return route.fulfill({json:{items:[],preferences:{seenAt:null}}});
  if(p==='/api/work/buyer-network')return route.fulfill({json:{vip:false,hasActiveDeal:false,enrolledBuyers:0,matches:0,emailed:0,interested:0,responses:0,buyers:[]}});
  if(p==='/api/work/report')return route.fulfill({json:{days:7,timezone:'America/Chicago',startAt:version,endAt:version,leads:12,calls:0,texts:0,contracts:0}});
  return route.fulfill({status:401,json:{error:'Local layout fixture only'}});
 });
 const attention=page.locator('#workspace-attention');
 async function openMode(value){
  mode=value;await page.goto(base+'/');
  await attention.locator(':scope > summary').click();
  await attention.locator('.attention-primary').first().waitFor();
 }
 async function fits(label){
  const problems=await page.evaluate(()=>{
   const problems=[];
   if(document.documentElement.scrollWidth>innerWidth+1)problems.push('page has horizontal overflow');
   for(const node of document.querySelectorAll('.workspace-review-section :is(input:not([type=hidden]),select,textarea,button,summary), .workspace-filters button, .property-quick-actions button')){
    if(!node.checkVisibility())continue;
    const box=node.getBoundingClientRect();
    if(box.left< -1||box.right>innerWidth+1)problems.push(`${node.tagName} outside viewport: ${node.textContent?.trim().slice(0,45)||node.getAttribute('aria-label')}`);
    if(node.matches('button,input:not([type=checkbox]):not([type=radio]),select,textarea')&&box.height<43)problems.push(`${node.tagName} too short: ${box.height}, ${node.textContent?.trim().slice(0,45)}`);
    if(node.matches('input:not([type=checkbox]):not([type=radio]),select,textarea')&&parseFloat(getComputedStyle(node).fontSize)<16)problems.push(`${node.tagName} text causes mobile auto-zoom`);
   }
   return problems;
  });
  assert.deepEqual(problems,[],`${name}, ${page.viewportSize().width}px, ${label}`);
 }
 async function fieldLayout(field){
  const result=await field.evaluate(node=>{
   const box=node.getBoundingClientRect(),label=node.labels[0],range=document.createRange();
   const text=[...label.childNodes].find(child=>child.nodeType===Node.TEXT_NODE&&child.textContent.trim());
   range.selectNode(text);
   const caption=range.getBoundingClientRect(),card=node.closest('.attention-primary,.attention-related').getBoundingClientRect();
   return {below:box.top>=caption.bottom+3,inside:box.left>=card.left-1&&box.right<=card.right+1,wide:box.width>=card.width-2,border:parseFloat(getComputedStyle(node).borderTopWidth)>0};
  });
  assert.deepEqual(result,{below:true,inside:true,wide:true,border:true},'label stays above a full-width, visible field');
 }
 try{
  // Both rendering engines cover a small phone, a tablet, and their default size.
  for(const width of [...new Set([options.viewport.width,320,768])]){
   await page.setViewportSize({width,height:options.viewport.height});
   await openMode('seller');
   const field=attention.getByLabel('Resolution note (not sent to the seller)',{exact:true}).first();
   await fieldLayout(field);await fits('seller follow-up');
   const pages=attention.getByRole('navigation',{name:'Request pages'});
   const previous=await pages.getByRole('button',{name:'Previous',exact:true}).boundingBox(),next=await pages.getByRole('button',{name:'Next',exact:true}).boundingBox();
   assert(Math.abs(previous.width-next.width)<2,'pagination actions have equal usable widths');
   if(width===options.viewport.width)await page.locator('.workspace-review-section').screenshot({path:`/tmp/icash-layout-form-${name.startsWith('mobile')?'mobile':'desktop'}.png`});
   await attention.getByRole('button',{name:'Show 3 more properties',exact:true}).click();
   for(const item of await attention.locator('.attention-item').all())await item.locator(':scope > summary').click();
   await fits('expanded requests and long addresses');
   await field.fill('Confirmed the next step with the seller.');
   await attention.getByRole('button',{name:'Save resolution',exact:true}).first().click();
   await attention.getByRole('alert').waitFor();
   assert.equal(await field.inputValue(),'Confirmed the next step with the seller.','failed save preserves the entered note');
   await fits('save error');
   if(width===options.viewport.width)await page.screenshot({path:`/tmp/icash-layout-${name.startsWith('mobile')?'mobile':'desktop'}.png`,fullPage:true});
   // Text zoom must reflow instead of clipping the field, actions, or tabs.
   const zoom=await page.addStyleTag({content:'.personalized-workspace :is(p,label,small,button,summary,strong,span,input,textarea,select){font-size:20px!important}'});
   await fieldLayout(field);await fits('enlarged text');await zoom.evaluate(node=>node.remove());
   await openMode('handoff');
   const handoff=attention.locator('.handoff-card');
   await handoff.getByText('Summary & assignment',{exact:true}).click();
   await fieldLayout(handoff.getByLabel('Responsible person',{exact:true}));
   await handoff.getByText('Resolve this request',{exact:true}).click();
   await fieldLayout(handoff.getByLabel('What was resolved?',{exact:true}));
   const check=handoff.getByRole('checkbox');
   assert(await check.evaluate(node=>{const b=node.getBoundingClientRect();return b.width>=16&&b.width<=24&&b.height>=16&&b.height<=24;}),'checkbox keeps its natural compact size');
   await fits('handoff, date/time, resolution and checkbox');
   await openMode('buyer');
   await attention.getByRole('button',{name:'Resolve request',exact:true}).click();
   await fieldLayout(attention.locator('.buyer-request-card').getByLabel('What was resolved?',{exact:true}));
   await fits('buyer resolution');
   await openMode('title');
   await fieldLayout(attention.getByLabel('Confirm the date',{exact:true}));await fits('closing reminder');
   await openMode('journey');
   await attention.getByText('Record the outcome',{exact:true}).click();
   await fieldLayout(attention.getByLabel('What was confirmed?',{exact:true}));await fits('journey outcome');
  }
  await openMode('seller');failSave=false;
  const field=attention.getByLabel('Resolution note (not sent to the seller)',{exact:true}).first();
  await field.fill('Confirmed the next step with the seller.');
  await attention.getByRole('button',{name:'Save resolution',exact:true}).first().click();
  await page.locator(`#recovery-${uuid(8001)}`).waitFor({state:'hidden'});
  assert.deepEqual(saved.at(-1),{id:uuid(8001),version,resolution:'Confirmed the next step with the seller.'},'layout changes preserve the exact save request');
  assert.deepEqual(unexpectedWrites,[]);assert.deepEqual(errors,[]);
  console.log(`PASS ${name}: attention forms, long content, pagination, narrow/tablet widths, enlarged text, errors and resolution saves. No live requests.`);
 }catch(error){await page.screenshot({path:`/tmp/icash-layout-failure-${name.startsWith('mobile')?'mobile':'desktop'}.png`,fullPage:true});throw error;}
 finally{await context.close();}
}
