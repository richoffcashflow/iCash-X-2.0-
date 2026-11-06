import assert from 'node:assert/strict';
import {fixtureAccount,makeWorkspaceFixture} from './fixtures/workspace-volume.mjs';

export async function verifyWalkthrough(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true}),page=await context.newPage();
 const errors=[],writes=[],external=[],reads=[];
 let account='new',acknowledged=true,locked=false,failSave=false,failLoad=false;
 let course={revision:1,state:'unrecorded',percent:null};
 const opened=new Set();
 const earlierAccess=new Set(['existing']);
 const saved=new Map([['existing',{step:0,state:'available'}]]);
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  if(path.startsWith('/api/'))reads.push(path);
  if(url.origin!==base){external.push(url.origin);return route.abort();}
  if(path==='/api/account/walkthrough'){
   if(req.method()==='POST'){
    const body=req.postDataJSON();writes.push({path,body});
    if(failSave)return route.fulfill({status:503,json:{error:'Fixture save outage'}});
    if(body.action==='course_opened'){opened.add(account);return route.fulfill({json:{courseOpened:true}});}
    saved.set(account,body);return route.fulfill({json:{tour:body}});
   }
   const courseUpdated=earlierAccess.has(account)&&course.revision>1&&['in_progress','unrecorded'].includes(course.state);
   return route.fulfill({status:failLoad?503:200,json:failLoad?{error:'Fixture read outage'}:{tour:saved.get(account)??{step:0,state:'new'},course,courseOpened:opened.has(account),courseUpdated}});
  }
  if(!['GET','HEAD'].includes(req.method())){writes.push({path,body:req.postDataJSON()});return route.fulfill({status:403,json:{error:'No live actions in this fixture'}});}
  if(path==='/api/account')return route.fulfill({json:{...fixtureAccount,email:account+'@example.invalid',balanceCents:0,workspaceAcknowledged:acknowledged,mode:'live',billingModel:'membership_credits',membershipActive:!locked}});
  if(path==='/api/work/activity')return route.fulfill({json:makeWorkspaceFixture({count:0})});
  if(path==='/api/work/next-action')return route.fulfill({json:{card:null,balanceCents:0,paused:true,checkedAt:new Date().toISOString()}});
  if(path==='/api/work/report')return route.fulfill({json:{days:7,timezone:'America/Chicago',startAt:new Date().toISOString(),endAt:new Date().toISOString(),leads:0,calls:0,texts:0,contracts:0}});
  if(path==='/api/notifications/updates')return route.fulfill({json:{items:[],preferences:{seenAt:null}}});
  if(path==='/api/billing/membership')return route.fulfill({json:{membership:{state:'active',accessible:!locked,priceCents:5000,paidThrough:'2026-12-01T00:00:00Z'}}});
  if(path==='/api/course')return route.fulfill({json:{owner:false,canUpload:false,vip:false,progress:course,assets:{video:{ready:false,name:null,revision:1},pdf:{ready:false,name:null,revision:0}}}});
  if(path.startsWith('/api/'))return route.fulfill({status:401,json:{error:'Fixture only'}});
  return route.continue();
 });
 const tour=page.getByRole('dialog');
 async function fits(){
  assert(await tour.evaluate(node=>{const card=node.querySelector('h2').parentElement,b=card.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth+1&&b.top>=0&&b.bottom<=innerHeight+1;}),'The tour card fits the viewport');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'The tour does not widen the page');
 }
 async function ready(title){await tour.getByRole('heading',{name:title,exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('dialog[open] button[disabled]'));await fits();}
 try{
  await page.goto(base+'/');await ready('First, watch the course.');
  assert.equal(reads.filter(path=>path==='/api/account/walkthrough').length,1,'Opening the tour loads saved progress once');
  assert.equal(writes.length,0,'Opening the guide never performs work or accepts terms');
  await page.screenshot({path:`/tmp/icash-walkthrough-${name.startsWith('mobile')?'mobile':'desktop'}.png`,fullPage:false});
  await page.keyboard.press('Tab');assert(await page.evaluate(()=>!!document.activeElement?.closest('dialog')),'Keyboard focus stays in the guide');
  await tour.getByRole('button',{name:'Watch course',exact:true}).click();
  await page.waitForURL(base+'/course');await page.getByRole('link',{name:'Continue workspace walkthrough',exact:true}).waitFor();
  assert.deepEqual(saved.get('new'),{step:1,state:'active'});
  await page.waitForLoadState('networkidle');assert(opened.has('new'));
  await page.getByRole('link',{name:'My workspace',exact:true}).click();
  await page.getByRole('region',{name:'Bot controls'}).waitFor();await page.waitForLoadState('networkidle');
  assert.equal(await tour.count(),0,'Opening course suppresses automatic tour');
  assert.equal(await page.getByRole('region',{name:'Getting started'}).count(),0,'Opening course hides the reminder without playback');
  await page.reload();await page.getByRole('region',{name:'Bot controls'}).waitFor();await page.waitForLoadState('networkidle');
  assert.equal(await tour.count(),0);assert.equal(await page.getByRole('region',{name:'Getting started'}).count(),0);
  await page.locator('#workspace-tour-course').click();await page.getByRole('link',{name:'Continue workspace walkthrough',exact:true}).waitFor();await page.waitForLoadState('networkidle');
  assert.equal(course.state,'unrecorded','Opening Course is not counted as watching');
  await page.getByRole('link',{name:'Continue workspace walkthrough',exact:true}).click();await ready('Your bot, at a glance.');
  await page.keyboard.press('Escape');await tour.waitFor({state:'hidden'});
  await page.getByRole('region',{name:'Bot controls'}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('[role="status"] button[disabled]'));
  await page.waitForLoadState('networkidle');await page.reload();
  await page.getByRole('region',{name:'Bot controls'}).waitFor();assert.equal(await tour.count(),0,'Dismissed guide does not pop up again');
  await page.goto(base+'/?walkthrough=1');await ready('Your bot, at a glance.');
  await tour.getByRole('button',{name:'Next',exact:true}).click();await ready('Follow your deals here.');
  await page.reload();await page.getByRole('region',{name:'Bot controls'}).waitFor();await page.waitForLoadState('networkidle');assert.equal(await tour.count(),0,'Course discovery suppresses an active saved tour too');
  await page.goto(base+'/?walkthrough=1');await ready('Your bot, at a glance.');await tour.getByRole('button',{name:'Next',exact:true}).click();await ready('Follow your deals here.');
  await tour.getByRole('button',{name:'Next',exact:true}).click();await ready('Help is always close.');
  await tour.getByRole('button',{name:'Finish walkthrough',exact:true}).click();await tour.waitFor({state:'hidden'});await page.waitForLoadState('networkidle');
  await page.reload();await page.getByRole('region',{name:'Bot controls'}).waitFor();await page.waitForLoadState('networkidle');assert.equal(await tour.count(),0);assert.equal(saved.get('new').state,'completed');
  const courseCard=page.getByRole('region',{name:'Getting started'});
  assert.equal(await courseCard.count(),0,'Finishing or replaying a tour never restores the course prompt');
  account='existing';await page.reload();await courseCard.getByRole('heading',{name:'Start here: Watch the course.',exact:true}).waitFor();
  assert.equal(await courseCard.getByRole('link',{name:'Watch course',exact:true}).getAttribute('href'),'/course','Users who have not opened the course still see its reminder');
  assert.equal(await page.locator('#workspace-tour-course').innerText(),'Training course');
  assert.equal(await page.locator('#workspace-tour-course').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(23, 23, 23)');
  for(const width of [...new Set([options.viewport.width,320])]){
   await page.setViewportSize({width,height:options.viewport.height});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Course card and navigation fit narrow screens');
   const cardBox=await courseCard.boundingBox(),controls=await page.getByRole('region',{name:'Bot controls'}).boundingBox();
   assert(cardBox.y<controls.y,'Training appears before bot controls');
   assert((await courseCard.getByRole('link',{name:'Watch course',exact:true}).boundingBox()).height>=44);
  }
  await page.setViewportSize(options.viewport);
  await page.screenshot({path:`/tmp/icash-course-discovery-${name.startsWith('mobile')?'mobile':'desktop'}.png`,fullPage:false});
  await page.getByLabel('Account menu',{exact:true}).click();await page.getByRole('button',{name:'Take a walkthrough',exact:true}).click();await ready('First, watch the course.');
  failSave=true;await page.keyboard.press('Escape');await tour.waitFor({state:'hidden'});await page.getByText('We couldn’t save your place.',{exact:false}).waitFor();
  failSave=false;await page.getByRole('status').filter({hasText:'We couldn’t save your place.'}).getByRole('button',{name:'Retry',exact:true}).click();await page.getByText('We couldn’t save your place.',{exact:false}).waitFor({state:'hidden'});
  await page.waitForLoadState('networkidle');account='existing';await page.reload();await page.getByRole('region',{name:'Bot controls'}).waitFor();await page.waitForLoadState('networkidle');assert.equal(await tour.count(),0,'Existing users are not forced through a new guide');
  await courseCard.getByRole('link',{name:'Watch course',exact:true}).waitFor();
  course={revision:1,state:'in_progress',percent:35};await page.reload();await page.waitForLoadState('networkidle');assert.equal(await courseCard.count(),0,'Existing playback also dismisses reminders');
  course={revision:1,state:'completed',percent:100};await page.reload();await page.waitForLoadState('networkidle');assert.equal(await courseCard.count(),0);
  course={revision:2,state:'unrecorded',percent:null};await page.reload();await courseCard.getByRole('link',{name:'Watch course',exact:true}).waitFor();
  const headerCourse=page.locator('#workspace-tour-course'),badge=headerCourse.getByText('Updated',{exact:true});
  await badge.waitFor();
  await page.setViewportSize({width:320,height:options.viewport.height});
  const headerBox=await headerCourse.boundingBox(),linksBox=await page.locator('.workspace-header-links').boundingBox();
  assert(headerBox.height>=44&&headerBox.x+headerBox.width<=linksBox.x,'Updated course and account controls fit on a narrow phone');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.setViewportSize(options.viewport);
  await page.screenshot({path:`/tmp/icash-course-updated-${name.replaceAll(' ','-')}.png`});
  await page.getByLabel('Account menu',{exact:true}).click();
  await page.locator('.workspace-account-options').getByRole('link',{name:/Training course\s*Updated/}).click();
  await page.getByRole('link',{name:'My workspace',exact:true}).waitFor();await page.waitForLoadState('networkidle');assert(opened.has('existing'));
  await page.getByRole('link',{name:'My workspace',exact:true}).click();await page.waitForLoadState('networkidle');assert.equal(await courseCard.count(),0);
  await badge.waitFor(); // Opening the updated course leaves the update visible.
  course={revision:2,state:'in_progress',percent:94};await page.reload();await badge.waitFor();
  course={revision:2,state:'completed',percent:95};
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await badge.waitFor({state:'hidden'});assert.equal(await headerCourse.innerText(),'Training course');
  course={revision:3,state:'unrecorded',percent:null};await page.reload();await badge.waitFor();await page.waitForLoadState('networkidle');assert.equal(await courseCard.count(),0,'A replacement video does not restore a dismissed discovery prompt');
  account='card-user';saved.set(account,{step:0,state:'available'});await page.reload();await courseCard.getByRole('link',{name:'Watch course',exact:true}).click();
  await page.getByRole('link',{name:'My workspace',exact:true}).waitFor();await page.waitForLoadState('networkidle');assert(opened.has('card-user'));
  await page.getByRole('link',{name:'My workspace',exact:true}).click();await page.waitForLoadState('networkidle');assert.equal(await courseCard.count(),0);assert.equal(await badge.count(),0,'Someone who first received this version has no badge');
  account='other-new';await page.reload();await ready('First, watch the course.');
  assert(!saved.has('other-new'),'Another account does not inherit completion');
  await page.keyboard.press('Escape');await tour.waitFor({state:'hidden'});await page.waitForLoadState('networkidle');
  course={revision:1,state:'completed',percent:100};await page.reload();await page.getByLabel('Account menu',{exact:true}).click();await page.getByRole('button',{name:'Take a walkthrough',exact:true}).click();await ready('Your course is watched.');await page.keyboard.press('Escape');await tour.waitFor({state:'hidden'});await page.waitForLoadState('networkidle');
  failLoad=true;await page.reload();await page.getByRole('region',{name:'Bot controls'}).waitFor();await page.waitForLoadState('networkidle');assert.equal(await courseCard.count(),0,'Unavailable progress does not bring back a potentially dismissed prompt');assert.equal(await page.locator('#workspace-tour-course').getAttribute('href'),'/course');
  await page.getByLabel('Account menu',{exact:true}).click();assert.equal(await page.locator('.workspace-account-options').getByRole('link',{name:'Training course',exact:true}).getAttribute('href'),'/course');await page.getByRole('button',{name:'Take a walkthrough',exact:true}).click();await ready('First, watch the course.');
  failSave=true;await tour.getByRole('button',{name:'Watch course',exact:true}).click();await page.waitForURL(base+'/course');
  // Verify the destination finishes loading before starting the next scenario.
  // Navigating away immediately can abort its mocked course fetch in WebKit.
  await page.getByRole('link',{name:'Continue workspace walkthrough',exact:true}).waitFor();
  await page.waitForLoadState('networkidle');failSave=false;failLoad=false;
  await page.goto(base+'/');await page.getByRole('region',{name:'Bot controls'}).waitFor();
  locked=true;await page.reload();await page.getByRole('heading',{name:'Renew subscription',exact:true}).waitFor();assert.equal(await tour.count(),0);locked=false;
  acknowledged=false;await page.reload();await page.getByRole('button',{name:'I agree & open workspace',exact:true}).waitFor();assert.equal(await tour.count(),0,'The guide cannot bypass acknowledgment');
  assert.equal(await page.getByRole('complementary',{name:'Start with the course'}).getByRole('link',{name:'Watch the course →',exact:true}).getAttribute('href'),'/course');
  account='existing';course={revision:3,state:'unrecorded',percent:null};await page.reload();
  await page.getByRole('link',{name:'Watch the updated course →',exact:true}).waitFor();
  assert.equal(await page.getByRole('checkbox').isChecked(),false,'Course discovery never accepts terms');
  assert(writes.every(write=>write.path==='/api/account/walkthrough'),'The tour never funds, runs a bot, accepts terms or records course playback');
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log(`PASS ${name}: first-entry course → tour → dismiss/resume/reload → complete/replay, account isolation, course evidence, saved-progress failure/retry, keyboard and viewport checks. No live work.`);
 }catch(error){console.error({name,errors,reads:reads.slice(-40),readCount:reads.length,body:(await page.locator('body').innerText()).slice(0,4500)});await page.screenshot({path:'/tmp/icash-walkthrough-failed.png'});throw error;}
 finally{await context.close();}
}
