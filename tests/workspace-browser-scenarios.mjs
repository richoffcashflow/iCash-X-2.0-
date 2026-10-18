import assert from 'node:assert/strict';
import {makeWorkspaceFixture,fixtureAccount} from './fixtures/workspace-volume.mjs';
import {workspaceAcknowledgmentVersion} from '../lib/workspace-acknowledgment-policy.ts';
import {workspaceExperienceEvents,workspaceExperienceStages} from '../lib/workspace-experience-events.ts';

// A local one-second WAV proves browser playback without calling a provider.
const fixtureAudio=Buffer.alloc(44+16000);fixtureAudio.write('RIFF');fixtureAudio.writeUInt32LE(fixtureAudio.length-8,4);fixtureAudio.write('WAVEfmt ',8);fixtureAudio.writeUInt32LE(16,16);fixtureAudio.writeUInt16LE(1,20);fixtureAudio.writeUInt16LE(1,22);fixtureAudio.writeUInt32LE(8000,24);fixtureAudio.writeUInt32LE(16000,28);fixtureAudio.writeUInt16LE(2,32);fixtureAudio.writeUInt16LE(16,34);fixtureAudio.write('data',36);fixtureAudio.writeUInt32LE(16000,40);

export async function verifyWorkspace(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
 const page=await context.newPage(),errors=[],writes=[],external=[],diagnostics=[];
 page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(20000);page.on('dialog',dialog=>void dialog.accept());
 let contractFlow=false;const contractWrites=[];
 let acknowledged=true,ackFail=false,manual=false,controlFail=false,vip=true;const acceptedWrites=[],controlWrites=[],assistantWrites=[],apiReads=[];
 let scenario='lead',preview=true,emptySearch=false,fulfillmentMode='ok',intentionalCrash=false,callMode='unavailable';
 await context.addInitScript(()=>{Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{window.fixtureMicrophoneRequests=(window.fixtureMicrophoneRequests||0)+1;throw new DOMException('Fixture microphone denied','NotAllowedError');}},configurable:true});});
 const fulfillmentHolds=new Set();
 const releaseFulfillment=()=>{for(const release of fulfillmentHolds)release();fulfillmentHolds.clear();};
 const network={vip:true,hasActiveDeal:true,enrolledBuyers:20,settings:{enabled:true,mailingAddress:'Example Company, 100 Sample Lane, Demo City, TX 75001'},matches:8,emailed:6,interested:1,responses:2,buyers:[{id:'sample-response',dealId:'sample-deal',name:'Avery Morgan',email:'avery@example.invalid',address:'100 Example Street',respondedAt:'2026-10-14T15:00:00Z',state:'replied',reply:'Can I visit Thursday afternoon?'}]};
 const waitingStages={
  deposit_due:{state:'deposit_due',envelopeState:'completed',label:'Confirm deposit receipt',dialog:'Visits & buyer deposit'},
  buyer_signing:{state:'signing',wants_assignment:true,label:'View assignment',dialog:'Agreements'},
  visit_proposed:{state:'collecting',wants_viewing:true,showingState:'proposed',label:'View visit',dialog:'Visits & buyer deposit'},
  visit_confirmed:{state:'collecting',wants_viewing:true,showingState:'confirmed',label:'View visit',dialog:'Visits & buyer deposit'},
  seller_availability:{state:'collecting',wants_viewing:true,hasSlots:false,label:'View availability',dialog:'Visits & buyer deposit'},
  buyer_preparing:{state:'ready',wants_assignment:true,label:'View buyer progress',dialog:'Visits & buyer deposit'},
  closing_payment:{state:'reserved',envelopeState:'completed',titleState:'sent',titleSelected:true,closingKind:'funds_disbursed',label:'Review payment',dialog:'Closing'},
 };
 // Intentionally oldest first: the view must choose the latest received message.
 const titleReplies=[
  {id:'title-opened',sender:'Alex at Example Title',subject:'Closing file opened',body_text:'Our fictional closing file is open. The title search is underway.',received_at:'2026-10-14T14:00:00Z',needs_review:false},
  {id:'title-documents',sender:'Alex at Example Title',subject:'Documents needed',body_text:'Please provide the signed assignment through our secure document portal. We still need the buyer entity documents before scheduling closing.',received_at:'2026-10-14T16:00:00Z',needs_review:true},
 ];
 const signed=()=>scenario.startsWith('closing')||Object.hasOwn(waitingStages,scenario)||['buyers','cancelled','cancellation_pending'].includes(scenario);
 function work(url){
  const data=makeWorkspaceFixture({count:1,manualIds:manual?['00000000-0000-4000-8000-000000000001']:[]});
  Object.assign(data,{textAttention:[],propertyAttentionIds:[],contacts:[],conversations:[],journeys:[],signingConfigured:true});
  const deal=data.deals[0];deal.stage=scenario.startsWith('closing')?'closing':scenario==='cancelled'?'cancelled':scenario==='cancellation_pending'?'cancellation_pending':signed()?'under_contract':'draft';
  Object.assign(data.properties[0].result.property,{financialScreening:{estimatedLoanBalanceCents:4500000,equityCents:14500000,activeLien:true,lienAmountCents:4500000,status:'title_review_needed'}});
  const journey=scenario==='closing_waiting'?{state:'reserved',envelopeState:'completed',titleState:'sent',titleSelected:true,closingKind:'title_opened'}:waitingStages[scenario];
  if(journey){const {label,dialog,...progress}=journey;data.journeys=[{id:'sample-journey',deal_id:deal.id,screening_id:deal.screening_id,state:'collecting',wants_assignment:false,wants_viewing:false,review_reason:null,deposit_due_at:null,last_progress_at:new Date().toISOString(),envelopeState:null,messageReview:false,hasSlots:true,showingState:null,titleState:null,titleSelected:false,closingKind:null,...progress}];}
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
  if(url.pathname==='/api/account/workspace-acknowledgment'&&request.method()==='POST'){const body=request.postDataJSON();assert.deepEqual(body,{version:workspaceAcknowledgmentVersion,accepted:true});acceptedWrites.push(body);if(ackFail)return route.fulfill({status:503,json:{error:'Fixture save failed. Please try again.'}});acknowledged=true;return route.fulfill({json:{accepted:true,version:workspaceAcknowledgmentVersion,acceptedAt:new Date().toISOString()}});}
  if(url.pathname==='/api/work/control'&&request.method()==='POST'){assert(acknowledged);const body=request.postDataJSON();assert.equal(body.screeningId,'00000000-0000-4000-8000-000000000001');assert(['takeover','return_to_bot'].includes(body.action));controlWrites.push(body);if(controlFail)return route.fulfill({status:503,json:{error:'Fixture unavailable'}});manual=body.action==='takeover';return route.fulfill({json:{saved:true}});}
  if(url.pathname==='/api/work/experience'&&request.method()==='POST'){
   const diagnostic=request.postDataJSON();assert.deepEqual(Object.keys(diagnostic).sort(),['event','stage']);
   assert(workspaceExperienceEvents.includes(diagnostic.event));assert(workspaceExperienceStages.includes(diagnostic.stage));diagnostics.push(diagnostic);
   return route.fulfill({json:{recorded:true}});
  }
  if(contractFlow&&request.method()==='POST'&&['/api/work/deals','/api/work/signing'].includes(url.pathname)){
   const body=request.postDataJSON();contractWrites.push({path:url.pathname,body});
   if(url.pathname==='/api/work/deals')return route.fulfill({json:{id:makeWorkspaceFixture({count:1}).deals[0].id,terms:body.terms,stage:'draft'}});
   assert.equal(body.action,'send');assert.equal(body.confirmed,true);assert.equal(body.signers[0].email,'seller@example.invalid');return route.fulfill({json:{message:'Fixture signing request created.',status:'awaiting_counterparty'}});
  }
  if(url.pathname==='/api/work/assistant'&&request.method()==='POST'){
   assert(vip,'Only verified VIP can submit an assistant question');const body=request.postDataJSON();assistantWrites.push(body);
   return route.fulfill({json:{id:`fixture-reply-${assistantWrites.length}`,question:body.question,state:'completed',created_at:new Date().toISOString(),answer:{text:'Fixture reply for this property.',actions:[],checkedAt:new Date().toISOString()}}});
  }
  if(request.method()!=='GET'){writes.push(url.pathname);return route.fulfill({status:403,json:{error:'Read-only fixture'}});}
  const p=url.pathname;apiReads.push(p);
  if(p==='/api/account')return route.fulfill({json:{...fixtureAccount,workspaceAcknowledged:acknowledged,mode:'live',vip,vipFeatures:vip,billingModel:'membership_credits',membershipActive:true}});
  if(p==='/api/work/assistant')return route.fulfill({json:{items:[]}});
  if(p==='/api/billing/membership')return route.fulfill({json:{membership:{state:'active',accessible:true,vip,priceCents:vip?10000:5000,paidThrough:'2026-11-16T05:00:00Z',cancelAtPeriodEnd:false}}});
  if(p==='/api/work/activity')return route.fulfill({json:work(url)});
  if(p==='/api/work/buyer-network')return route.fulfill({json:{...network,hasActiveDeal:signed()&&scenario!=='cancelled'&&scenario!=='cancellation_pending',responses:signed()?2:0,buyers:signed()?network.buyers:[]}});
  if(p==='/api/work/property-photo')return route.fulfill({json:{photo:null}});
  if(p==='/api/work/report')return route.fulfill({json:{days:Number(url.searchParams.get('days')),timezone:'UTC',startAt:'2026-10-14T00:00:00Z',endAt:'2026-10-14T18:00:00Z',leads:1,calls:0,texts:0,contracts:signed()?1:0}});
  if(p==='/api/notifications/updates')return route.fulfill({json:{items:[],preferences:{seenAt:null}}});
  if(p==='/api/work/allowance')return route.fulfill({json:{day:'2026-10-14',limitCents:10000,spentCents:0,reservedCents:0,remainingCents:10000,availableCents:10000,extraCents:0,resetsAt:'2026-10-15T05:00:00Z'}});
  if(p==='/api/work/next-action')return route.fulfill({json:{offer:null,balanceCents:12500,paused:true,checkedAt:new Date().toISOString()}});
  if(p==='/api/work/cancellations')return route.fulfill({json:{requests:scenario==='cancelled'?[{id:'sample-cancel',state:'completed',kind:'purchase',late_activity:true,created_at:'2026-10-14T15:00:00Z',reason:'Fixture'}]:[],stage:scenario==='cancellation_pending'?'cancellation_pending':signed()?'under_contract':'draft',blocked:false,hasAssignment:false,revision:'fixture'}});
  if(p==='/api/work/fulfillment'){
   if(fulfillmentMode==='hold')await new Promise(resolve=>fulfillmentHolds.add(resolve));
   if(fulfillmentMode==='fail')return route.fulfill({status:503,json:{error:'Fixture unavailable'}});
   return route.fulfill({json:{dealStage:scenario.startsWith('closing')?'closing':'under_contract',documents:[],buyers:[{buyer_id:'sample-buyer',name:'Cedar Ridge Homes',rank:1,ready:true}],buyerNetwork:network,buyerPackage:{url:base+'/preview/workspace?preview=1',askingPriceCents:10000000,purchasePriceCents:9000000,assignmentFeeCents:1000000},closingUpdates:[],titleReplies:['closing_waiting','closing_recovery'].includes(scenario)?titleReplies:[],titleTasks:[],...(scenario==='closing_recovery'?{closingSetup:{setup:null,verifiedContact:null,directory:[],buyerSuggestions:[],titleEmailInAgreement:null}}:{})}});
  }
  if(p==='/api/work/text-contact')return route.fulfill({json:{contacts:[]}});
  if(p==='/api/work/manual-call')return route.fulfill({json:{businessNumber:'+12025550199',contacts:[{phone:'+12025550101',name:'Example Seller',available:callMode!=='blocked',reason:callMode==='blocked'?'This contact asked not to be called.':''},...(callMode==='multiple'?[{phone:'+12025550102',name:'Other Seller',available:true}]:[])],personalCalls:[]}});
  if(p==='/api/work/browser-call')return route.fulfill({json:{ready:callMode!=='unavailable'}});
  if(p==='/api/work/call-history')return route.fulfill({json:{recordings:[{id:'33333333-3333-4333-8333-333333333333',status:'available',createdAt:'2026-10-16T05:00:00Z',durationSeconds:62,audioAvailable:true,audioExpiresAt:'2027-01-01T05:00:00Z',source:'outbound',party:'seller',conversationId:null}],next:null}});
  if(p==='/api/work/recording/audio')return route.fulfill({contentType:'audio/wav',body:fixtureAudio});
  if(p==='/api/buyer-qualifications')return route.fulfill({json:{requests:[],candidates:[],hasMore:false,notice:'Fixture'}});
  if(p==='/api/work/buyer-coordination')return route.fulfill({json:{availability:null,receipt:null,assignment:scenario==='deposit_due'?{id:'signed-buyer-assignment',buyer:'Cedar Ridge Homes',depositCents:200000}:null}});
  if(p==='/api/work/journeys')return route.fulfill({json:{journeys:[],messages:[]}});
  if(p==='/api/work/showings')return route.fulfill({json:{showings:[]}});
  if(p==='/api/work/buyer-demand')return route.fulfill({status:503,json:{error:'No demand fixture'}});
  return route.fulfill({status:401,json:{error:'Fixture only'}});
 });
 page.on('pageerror',error=>{if(!(intentionalCrash&&error.message==='Intentional workspace recovery fixture'))errors.push(error.message);});
 async function checkClosingButton(card){
  const button=card.getByRole('button',{name:'Review closing',exact:true});await button.scrollIntoViewIfNeeded();
  assert(await button.isVisible(),'closing remains accessible while waiting for title');
  assert(await button.evaluate(node=>{const b=node.getBoundingClientRect(),card=node.closest('.live-property').getBoundingClientRect();return b.width>0&&b.height>=44&&b.left>=Math.max(0,card.left)&&b.right<=Math.min(innerWidth,card.right)+1;}),'closing action fits inside its card and viewport');
  return button;
 }
 async function checkTitleMessages(panel,populated){
  const messages=panel.getByRole('region',{name:'Title company messages',exact:true});
  await messages.getByRole('heading',{name:'Title company messages',exact:true}).waitFor();
  if(!populated){await messages.getByText('No title company messages yet.',{exact:false}).waitFor();return;}
  const latest=messages.locator('.title-latest-reply');await latest.getByText('Documents needed',{exact:true}).waitFor();
  assert.match(await latest.innerText(),/Alex at Example Title/);
  assert.match(await latest.innerText(),/AM|PM/,'message timestamps use a 12-hour clock');
  assert.equal(await messages.getByText('Closing file opened',{exact:true}).isVisible(),false,'history starts collapsed');
  await messages.getByText('View all messages (2)',{exact:true}).click();
  await messages.getByText('Closing file opened',{exact:true}).waitFor();
  assert.equal(await messages.locator('details article').count(),2,'the full conversation remains one tap away');
  await messages.getByText('View all messages (2)',{exact:true}).click();
  const debt=panel.locator('.property-debt-summary');
  if(await debt.count())assert(await messages.evaluate(node=>!!(node.compareDocumentPosition(node.closest('dialog').querySelector('.property-debt-summary'))&Node.DOCUMENT_POSITION_FOLLOWING)),'title messages appear before optional mortgage details');
 }
 async function openProperty(state){
  // Finish the previous document's mocked reads before changing their fixture
  // state and navigating. WebKit can otherwise report abandoned fulfills as
  // access-control errors. Keep every page-error assertion intact.
  await page.waitForLoadState('networkidle');
  scenario=state;await page.goto(base+'/');
  const card=page.locator('.live-property').first();await card.waitFor();await card.locator('.property-summary').click();
  await card.locator('.property-details').waitFor({state:'visible'});return card;
 }
 async function retryInside(panel){
  fulfillmentMode='hold';
  const requested=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/work/fulfillment');
  await panel.getByRole('button',{name:'Try again',exact:true}).click();await requested;
  const refreshing=panel.getByRole('button',{name:'Refreshing…',exact:true});await refreshing.waitFor();
  assert(await refreshing.isDisabled(),'pending recovery cannot start duplicate requests');
  fulfillmentMode='ok';releaseFulfillment();
  await panel.getByRole('alert').waitFor({state:'hidden'});
 }
 try{
  await page.goto(base+'/preview/workspace?preview=1');
  await page.getByRole('heading',{name:'One property. One clear next step.'}).waitFor();
  await page.getByRole('region',{name:'Course walkthrough'}).waitFor();
  for(const kind of ['purchase','assignment']){
   await page.getByRole('button',{name:`Preview ${kind} contract`,exact:true}).click();
   const contract=page.getByRole('dialog',{name:`Sample ${kind} contract`,exact:true});await contract.waitFor();
   const frame=contract.frameLocator('iframe');await frame.getByText('FICTIONAL COURSE EXAMPLE · NOT FOR SIGNATURE',{exact:true}).waitFor();
   assert.match(await frame.locator('body').innerText(),kind==='purchase'?/90000.00/:/10000.00/);
   assert.equal(await frame.locator('input,button,form').count(),0);
   assert(await contract.evaluate(node=>node.getBoundingClientRect().right<=innerWidth&&node.getBoundingClientRect().left>=0),'contract dialog fits the viewport');
   await page.screenshot({path:`/tmp/icash-${kind}-contract-${name.startsWith('mobile')?'mobile':'desktop'}.png`,fullPage:true});
   await page.getByRole('button',{name:'Close contract preview'}).click();
  }
  await page.getByRole('button',{name:/^Take over ·/}).click();await page.getByRole('button',{name:/^Return to bot ·/}).waitFor();
  await page.getByRole('button',{name:/^Return to bot ·/}).click();
  await page.getByRole('button',{name:'Practice editing & cancellation',exact:true}).click();
  const workflow=page.getByRole('region',{name:'Sample contract workflow'});await workflow.waitFor();
  await workflow.getByLabel('Sample purchase price ($)',{exact:true}).fill('91000');await workflow.getByRole('button',{name:'Save sample draft'}).click();
  await workflow.getByLabel('I reviewed this sample draft.').check();await workflow.getByRole('button',{name:'Text sample contract link'}).click();
  await workflow.getByText('Sample only: awaiting seller signature. No text was sent.',{exact:true}).waitFor();
  await workflow.getByRole('button',{name:'Cancel sample contract'}).click();await workflow.getByLabel('Internal cancellation reason').fill('Course example');await workflow.getByLabel('Pause the sample property and queue sample notices.').check();await workflow.getByRole('button',{name:'Confirm sample cancellation'}).click();
  await workflow.getByText('Sample cancellation requested.',{exact:true}).waitFor();assert.deepEqual(writes,[],'edit/send/cancel demonstration has no APIs');
  await page.screenshot({path:`/tmp/icash-contract-workflow-${name.startsWith('mobile')?'mobile':'desktop'}.png`,fullPage:true});
  await page.getByRole('button',{name:'Hide contract walkthrough',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Preview first-entry acknowledgment'}).count(),0);
  await page.getByLabel('Explore a step').selectOption('buyers');

  await page.getByRole('region',{name:'Buyer activity',exact:true}).getByText('Avery Morgan',{exact:true}).first().waitFor();
  await page.getByRole('button',{name:'View buyer package',exact:true}).click();
  await page.getByRole('dialog').waitFor();assert.match(await page.getByRole('dialog').innerText(),/\$100,000/);assert.doesNotMatch(await page.getByRole('dialog').innerText(),/\$90,000|assignment fee/i);
  await page.getByRole('button',{name:'Close preview panel'}).click();
  await page.getByLabel('Explore a step').selectOption('waiting');
  assert.equal(await page.getByRole('region',{name:'Buyers',exact:true}).count(),0);
  await page.getByText('Waiting for seller signatures',{exact:true}).waitFor();
  await page.getByLabel('Explore a step').selectOption('lead');
  assert.equal(await page.getByRole('button',{name:'Documents',exact:true}).count(),0);
  await page.getByLabel('Explore a step').selectOption('buyers');
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
  await details.waitFor({state:'hidden'});
  await page.getByLabel('Explore a step').selectOption('deposit');
  await page.getByRole('button',{name:'Review buyer progress',exact:true}).click();
  const depositPreview=page.getByRole('dialog',{name:'Visits & buyer deposit',exact:true});await depositPreview.waitFor();
  assert.match(await depositPreview.innerText(),/\$2,000 due.*No receipt has been verified/s);
  assert.match(await depositPreview.innerText(),/leaving \$8,000 at closing/);
  await page.keyboard.press('Escape');await depositPreview.waitFor({state:'hidden'});
  await page.getByLabel('Explore a step').selectOption('closing');
  const closingButton=await checkClosingButton(page.locator('.live-property'));
  await page.screenshot({path:`/tmp/icash-closing-preview-${name.startsWith('mobile')?'mobile':'desktop'}.png`,fullPage:true});
  await closingButton.click();
  const closingDialog=page.getByRole('dialog',{name:'Closing',exact:true});await closingDialog.waitFor();
  assert.match(await closingDialog.innerText(),/Mortgage & title.*\$45,000.*Not confirmed/s);assert.doesNotMatch(await closingDialog.innerText(),/Owner’s estimated equity/);
  await checkTitleMessages(closingDialog,true);
  await page.screenshot({path:`/tmp/icash-title-messages-${name.startsWith('mobile')?'mobile':'desktop'}.png`,fullPage:true});
  await page.keyboard.press('Escape');
  await closingDialog.waitFor({state:'hidden'});
  await page.getByLabel('Explore a step').selectOption('closed');
  await page.getByRole('button',{name:'Review payment',exact:true}).click();
  const paymentPreview=page.getByRole('dialog',{name:'Closing',exact:true});await paymentPreview.waitFor();
  assert.match(await paymentPreview.innerText(),/Closing funds disbursed.*\$8,000.*\$2,000.*\$10,000/s);
  await page.keyboard.press('Escape');await paymentPreview.waitFor({state:'hidden'});
  await page.goto(base+'/preview/workspace?stage=lead');
  await page.getByText('Latest from the seller',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Explore a step').inputValue(),'lead');
  assert.deepEqual(writes,[],'sample preview never calls account/work APIs');
  await page.goto(base+'/preview/workspace?preview=1&recovery=1');
  const recovery=page.getByRole('region',{name:'Recovery example',exact:true});await recovery.waitFor();
  await recovery.getByRole('button',{name:'Break sample panel',exact:true}).click();intentionalCrash=true;
  await recovery.getByRole('button',{name:'Open recovery example',exact:true}).click();
  const failedPanel=page.getByRole('dialog',{name:'Recovery example',exact:true});
  await failedPanel.getByRole('heading',{name:'This section couldn’t open',exact:true}).waitFor();
  await failedPanel.getByRole('button',{name:'Close Recovery example',exact:true}).click();
  await page.getByRole('button',{name:'Property details',exact:true}).click();
  await page.getByRole('dialog',{name:'Property details',exact:true}).getByText('Owner’s estimated equity',{exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await recovery.getByRole('button',{name:'Restore sample panel',exact:true}).click();
  await recovery.getByRole('button',{name:'Open recovery example',exact:true}).click();
  await failedPanel.getByRole('button',{name:'Try opening again',exact:true}).click();
  await failedPanel.getByText('Sample panel opened. Your other work is still here.',{exact:true}).waitFor();
  await page.keyboard.press('Escape');intentionalCrash=false;
  assert.deepEqual(writes,[],'preview recovery never calls APIs');
  preview=false;
  acknowledged=false;ackFail=true;apiReads.length=0;await page.goto(base+'/');
  await page.getByRole('heading',{name:'Before you use iCash X'}).waitFor();
  assert.equal(await page.locator('.live-property').count(),0);assert.equal(await page.getByRole('button',{name:'Run bot',exact:true}).count(),0);
  assert(!apiReads.includes('/api/work/activity')&&!apiReads.includes('/api/work/next-action'),'workspace data and activation remain unmounted before acceptance');
  const accept=page.getByRole('button',{name:'I agree & open workspace',exact:true});assert(await accept.isDisabled());
  await page.screenshot({path:`/tmp/icash-acknowledgment-${name.startsWith('mobile')?'mobile':'desktop'}.png`,fullPage:true});
  await page.getByRole('checkbox').check();await accept.click();await page.getByRole('alert').getByText('Fixture save failed. Please try again.',{exact:true}).waitFor();
  assert.equal(await page.locator('.live-property').count(),0);assert.equal(acceptedWrites.length,1);
  ackFail=false;await accept.click();await page.locator('.live-property').first().waitFor();assert.equal(acceptedWrites.length,2);
  await page.reload();await page.locator('.live-property').first().waitFor();assert.equal(await page.getByRole('heading',{name:'Before you use iCash X'}).count(),0);
  const collapsed=page.locator('.live-property').first();assert.equal(await collapsed.locator('.property-summary').getAttribute('aria-expanded'),'false');
  const ask=collapsed.getByRole('button',{name:/^Ask AI about /});await ask.waitFor();assert.equal(await ask.getAttribute('data-vip'),'true');
  assert(await ask.evaluate(node=>{const b=node.getBoundingClientRect(),card=node.closest('.live-property').getBoundingClientRect();return b.height>=44&&b.left>=card.left&&b.right<=Math.min(innerWidth,card.right)+1;}),'Ask AI is visible and fits the collapsed card');
  await ask.click();const assistant=page.getByRole('dialog',{name:'Ask AI Bot',exact:true});await assistant.waitFor();
  await assistant.getByText('What would you like to know?',{exact:true}).waitFor();
  assert.equal(assistantWrites.length,0,'Opening Ask AI does not send a paid question');
  assert.match(await assistant.locator('.assistant-property-context').innerText(),/Example/,'The selected deal stays attached');
  await assistant.getByRole('textbox',{name:'Ask AI Bot',exact:true}).fill('What is the next step for this deal?');await assistant.getByRole('button',{name:'Send question',exact:true}).click();
  await assistant.getByText('Fixture reply for this property.',{exact:true}).waitFor();assert.equal(assistantWrites[0].screeningId,'00000000-0000-4000-8000-000000000001');
  await assistant.getByRole('button',{name:'Explain this offer',exact:true}).click();await assistant.locator('.assistant-answer').nth(1).waitFor();assert.equal(assistantWrites[1].screeningId,assistantWrites[0].screeningId,'Suggested questions keep the deal context');
  await assistant.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await collapsed.locator('.property-summary').getAttribute('aria-expanded'),'false','Asking AI does not expand or change the deal');
  vip=false;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await collapsed.locator('.property-ask-bot[data-vip="false"]').waitFor();
  const beforeLockedReads=apiReads.filter(path=>path==='/api/work/assistant').length;await ask.click();const vipReview=page.getByRole('dialog',{name:'Switch to VIP',exact:true});await vipReview.waitFor();
  assert.equal(await page.getByRole('dialog',{name:'Ask AI Bot',exact:true}).count(),0);assert.equal(apiReads.filter(path=>path==='/api/work/assistant').length,beforeLockedReads,'Standard review never fetches saved assistant replies');
  await vipReview.getByRole('button',{name:'Close',exact:true}).click();
  await page.goto(base+'/?upgrade=vip');await vipReview.waitFor();
  await vipReview.getByRole('button',{name:'Upgrade for $50',exact:true}).click();
  const paymentReview=page.getByRole('dialog',{name:'Upgrade to VIP',exact:true});await paymentReview.waitFor();
  assert(await paymentReview.getByRole('button',{name:'Continue to $50 payment',exact:true}).isDisabled(),'Course upgrade requires explicit billing consent');
  assert.equal(await paymentReview.getByRole('checkbox').isChecked(),false);
  await paymentReview.getByRole('button',{name:'Close',exact:true}).click();await vipReview.getByRole('button',{name:'Close',exact:true}).click();
  assert(!new URL(page.url()).searchParams.has('upgrade'),'Closing review does not reopen it');
  vip=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await collapsed.locator('.property-ask-bot[data-vip="true"]').waitFor();
  assert.equal(await page.getByRole('dialog',{name:'Ask AI Bot',exact:true}).count(),0,'A new VIP entitlement does not reopen a prior property conversation');
  await ask.click();await assistant.waitFor();assert.equal(assistantWrites.length,2,'Upgraded account opens the deal assistant without an automatic charge');await assistant.getByRole('button',{name:'Close',exact:true}).click();
  await page.screenshot({path:`/tmp/icash-deal-ask-ai-${name.startsWith('mobile')?'mobile':'desktop'}.png`,fullPage:true});
  controlFail=true;await collapsed.getByRole('button',{name:/^Take over ·/}).click();await collapsed.getByRole('status').getByText('Could not confirm the control change.',{exact:false}).waitFor();
  assert.equal(await collapsed.getByRole('button',{name:/^Return to bot ·/}).count(),0);
  controlFail=false;await collapsed.getByRole('button',{name:/^Take over ·/}).click();await collapsed.getByRole('button',{name:/^Return to bot ·/}).waitFor();
  await collapsed.getByRole('status').getByText('New automatic work is paused for this property.',{exact:false}).waitFor();
  await collapsed.getByRole('button',{name:/^Return to bot ·/}).click();await collapsed.getByRole('button',{name:/^Take over ·/}).waitFor();
  assert.deepEqual(controlWrites.map(write=>write.action),['takeover','takeover','return_to_bot']);

  contractFlow=true;manual=true;const manualCard=await openProperty('lead');
  await manualCard.getByRole('button',{name:'Seller is ready for an agreement',exact:true}).click();
  const manualAgreement=page.getByRole('dialog',{name:'Agreements',exact:true});await manualAgreement.waitFor();
  await manualAgreement.getByRole('button',{name:'Edit agreement',exact:true}).click();
  await manualAgreement.getByLabel('Seller’s full legal name(s)',{exact:true}).fill('Example Seller Updated');
  await manualAgreement.getByRole('button',{name:'Save draft',exact:true}).click();await manualAgreement.getByText('Draft saved. Review the document, then open Send for signatures.',{exact:true}).waitFor();
  await manualAgreement.getByRole('button',{name:'Send for signatures',exact:true}).click();
  await manualAgreement.getByLabel('Seller 1 legal name',{exact:true}).fill('Example Seller Updated');await manualAgreement.getByLabel('Signing phone',{exact:true}).fill('2025550101');await manualAgreement.getByLabel('Email for agreement updates (optional)',{exact:true}).fill('seller@example.invalid');
  await manualAgreement.getByRole('checkbox',{name:'I reviewed the agreed terms, legal description and all required signers. Send this agreement for signatures.',exact:true}).check();
  await manualAgreement.getByRole('button',{name:'Text contract link',exact:true}).click();await manualAgreement.getByText('Fixture signing request created.',{exact:true}).waitFor();
  assert.equal(contractWrites.filter(w=>w.path==='/api/work/signing').length,1);assert.equal(contractWrites.filter(w=>w.path==='/api/work/deals').length,2);
  await page.screenshot({path:`/tmp/icash-manual-contract-${name.startsWith('mobile')?'mobile':'desktop'}.png`,fullPage:true});
  await manualAgreement.getByRole('button',{name:'Close Agreements',exact:true}).click();contractFlow=false;manual=false;

  for(const state of ['lead','waiting','signature','buyers',...Object.keys(waitingStages),'closing','closing_waiting','cancelled','cancellation_pending']){
   const card=await openProperty(state);
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
    await dialog.getByRole('heading',{name:'Call recordings',exact:true}).waitFor();
    const audio=dialog.locator('audio[aria-label="Call recording"]');await audio.waitFor();assert.equal(await audio.getAttribute('preload'),'none');
    assert.equal(await dialog.getByRole('button',{name:/transcript/i}).count(),0,'Audio is available before any transcript exists');
    await audio.evaluate(async node=>{await node.play();});await page.waitForFunction(()=>{const node=document.querySelector('audio[aria-label="Call recording"]');return node&&node.readyState>=2&&node.currentTime>0;});
    await audio.evaluate(node=>node.pause());assert(apiReads.includes('/api/work/recording/audio'),'The browser fetched actual audio bytes');
    assert(!apiReads.includes('/api/work/conversation'),'Playing audio never fetches a transcript');
    await dialog.getByRole('button',{name:'Close conversation'}).click();
    callMode='single';await card.getByRole('button',{name:/^Call /}).click();
    await dialog.getByText('Allow microphone access in your browser, then try again.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.fixtureMicrophoneRequests),1,'one phone-icon click starts browser audio once');
    assert.equal(await dialog.locator('input[type="tel"],a[href^="tel:"]').count(),0);
    assert.doesNotMatch(await dialog.innerText(),/Use my phone|Call through my phone|press 1/i);
    await dialog.getByRole('button',{name:'Call seller',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.fixtureMicrophoneRequests),2,'explicit retry starts once');
    await dialog.getByRole('button',{name:'Close conversation'}).click();
    callMode='blocked';await card.getByRole('button',{name:/^Call /}).click();
    await dialog.getByText('This contact asked not to be called.',{exact:true}).waitFor();
    assert.equal(await dialog.getByRole('button',{name:'Call seller',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>window.fixtureMicrophoneRequests),2,'actual opt-out never opens audio');
    await dialog.getByRole('button',{name:'Close conversation'}).click();
    callMode='unavailable';await card.getByRole('button',{name:/^Call /}).click();
    await dialog.getByText('Calling is temporarily unavailable.',{exact:true}).waitFor();
    callMode='single';await dialog.getByRole('button',{name:'Retry',exact:true}).click();
    await dialog.getByRole('button',{name:'Call seller',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.fixtureMicrophoneRequests),2,'readiness recovery cannot revive an earlier call click');
    await dialog.getByRole('button',{name:'Close conversation'}).click();
    callMode='multiple';await card.getByRole('button',{name:/^Call /}).click();
    await dialog.getByText('Other Seller',{exact:true}).waitFor();
    assert.equal(await dialog.getByRole('button',{name:'Call seller',exact:true}).count(),2);
    assert.equal(await page.evaluate(()=>window.fixtureMicrophoneRequests),2,'multiple numbers require choosing a recipient');
    await dialog.getByRole('button',{name:'Close conversation'}).click();callMode='unavailable';
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
   if(waitingStages[state]){
    const next=waitingStages[state],button=card.locator('.property-focus').getByRole('button',{name:next.label,exact:true});
    await button.waitFor();await button.click();
    const panel=page.getByRole('dialog',{name:next.dialog,exact:true});await panel.waitFor();
    if(state==='deposit_due'){
     const confirm=panel.getByRole('button',{name:'Confirm receipt & reserve property',exact:true});await confirm.waitFor();
     assert(await confirm.isDisabled(),'opening the deposit action never confirms funds without evidence');
    }
    await page.keyboard.press('Escape');
   }
   if(state==='buyers'||(state.startsWith('closing')&&!waitingStages[state])){
    const net=page.locator('#platform-buyer-network');await net.locator('.workspace-panel-trigger').waitFor();
    assert(await net.evaluate(node=>!!(node.compareDocumentPosition(document.querySelector('#workspace-properties'))&Node.DOCUMENT_POSITION_FOLLOWING)),'network is above the lead list');
    assert.equal(await card.getByRole('dialog',{name:'Closing',exact:true}).isVisible(),false);
    if(state.startsWith('closing')){
     assert.equal(await card.getByRole('region',{name:'Buyer activity',exact:true}).isVisible(),false,'closing replaces the buyer hunt');
     if(state==='closing_waiting')await card.getByRole('heading',{name:'Closing in progress',exact:true}).waitFor();
     await (await checkClosingButton(card)).click();
     const closing=card.getByRole('dialog',{name:'Closing',exact:true});await closing.waitFor();
     assert.match(await closing.innerText(),/Mortgage & title.*\$45,000.*Reported/s);assert.doesNotMatch(await closing.innerText(),/Owner’s estimated equity/);
     await checkTitleMessages(closing,state==='closing_waiting');
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
     const funds=page.getByRole('dialog',{name:'Buyer funds & signing authority',exact:true});
     await funds.getByText('No buyer review requests yet.',{exact:true}).waitFor();
     // WebKit dispatches native dialog cancellation asynchronously. Wait for
     // each layer to close before Escape targets the parent or the page.
     await page.keyboard.press('Escape');await funds.waitFor({state:'hidden'});
     await page.keyboard.press('Escape');await buyer.waitFor({state:'hidden'});
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
  fulfillmentMode='hold';
  const closingCard=await openProperty('closing_recovery');
  await (await checkClosingButton(closingCard)).click();
  const recoveringClosing=page.getByRole('dialog',{name:'Closing',exact:true});
  await recoveringClosing.getByText('Loading closing details…',{exact:true}).waitFor();
  fulfillmentMode='fail';releaseFulfillment();
  await recoveringClosing.getByRole('alert').getByText('Could not load closing details.',{exact:true}).waitFor();
  assert.equal(await recoveringClosing.getByRole('region',{name:'Title company messages',exact:true}).count(),0,'failed initial data is not shown as an empty inbox');
  await retryInside(recoveringClosing);
  await checkTitleMessages(recoveringClosing,true);
  await recoveringClosing.getByRole('button',{name:'Set payment preference',exact:true}).click();
  const payee=recoveringClosing.getByLabel('Legal payee name');await payee.fill('Unsaved fixture payee');
  fulfillmentMode='fail';await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await recoveringClosing.getByRole('alert').getByText('Showing saved closing details. Updates could not be refreshed.',{exact:false}).waitFor();
  assert(await payee.isDisabled(),'stale closing data cannot submit a payment preference');
  assert.equal(await payee.inputValue(),'Unsaved fixture payee','failed refresh preserves entered closing details');
  await recoveringClosing.getByRole('region',{name:'Title company messages',exact:true}).locator('.title-latest-reply').getByText('Documents needed',{exact:true}).waitFor();
  await retryInside(recoveringClosing);
  assert.equal(await payee.inputValue(),'Unsaved fixture payee','successful recovery preserves entered closing details');
  assert(await payee.isEnabled());await page.keyboard.press('Escape');

  fulfillmentMode='hold';
  const buyerCard=await openProperty('buyers');
  await buyerCard.getByRole('button',{name:'Documents',exact:true}).click();
  await page.getByRole('dialog',{name:'Agreements',exact:true}).getByRole('button',{name:'Buyer details',exact:true}).click();
  const recoveringBuyers=page.getByRole('dialog',{name:'Buyers',exact:true});
  await recoveringBuyers.getByText('Loading buyer details…',{exact:true}).waitFor();
  fulfillmentMode='fail';releaseFulfillment();
  await recoveringBuyers.getByRole('alert').getByText('Could not load buyer details.',{exact:true}).waitFor();
  await retryInside(recoveringBuyers);
  await recoveringBuyers.getByRole('button',{name:'View buyer Avery Morgan',exact:true}).click();
  const recoveringBuyer=page.getByRole('dialog',{name:'Avery Morgan',exact:true});await recoveringBuyer.waitFor();
  fulfillmentMode='fail';await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await recoveringBuyer.getByRole('alert').getByText('Showing saved buyer details. Updates could not be refreshed.',{exact:false}).waitFor();
  assert.match(await recoveringBuyer.innerText(),/Can I visit Thursday afternoon/,'failed refresh keeps the buyer reply visible');
  network.buyers[0].reply='Friday afternoon works for my viewing instead.';
  await retryInside(recoveringBuyer);
  await recoveringBuyer.getByText('Friday afternoon works for my viewing instead.',{exact:true}).waitFor();
  assert.doesNotMatch(await recoveringBuyer.innerText(),/Can I visit Thursday afternoon/,'recovered selection uses the fresh reply rather than its old object');
  await page.keyboard.press('Escape');await recoveringBuyer.waitFor({state:'hidden'});
  await page.keyboard.press('Escape');await recoveringBuyers.waitFor({state:'hidden'});
  assert(diagnostics.some(item=>item.event==='panel_error'&&item.stage==='closing'),'closing load failures produce content-free diagnostics');
  assert(diagnostics.some(item=>item.event==='panel_retry'&&item.stage==='buyer_details'),'in-panel retries are observable');
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[],'navigation never signs, sends, charges or changes controls');assert.deepEqual(external,[]);
  console.log(`PASS ${name}: staged access, title messages, in-panel loading/failure/recovery, preserved drafts, crash containment, cancellation and search; required acknowledgment, takeover recovery and inert contract previews. No live work or provider requests.`);
 }catch(error){console.error({name,scenario,errors,writes,body:(await page.locator('body').innerText()).slice(-7000)});throw error;}
 finally{releaseFulfillment();await context.close();}
}
