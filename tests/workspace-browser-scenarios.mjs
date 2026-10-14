import assert from 'node:assert/strict';
import {makeWorkspaceFixture,fixtureAccount} from './fixtures/workspace-volume.mjs';

export async function verifyWorkspace(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
 const page=await context.newPage(),errors=[],writes=[],external=[];
 page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(20000);page.on('dialog',dialog=>void dialog.accept());
 let scenario='lead',preview=true,emptySearch=false;
 const network={vip:true,hasActiveDeal:true,enrolledBuyers:20,settings:{enabled:true,mailingAddress:'Example Company, 100 Sample Lane, Demo City, TX 75001'},matches:8,emailed:6,interested:1,responses:2,buyers:[{id:'sample-response',dealId:'sample-deal',name:'Avery Morgan',email:'avery@example.invalid',address:'100 Example Street',respondedAt:'2026-10-14T15:00:00Z',state:'replied',reply:'Can I visit Thursday afternoon?'}]};
 const signed=()=>['buyers','closing','closing_waiting','cancelled','cancellation_pending'].includes(scenario);
 function work(url){
  const data=makeWorkspaceFixture({count:1});
  Object.assign(data,{textAttention:[],propertyAttentionIds:[],contacts:[],conversations:[],journeys:[],signingConfigured:true});
  const deal=data.deals[0];deal.stage=scenario.startsWith('closing')?'closing':scenario==='cancelled'?'cancelled':scenario==='cancellation_pending'?'cancellation_pending':signed()?'under_contract':'draft';
  Object.assign(data.properties[0].result.property,{financialScreening:{estimatedLoanBalanceCents:4500000,equityCents:14500000,activeLien:true,lienAmountCents:4500000,status:'title_review_needed'}});
  if(scenario==='closing_waiting')data.journeys=[{id:'sample-journey',deal_id:deal.id,screening_id:deal.screening_id,state:'reserved',wants_assignment:true,wants_viewing:false,review_reason:null,deposit_due_at:null,last_progress_at:new Date().toISOString(),envelopeState:'completed',messageReview:false,hasSlots:true,showingState:'confirmed',titleState:'sent',titleSelected:true,closingKind:'title_opened'}];
  deal.terms={...deal.terms,seller:'Example Seller',priceSource:scenario==='lead'?'proposed':'seller_reported',priceCents:9000000,assignmentFeeCents:1000000,assignmentDepositCents:200000};
  if(scenario!=='lead')data.signing=[{id:'sample-purchase',deal_id:deal.id,kind:'purchase',state:scenario==='signature'?'customer_signature_needed':signed()?'completed':'awaiting_counterparty',test_mode:false}];
  if(url.searchParams.get('query')){emptySearch=true;data.properties=[];data.deals=[];data.signing=[];}
  return data;
 }
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==base){external.push(url.origin);return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(preview){writes.push(`Preview requested ${url.pathname}`);return route.fulfill({status:403,json:{error:'Preview has no APIs'}});}
  if(request.method()!=='GET'){writes.push(url.pathname);return route.fulfill({status:403,json:{error:'Read-only fixture'}});}
  const p=url.pathname;
  if(p==='/api/account')return route.fulfill({json:{...fixtureAccount,mode:'live',vip:true,vipFeatures:true,billingModel:'membership_credits',membershipActive:true}});
  if(p==='/api/work/activity')return route.fulfill({json:work(url)});
  if(p==='/api/work/buyer-network')return route.fulfill({json:{...network,hasActiveDeal:signed()&&scenario!=='cancelled'&&scenario!=='cancellation_pending',responses:signed()?2:0,buyers:signed()?network.buyers:[]}});
  if(p==='/api/work/property-photo')return route.fulfill({json:{photo:null}});
  if(p==='/api/work/report')return route.fulfill({json:{days:Number(url.searchParams.get('days')),timezone:'UTC',startAt:'2026-10-14T00:00:00Z',endAt:'2026-10-14T18:00:00Z',leads:1,calls:0,texts:0,contracts:signed()?1:0}});
  if(p==='/api/notifications/updates')return route.fulfill({json:{items:[],preferences:{seenAt:null}}});
  if(p==='/api/work/allowance')return route.fulfill({json:{day:'2026-10-14',limitCents:10000,spentCents:0,reservedCents:0,remainingCents:10000,availableCents:10000,extraCents:0,resetsAt:'2026-10-15T05:00:00Z'}});
  if(p==='/api/work/next-action')return route.fulfill({json:{offer:null,balanceCents:12500,paused:true,checkedAt:new Date().toISOString()}});
  if(p==='/api/work/cancellations')return route.fulfill({json:{requests:scenario==='cancelled'?[{id:'sample-cancel',state:'completed',kind:'purchase',late_activity:true,created_at:'2026-10-14T15:00:00Z',reason:'Fixture'}]:[],stage:scenario==='cancellation_pending'?'cancellation_pending':signed()?'under_contract':'draft',blocked:false,hasAssignment:false,revision:'fixture'}});
  if(p==='/api/work/fulfillment')return route.fulfill({json:{dealStage:scenario.startsWith('closing')?'closing':'under_contract',documents:[],buyers:[{buyer_id:'sample-buyer',name:'Cedar Ridge Homes',rank:1,ready:true}],buyerNetwork:network,buyerPackage:{url:base+'/preview/workspace?preview=1',askingPriceCents:10000000,purchasePriceCents:9000000,assignmentFeeCents:1000000},closingUpdates:[],titleReplies:[],titleTasks:[]}});
  if(p==='/api/work/text-contact')return route.fulfill({json:{contacts:[]}});
  if(p==='/api/work/manual-call')return route.fulfill({json:{contacts:[],personalCalls:[]}});
  if(p==='/api/work/browser-call')return route.fulfill({json:{ready:false}});
  if(p==='/api/buyer-qualifications')return route.fulfill({json:{requests:[],candidates:[],hasMore:false,notice:'Fixture'}});
  if(p==='/api/work/buyer-coordination')return route.fulfill({json:{availability:null,receipt:null,assignment:null}});
  if(p==='/api/work/journeys')return route.fulfill({json:{journeys:[],messages:[]}});
  if(p==='/api/work/showings')return route.fulfill({json:{showings:[]}});
  if(p==='/api/work/buyer-demand')return route.fulfill({status:503,json:{error:'No demand fixture'}});
  return route.fulfill({status:401,json:{error:'Fixture only'}});
 });
 page.on('pageerror',error=>errors.push(error.message));
 async function checkClosingButton(card){
  const button=card.getByRole('button',{name:'Review closing',exact:true});await button.scrollIntoViewIfNeeded();
  assert(await button.isVisible(),'closing remains accessible while waiting for title');
  assert(await button.evaluate(node=>{const b=node.getBoundingClientRect(),card=node.closest('.live-property').getBoundingClientRect();return b.width>0&&b.height>=44&&b.left>=Math.max(0,card.left)&&b.right<=Math.min(innerWidth,card.right)+1;}),'closing action fits inside its card and viewport');
  return button;
 }
 try{
  await page.goto(base+'/preview/workspace?preview=1');
  await page.getByRole('heading',{name:'One property. One clear next step.'}).waitFor();
  await page.getByRole('region',{name:'Buyer activity',exact:true}).getByText('Avery Morgan',{exact:true}).first().waitFor();
  await page.getByRole('button',{name:'View buyer package',exact:true}).click();
  await page.getByRole('dialog').waitFor();assert.match(await page.getByRole('dialog').innerText(),/\$100,000/);assert.doesNotMatch(await page.getByRole('dialog').innerText(),/\$90,000|assignment fee/i);
  await page.getByRole('button',{name:'Close preview panel'}).click();
  await page.getByLabel('Preview a stage').selectOption('waiting');
  assert.equal(await page.getByRole('region',{name:'Buyers',exact:true}).count(),0);
  await page.getByText('Waiting for seller signatures',{exact:true}).waitFor();
  await page.getByLabel('Preview a stage').selectOption('lead');
  assert.equal(await page.getByRole('button',{name:'Documents',exact:true}).count(),0);
  await page.getByLabel('Preview a stage').selectOption('buyers');
  assert.equal(await page.locator('.property-milestones').count(),0);
  assert.equal(await page.locator('.property-details summary:visible').count(),0,'buyer view has no accordion menu');
  const buyerButton=page.getByRole('button',{name:'View buyer Avery Morgan',exact:true});await buyerButton.focus();await page.keyboard.press('Enter');
  await page.getByRole('dialog',{name:'Avery Morgan',exact:true}).waitFor();
  await page.keyboard.press('Escape');assert(await buyerButton.evaluate(node=>document.activeElement===node),'closing buyer panel returns keyboard focus');
  await page.getByRole('heading',{name:'Your leads',exact:true}).click();
  await page.screenshot({path:`/tmp/icash-workspace-preview-${name.startsWith('mobile')?'mobile':'desktop'}.png`,fullPage:true});
  await page.getByRole('button',{name:'Property details',exact:true}).click();
  const details=page.getByRole('dialog',{name:'Property details',exact:true});await details.waitFor();
  assert.match(await details.innerText(),/Estimated mortgage balance.*\$45,000.*Owner’s estimated equity.*\$145,000.*Not confirmed/s);
  assert.doesNotMatch(await details.innerText(),/Bot controls|About these estimates|Nearby home sales/);
  await page.screenshot({path:`/tmp/icash-property-details-${name.startsWith('mobile')?'mobile':'desktop'}.png`,fullPage:true});
  await page.keyboard.press('Escape');
  await page.getByLabel('Preview a stage').selectOption('closing');
  const closingButton=await checkClosingButton(page.locator('.live-property'));
  await page.screenshot({path:`/tmp/icash-closing-preview-${name.startsWith('mobile')?'mobile':'desktop'}.png`,fullPage:true});
  await closingButton.click();
  const closingDialog=page.getByRole('dialog',{name:'Closing',exact:true});await closingDialog.waitFor();
  assert.match(await closingDialog.innerText(),/Mortgage & title.*\$45,000.*Not confirmed/s);assert.doesNotMatch(await closingDialog.innerText(),/Owner’s estimated equity/);
  await page.keyboard.press('Escape');
  assert.deepEqual(writes,[],'sample preview never calls account/work APIs');
  preview=false;
  for(const state of ['lead','waiting','signature','buyers','closing','closing_waiting','cancelled','cancellation_pending']){
   scenario=state;await page.goto(base+'/');
   const card=page.locator('.live-property').first();await card.waitFor();
   await card.locator('.property-summary').click();
   await card.locator('.property-details').waitFor({state:'visible'});
   assert.equal(await card.getByRole('button',{name:/View deal/}).count(),0);
   assert.equal(await card.getByRole('button',{name:'Purchase draft',exact:true}).count(),0);
   if(state==='lead'){
    assert.equal(await card.locator('.deal-tools').count(),0);
    assert.equal(await page.locator('#platform-buyer-network').count(),0);
    await card.getByRole('button',{name:'Property details',exact:true}).click();
    const details=page.getByRole('dialog',{name:'Property details',exact:true});await details.waitFor();
    assert.match(await details.innerText(),/Estimated mortgage balance.*\$45,000.*Owner’s estimated equity.*\$145,000.*Reported/s);
    assert.doesNotMatch(await details.innerText(),/Bot controls|About these estimates|Nearby home sales/);
    await page.keyboard.press('Escape');
    await card.getByRole('button',{name:/Text conversation for/}).click();
    const dialog=page.getByRole('dialog');await dialog.waitFor();
    await dialog.getByRole('button',{name:'Texts',exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Calls',exact:true}).click();
    await dialog.getByRole('heading',{name:'Call history'}).waitFor();
    await dialog.getByRole('button',{name:'Close conversation'}).click();
   }
   if(state==='waiting'){
    await card.getByText('Waiting for seller signatures',{exact:true}).waitFor();
    assert.equal(await card.getByRole('heading',{name:'Review your seller agreement'}).isVisible(),false);
    assert.equal(await card.getByRole('region',{name:'Buyers',exact:true}).count(),0);
    await card.getByRole('button',{name:'Documents',exact:true}).click();
    await page.getByRole('dialog',{name:'Agreements',exact:true}).waitFor();
    await card.getByText('Prepare or edit seller agreement',{exact:true}).click();
    const seller=card.getByLabel('Seller’s full legal name(s)');await seller.fill('Unsent draft owner');
    assert.equal(await card.getByRole('button',{name:'Download assignment draft'}).count(),0);
    await page.getByRole('button',{name:'Close Agreements',exact:true}).click();
    await card.locator('.property-summary').click();await card.locator('.property-summary').click();
    await card.getByRole('button',{name:'Documents',exact:true}).click();
    assert.equal(await seller.inputValue(),'Unsent draft owner','closing a panel or lead preserves edits');
    await page.keyboard.press('Escape');
   }
   if(state==='signature'){
    await card.getByText('Your signature is next',{exact:true}).waitFor();
    await card.locator('.property-focus').getByRole('button',{name:'Review & sign',exact:true}).waitFor();
    assert.equal(await card.getByRole('dialog',{name:'Agreements',exact:true}).isVisible(),false,'required signature is visible without opening forms');
   }
   if(state==='buyers'||state.startsWith('closing')){
    const net=page.locator('#platform-buyer-network');await net.locator('.workspace-panel-trigger').waitFor();
    assert(await net.evaluate(node=>!!(node.compareDocumentPosition(document.querySelector('#workspace-properties'))&Node.DOCUMENT_POSITION_FOLLOWING)),'network is above the lead list');
    assert.equal(await card.getByRole('dialog',{name:'Closing',exact:true}).isVisible(),false);
    if(state.startsWith('closing')){
     assert.equal(await card.getByRole('region',{name:'Buyer activity',exact:true}).isVisible(),false,'closing replaces the buyer hunt');
     if(state==='closing_waiting')await card.getByRole('heading',{name:'Closing in progress',exact:true}).waitFor();
     await (await checkClosingButton(card)).click();
     const closing=card.getByRole('dialog',{name:'Closing',exact:true});await closing.waitFor();
     assert.match(await closing.innerText(),/Mortgage & title.*\$45,000.*Reported/s);assert.doesNotMatch(await closing.innerText(),/Owner’s estimated equity/);
     await page.keyboard.press('Escape');
    }else{
     await card.getByText('Avery Morgan',{exact:true}).waitFor();
     assert.equal(await card.locator('summary:visible').count(),0,'no accordion menu in the main property view');
     assert.equal(await card.getByRole('button',{name:'View buyers',exact:true}).count(),0,'buyers are already visible');
     assert.equal(await card.locator('.property-milestones').count(),0,'progress boxes do not look like tabs');
     await card.getByRole('button',{name:'View buyer Avery Morgan',exact:true}).click();
     const buyer=page.getByRole('dialog',{name:'Avery Morgan',exact:true});await buyer.waitFor();
     await buyer.getByRole('link',{name:'Email Avery Morgan',exact:true}).waitFor();
     assert.match(await buyer.innerText(),/Can I visit Thursday afternoon/);
     await buyer.getByRole('button',{name:'Viewing times & deposit',exact:true}).click();
     await page.getByRole('dialog',{name:'Visits & buyer deposit',exact:true}).waitFor();
     await page.getByText('No seller times are saved yet.',{exact:false}).waitFor();
     assert.equal(await page.getByRole('dialog',{name:'Visits & buyer deposit',exact:true}).getByRole('button',{name:'Confirm receipt & reserve property',exact:true}).count(),0,'no deposit form before a signed assignment');
     await page.keyboard.press('Escape');assert(await buyer.isVisible(),'closing a visit panel returns to its buyer');
     await buyer.getByRole('button',{name:'Review buyer funds',exact:true}).click();
     await page.getByRole('dialog',{name:'Buyer funds & signing authority',exact:true}).getByText('No buyer review requests yet.',{exact:true}).waitFor();
     await page.keyboard.press('Escape');
     await page.keyboard.press('Escape');
     await card.locator('.property-summary').click();
     await page.getByRole('searchbox').fill('no matching lead');
     await page.getByText('No matching properties in this view',{exact:true}).waitFor();
     assert(emptySearch);assert(await net.locator('.workspace-panel-trigger').isVisible(),'account-wide buyer activity survives an empty property search');
    }
   }
   if(state==='cancelled'||state==='cancellation_pending'){
    await card.getByRole('button',{name:'Review cancellation',exact:true}).click();
    const agreement=page.getByRole('dialog',{name:'Agreements',exact:true});await agreement.waitFor();
    await agreement.getByText('Cancellation needs your review',{exact:true}).waitFor();
    assert.equal(await card.getByRole('region',{name:'Buyers',exact:true}).count(),0);
    await page.keyboard.press('Escape');
   }
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'workspace fits the viewport');
  }
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[],'navigation never signs, sends, charges or changes controls');assert.deepEqual(external,[]);
  console.log(`PASS ${name}: sample preview, staged workspace, preserved edits, signing, buyers, closing, cancellation and search; zero writes.`);
 }catch(error){console.error({name,scenario,errors,writes,body:(await page.locator('body').innerText()).slice(-7000)});throw error;}
 finally{await context.close();}
}
