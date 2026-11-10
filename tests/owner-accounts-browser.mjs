import assert from 'node:assert/strict';
import {fixtureAccount,makeWorkspaceFixture,uuid} from './fixtures/workspace-volume.mjs';
export async function verifyOwnerAccounts(browser,base,options,name,fixtureCookies){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
 const id='22222222-2222-4222-8222-222222222222',viewId='33333333-3333-4333-8333-333333333333',screen=uuid(1),recording='55555555-5555-4555-8555-555555555555';
 const secondId='77777777-7777-4777-8777-777777777777',secondView='66666666-6666-4666-8666-666666666666';
 const audioBytes=Buffer.alloc(16044);audioBytes.write('RIFF');audioBytes.writeUInt32LE(16036,4);audioBytes.write('WAVEfmt ',8);audioBytes.writeUInt32LE(16,16);audioBytes.writeUInt16LE(1,20);audioBytes.writeUInt16LE(1,22);audioBytes.writeUInt32LE(8000,24);audioBytes.writeUInt32LE(16000,28);audioBytes.writeUInt16LE(2,32);audioBytes.writeUInt16LE(16,34);audioBytes.write('data',36);audioBytes.writeUInt32LE(16000,40);
 const now=new Date().toISOString(),account={id,name:'Example Customer',email:'customer@example.invalid',ownAccount:false,fundedCents:50000,balanceCents:12345,reservedCents:200,leadCount:27,paused:true,assistantName:'Alex',createdAt:now,billingModel:'membership_credits',vip:true,membership:{state:'active',paidThrough:'2099-01-01T00:00:00Z'}};
 const secondAccount={...account,id:secondId,name:'Another Customer',email:'another@example.invalid',balanceCents:4200,vip:false,paused:false,assistantName:'Taylor'};
 let expired=false,denied=false,inspecting=false,manualSent=false;const writes=[],reads=[],errors=[];
 const report=u=>({days:Number(u.searchParams.get('days')??1),timezone:u.searchParams.get('timezone')??'UTC',startAt:now,endAt:now,leads:27,calls:14,texts:22,contracts:1,vipSavingsCents:0});
 function customerWork(second){const data=makeWorkspaceFixture({count:1});data.properties[0].result.property.address=second?'456 Second Street, Austin, TX':'123 Example Street, Dallas, TX';data.contacts[0].contacts[0].name=second?'Another Seller':'Fixture Seller';data.conversations=[];data.textAttention=[];data.propertyAttentionIds=[];data.responseCounts={responded:1,total:27};if(second)data.instantLeads=[{leadId:uuid(2),screeningId:uuid(2),dealId:uuid(1002),name:'Saved Instant Seller',phone:'+12025550129',address:null,state:'awaiting_address',paused:true,declinedAt:null,submittedAt:now,firstOutreachAt:now,responseAt:now,addressConfirmedAt:null,formId:'fixture',campaignId:null,holdReason:null}];return data;}
 try{
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),path=u.pathname;
   if(u.hostname==='img.dealmachine.com'){
    // Rendering the img element does not mean its bytes have arrived. Exercise
    // a delayed response so the check below observes actual image completion.
    await new Promise(resolve=>setTimeout(resolve,150));
    return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="gray"/></svg>'});
   }
   if(u.origin!==base)return route.abort();
   if(path.startsWith('/api/')){
    const method=req.method();if(method==='GET')reads.push(u);else writes.push({path,method,body:req.postData()?req.postDataJSON():null});
    // The outer signed-in workspace keeps its own revision subscription.
    if(path==='/api/work/events'&&method==='GET')return route.fulfill({status:204});
    if(path==='/api/auth/dashboard-password'&&method==='GET')return route.fulfill({json:{allowed:true,unlocked:true}});
    if(path==='/api/admin/accounts')return route.fulfill({status:denied?403:200,json:denied?{error:'Owner access only.'}:{report:{sort:u.searchParams.get('sort'),query:u.searchParams.get('q'),page:Number(u.searchParams.get('page')),pageSize:25,total:u.searchParams.get('q')==='missing'?0:27,accounts:u.searchParams.get('q')==='missing'?[]:[account,secondAccount]}}});
    if(path==='/api/admin/accounts/view'&&method==='POST'){const second=req.postDataJSON().accountId===secondId;return route.fulfill({json:{url:'/admin/accounts/'+(second?secondView:viewId),expiresAt:new Date(Date.now()+1800000).toISOString()}});}
    const second=path.includes(secondView),activeView=second?secondView:viewId,root='/api/admin/accounts/view/'+activeView;
    if(path===root&&method==='DELETE')return route.fulfill({json:{ended:true}});
    if(path.startsWith(root)&&expired)return route.fulfill({status:410,json:{error:'This account view has ended. Open the account again from Accounts.'}});
    if(path===root){inspecting=true;return route.fulfill({json:{view:{id:activeView,expiresAt:new Date(Date.now()+1800000).toISOString(),account:second?secondAccount:account}}});}
    if(path===root+'/activity')return route.fulfill({json:customerWork(second)});
    if(path===root+'/bot-status')return route.fulfill({json:second?{active:false,blocked:true,label:'A service issue is blocking work on your account.',checkedAt:new Date().toISOString()}:{active:false,label:'Waiting for the next task',checkedAt:now}});
    if(path===root+'/progress')return route.fulfill({json:{progress:{days:Number(u.searchParams.get('days')??1),timezone:u.searchParams.get('timezone')??'UTC',startAt:now,endAt:now,queued:0,screened:27,eligible:12,contacted:14,responded:1,status:second?'ready':'paused'}}});
    if(path===root+'/report')return route.fulfill({json:report(u)});
    if(path===root+'/property-photo')return route.fulfill({json:{photo:{view:'street_view',source:'DealMachine',url:'https://img.dealmachine.com/sv/35,-90.jpg',fallbackUrl:'https://img.dealmachine.com/sat/35,-90.jpg'}}});
    if(path===root+'/call-history')return route.fulfill({json:{recordings:[{id:recording,source:'outbound',party:'seller',conversationId:screen,createdAt:now,status:'available',durationSeconds:60,audioExpiresAt:'2099-01-01T00:00:00Z'}],next:null}});
    if(path===root+'/recording/audio')return route.fulfill({contentType:'audio/wav',body:audioBytes});
    if(path===root+'/conversation')return route.fulfill({json:{transcript:[{role:'user',message:'Yes, I would like to discuss the property.'}],next:null}});
    if(path===root+'/contact/text-contact')return route.fulfill({json:{contacts:[{phone:'+12025550123',name:'Fixture Seller',phone_type:'mobile',blocked:false}],dealId:uuid(1001),threadId:screen}});
    if(path===root+'/contact/messages/availability')return route.fulfill({json:{threadId:screen,manualReply:true,sendReason:null}});
    if(path===root+'/contact/messages'){
     if(method==='POST'){assert.equal(req.postDataJSON().threadId,screen);assert.equal(req.postDataJSON().message,'Can we discuss your cash sale?');manualSent=true;return route.fulfill({json:{id:uuid(404),manual:true,status:'message_accepted',state:'accepted'}});}
     return route.fulfill({json:{availabilityRequired:true,threads:[{id:screen,recipient:'+12025550123',party:'seller',manualReply:false,sendReason:'Checking text availability…'}],threadId:screen,messages:[{id:recording,thread_id:screen,author:'contact',direction:'incoming',body:'What is your offer?',state:'received',created_at:now},...(manualSent?[{id:uuid(404),thread_id:screen,author:'you',direction:'outgoing',body:'Can we discuss your cash sale?',state:'accepted',created_at:now}]:[])],next:null,nextThread:null}});
    }
    if(path===root+'/contact/browser-call')return route.fulfill({json:{ready:true}});
    if(path===root+'/contact/manual-call')return route.fulfill({json:{contacts:[{phone:'+12025550123',name:'Fixture Seller',available:true,businessNumber:'+12025550101',reason:null}],personalCalls:[],attempts:[]}});
    if(path===root+'/messages')return route.fulfill({json:{threads:[{id:screen,recipient:'+12025550123',party:'seller'}],threadId:screen,messages:[{id:recording,direction:'incoming',body:'What is your offer?',state:'received',created_at:now}],next:null,nextThread:null}});
    if(inspecting)throw Error('Customer workspace fell through to an ordinary API: '+method+' '+path);
    if(path==='/api/account')return route.fulfill({json:{...fixtureAccount,mode:'live',isBillingOwner:true,hasCreditHistory:true}});
    if(path==='/api/account/walkthrough')return route.fulfill({json:{tour:{step:0,state:'available'},course:{revision:1,state:'unrecorded',percent:null}}});
    if(path==='/api/work/activity')return route.fulfill({json:makeWorkspaceFixture({count:0})});
    if(path==='/api/work/report')return route.fulfill({json:report(u)});
    if(path==='/api/work/progress')return route.fulfill({json:{progress:null}});
    if(path==='/api/work/next-action')return route.fulfill({json:{card:null}});
    if(method==='GET')return route.fulfill({status:401,json:{error:'Fixture only'}});
    throw Error('Unexpected API request: '+method+' '+path);
   }
   if(path==='/'||path==='/admin/accounts')inspecting=false;
   if(path.startsWith('/admin/accounts'))return route.fulfill({response:await route.fetch({headers:{...req.headers(),cookie:fixtureCookies},maxRedirects:0})});
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/');const tabs=page.getByRole('navigation',{name:'Workspace navigation'});await tabs.getByRole('link',{name:'Accounts',exact:true}).click();await page.getByText('Example Customer',{exact:true}).waitFor();
  assert.equal(await page.getByRole('combobox',{name:'Sort by'}).inputValue(),'funded');
  await Promise.all([page.waitForResponse(r=>r.url().includes('sort=leads')),page.getByRole('combobox',{name:'Sort by'}).selectOption('leads')]);
  await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('Page 2 of 2',{exact:true}).waitFor();
  await page.getByLabel('Search accounts by name or email').fill('missing');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByText('No accounts match this search.',{exact:true}).waitFor();
  await page.getByLabel('Search accounts by name or email').fill('');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByText('Example Customer',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'account directory fits viewport');
  await page.getByRole('button',{name:'Open workspace for Example Customer'}).click();await page.getByText('Viewing Example Customer',{exact:true}).waitFor();
  await page.getByText('$123.45',{exact:true}).waitFor();await page.getByRole('heading',{name:'Bot activity',exact:true}).waitFor();await page.getByRole('heading',{name:'Your leads',exact:true}).waitFor();
  await Promise.all([page.waitForResponse(r=>r.url().includes('/report?days=7')),page.getByRole('group',{name:'Activity period'}).getByRole('button',{name:'7 days',exact:true}).click()]);
  const reportRead=reads.findLast(u=>u.pathname===`/api/admin/accounts/view/${viewId}/report`&&u.searchParams.get('days')==='7');assert(reportRead,'Owner inspection preserves its scoped period report');
  assert.equal(await page.getByRole('region',{name:'Bot activity'}).count(),1);
  assert.equal(await page.getByRole('region',{name:'Opportunity progress'}).count(),0);
  assert.equal(await page.getByRole('region',{name:'Work credit receipt'}).count(),0);
  assert(!reads.some(u=>u.pathname===`/api/admin/accounts/view/${viewId}/progress`),'Owner inspection does not poll removed progress cards');
  await Promise.all([page.waitForResponse(r=>r.url().includes('/activity?view=responses')),page.getByRole('button',{name:'Seller responses',exact:true}).click()]);
  await Promise.all([page.waitForResponse(r=>r.url().includes('/activity?view=all')),page.getByRole('button',{name:'All activity',exact:true}).click()]);
  const card=page.locator('#property-'+screen);await card.getByRole('img',{name:'Street view of 123 Example Street, Dallas, TX'}).waitFor();
  await page.waitForFunction(selector=>{const img=document.querySelector(selector);return img instanceof HTMLImageElement&&img.complete&&img.naturalWidth>0;},'#property-'+screen+' .property-thumbnail img',{timeout:5000});
  assert(await card.locator('.property-thumbnail img').evaluate(img=>img.complete&&img.naturalWidth>0),'Customer-view property photo renders');await card.locator('.property-summary').click();await card.getByRole('button',{name:'Property details',exact:true}).click();await page.getByRole('dialog').getByText('Fixture Seller',{exact:true}).waitFor();await page.getByRole('button',{name:'Close Property details',exact:true}).click();
  await card.getByRole('button',{name:'Text conversation for 123 Example Street'}).click();await page.getByText('What is your offer?',{exact:true}).waitFor();
  const composer=page.getByRole('textbox',{name:'Text message'});await composer.fill('Can we discuss your cash sale?');
  await page.getByRole('button',{name:'Send text',exact:true}).click();await page.locator('.message-bubble').getByText('Can we discuss your cash sale?',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('textarea')?.value==='');assert.equal(await composer.inputValue(),'');
  assert.equal(writes.filter(w=>w.path===rootPath()).length,1,'Owner send uses the selected customer contact API');
  function rootPath(){return '/api/admin/accounts/view/'+viewId+'/contact/messages';}
  await page.getByRole('dialog').getByRole('button',{name:'Calls',exact:true}).click();
  await page.getByRole('heading',{name:'Call the seller',exact:true}).waitFor();
  assert.equal(writes.filter(w=>w.path.endsWith('/contact/browser-call')).length,0,'Browsing call history does not dial');
  const audio=page.locator('audio');await audio.waitFor();assert((await audio.getAttribute('src')).startsWith('/api/admin/accounts/view/'+viewId+'/recording/audio?'));
  await audio.evaluate(async node=>{node.muted=true;await node.play();node.pause();});assert(reads.some(u=>u.pathname.endsWith('/recording/audio')),'Audio bytes use the scoped account view');
  await page.getByText('Call details and transcript',{exact:true}).click();await page.getByText('Yes, I would like to discuss the property.',{exact:false}).waitFor();await page.getByRole('button',{name:'Close conversation',exact:true}).click();
  // A property Call click enters the calling flow immediately. Stop at the
  // mocked microphone boundary; never open a real device/provider connection.
  await page.evaluate(()=>{window.__ownerMicAttempts=0;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{window.__ownerMicAttempts++;throw new Error('Fixture microphone unavailable');}}});});
  await card.getByRole('button',{name:'Call 123 Example Street',exact:true}).click();
  await page.waitForFunction(()=>window.__ownerMicAttempts===1);await page.getByText('Fixture microphone unavailable',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Close conversation',exact:true}).click();
  for(const button of await page.getByRole('button',{name:/^(Pause bot|Run bot|Add money|Take over)/}).all())assert(await button.isDisabled(),'Customer work and payment controls are read-only');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'customer workspace fits viewport');
  await page.evaluate(()=>window.scrollTo(0,0));await page.getByRole('region',{name:'Customer account view'}).waitFor();
  if(process.env.BROWSER_SCENARIOS==='owner-accounts')await page.screenshot({path:'/tmp/customer-workspace-'+(name.includes('mobile')?'mobile':'desktop')+'.png',fullPage:true});
  expired=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.getByText('Back to Accounts',{exact:true}).waitFor();assert.equal(await page.locator('audio').count(),0);assert.equal(await page.locator('.live-property').count(),0,'Expired views clear the actual workspace');
  await page.getByRole('button',{name:'Switch account',exact:true}).click();await page.getByRole('heading',{name:'Accounts',exact:true}).waitFor();expired=false;
  await page.getByRole('button',{name:'Open workspace for Another Customer'}).click();await page.getByText('Viewing Another Customer',{exact:true}).waitFor();await page.getByText('$42.00',{exact:true}).waitFor();await page.locator('.property-summary').getByText('456 Second Street',{exact:true}).waitFor();assert.equal(await page.getByText('123 Example Street',{exact:true}).count(),0,'Another customer cannot inherit the previous workspace');
  const instant=page.locator('#property-'+uuid(2));await instant.getByRole('button',{name:'Texts',exact:true}).click();await instant.getByText('What is your offer?',{exact:true}).waitFor();assert(await instant.getByRole('button',{name:'Resume follow-up',exact:true}).isDisabled());
  await page.getByRole('heading',{name:'Work delayed',exact:true}).waitFor();
  await page.getByText('A service issue is blocking work on your account.',{exact:true}).waitFor();
  assert.equal(await page.locator('.bot-live-status').getAttribute('data-live'),'false','a stalled funded account cannot show a healthy live indicator');
  await page.getByRole('button',{name:'Back to my workspace',exact:true}).click();await page.waitForURL(base+'/');await page.getByText('$125.00',{exact:true}).waitFor();assert.equal(await page.getByText('Viewing Another Customer',{exact:true}).count(),0);
  const viewWrites=writes.filter(w=>!w.path.includes('/contact/'));assert.deepEqual(viewWrites.map(w=>w.method),['POST','DELETE','POST','DELETE']);assert.deepEqual(viewWrites[0].body,{accountId:id});assert.deepEqual(viewWrites[2].body,{accountId:secondId});assert.deepEqual(writes.filter(w=>w.path.includes('/contact/')).map(w=>w.path),[rootPath()]);
  await page.getByRole('navigation',{name:'Workspace navigation'}).getByRole('link',{name:'Accounts',exact:true}).click();await page.getByText('Example Customer',{exact:true}).waitFor();
  denied=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Owner access only.',{exact:false}).waitFor();assert.equal(await page.getByText('Example Customer',{exact:true}).count(),0);assert.deepEqual(errors,[]);
  console.log(`PASS ${name}: workspace Accounts tab → sorting/search → actual customer workspace/cards/filters → scoped audio/transcript/texts → expiry → another customer → own workspace. Explicit scoped manual text; no unrelated customer mutations or ordinary API fallback.`);
 }finally{await context.close();}
}
