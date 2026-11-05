import assert from 'node:assert/strict';
import {makeWorkspaceFixture,fixtureAccount,uuid} from './fixtures/workspace-volume.mjs';

export async function verifyAssistantCoach(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});const page=await context.newPage();page.setDefaultTimeout(15000);
 const writes=[],questions=[],errors=[];let changed=false,sendCount=0;
 const work=makeWorkspaceFixture({count:1});Object.assign(work,{textAttention:[],propertyAttentionIds:[],contacts:[],conversations:[],journeys:[],signingConfigured:true});
 const propertyId=work.properties[0].id,dealId=work.deals[0].id,threadId=uuid(41),messageId=uuid(42);
 const draft='What closing timeline works for you? I can walk you through the next steps.';
 const thread={id:threadId,recipient:'+12025550101',party:'buyer',paused:false,manualReply:true,sendReason:null};
 const reply={text:'Confirm the buyer’s timeline.',propertyId,checkedAt:new Date().toISOString(),coaching:{recommendation:'Confirm the buyer’s timeline before moving forward.',reason:'They asked about the next step. A deposit has not been confirmed.',steps:['Confirm their timeline and review the current terms.','Check the signed agreement before confirming a deposit.'],question:null,draft:{body:draft,party:'buyer'}},actions:[{kind:'property',label:'Review & send buyer reply',screeningId:propertyId,target:'texts',threadId,draft:{threadId,body:draft,latestMessageId:messageId,nonce:0}},{kind:'property',label:'Review agreement',screeningId:propertyId,target:'contracts'}]};
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!==base){if(url.protocol==='data:')return route.continue();return route.fulfill({status:204});}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const p=url.pathname;
  if(p==='/api/work/assistant'){
   if(req.method()==='GET')return route.fulfill({json:{items:[]}});
   const body=req.postDataJSON();questions.push(body);assert.equal(body.screeningId,propertyId);
   return route.fulfill({json:{id:uuid(100+questions.length),state:'complete',question:body.question,created_at:new Date().toISOString(),answer:reply}});
  }
  if(p==='/api/work/messages'&&req.method()==='POST'){sendCount++;writes.push(p);assert.equal(req.postDataJSON().threadId,threadId);assert.equal(req.postDataJSON().message,draft);return route.fulfill({json:{id:uuid(90),status:'message_accepted',state:'accepted'}});}
  if(p==='/api/work/experience'&&req.method()==='POST'){const event=req.postDataJSON();assert.equal(event.event,'panel_open');assert.equal(event.stage,'documents');return route.fulfill({json:{saved:true}});}
  if(p==='/api/work/messages/read')return route.fulfill({json:{saved:true}});
  if(req.method()!=='GET'){writes.push(p);return route.fulfill({status:403,json:{error:'Fixture only'}});}
  if(p==='/api/account')return route.fulfill({json:{...fixtureAccount,mode:'live',vip:true,vipFeatures:true,billingModel:'membership_credits',membershipActive:true}});
  if(p==='/api/work/activity')return route.fulfill({json:work});
  if(p==='/api/work/text-contact')return route.fulfill({json:{dealId,threadId,contacts:[]}});
  if(p==='/api/work/messages')return route.fulfill({json:{threads:[thread],threadId,messages:[{id:changed?uuid(43):messageId,thread_id:threadId,body:changed?'Actually, can we visit first?':'What happens next?',direction:'incoming',state:'received',created_at:new Date().toISOString()}],next:null,nextThread:null,receipt:null}});
  if(p==='/api/work/events')return route.fulfill({status:204});
  if(p==='/api/work/report')return route.fulfill({json:{days:Number(url.searchParams.get('days')),timezone:url.searchParams.get('timezone'),startAt:new Date().toISOString(),endAt:new Date().toISOString(),leads:1,calls:0,texts:1,contracts:0}});
  if(p==='/api/notifications/updates')return route.fulfill({json:{items:[],preferences:{seenAt:null}}});
  if(p==='/api/work/progress')return route.fulfill({json:{progress:null}});
  if(p==='/api/work/buyer-network')return route.fulfill({json:{vip:true,hasActiveDeal:false,settings:null,buyers:[]}});
  if(p==='/api/work/allowance')return route.fulfill({json:{day:'2026-11-04',limitCents:10000,spentCents:0,reservedCents:0,remainingCents:10000,availableCents:10000,extraCents:0,resetsAt:'2026-11-05T06:00:00Z'}});
  if(p==='/api/work/next-action')return route.fulfill({json:{offer:null,balanceCents:12500,paused:true,checkedAt:new Date().toISOString()}});
  if(p==='/api/work/acknowledgment')return route.fulfill({json:{accepted:true}});
  if(p==='/api/funding/status')return route.fulfill({json:{enabled:true,mode:'live',paidCents:0,needsClaim:false,packs:[]}});
  if(p==='/api/work/property-photo')return route.fulfill({json:{photo:null}});
  return route.fulfill({json:{items:[],requests:[],recordings:[],next:null}});
 });
 try{
  await page.goto(base+'/');const card=page.locator('.live-property').first();await card.waitFor();
  await card.getByRole('button',{name:/^Ask AI about/}).click();
  let dialog=page.getByRole('dialog',{name:'Ask AI Bot',exact:true});await dialog.getByText('Your deal coach',{exact:true}).waitFor();assert.equal(questions.length,0,'Opening is free');
  await dialog.getByRole('textbox',{name:'Ask AI Bot',exact:true}).fill('What should I say to this buyer?');await dialog.getByRole('button',{name:'Send question',exact:true}).click();
  await dialog.getByRole('heading',{name:'Confirm the buyer’s timeline before moving forward.'}).waitFor();
  assert.equal(sendCount,0,'Coaching never sends a message');
  assert(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1),'Coach fits mobile and desktop');
  assert(await dialog.getByRole('textbox',{name:'Ask AI Bot',exact:true}).evaluate(node=>{const b=node.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight;}),'Composer remains visible in the dialog');
  await page.screenshot({path:`/tmp/icash-ask-ai-coach-${name.startsWith('mobile')?'mobile':'desktop'}.png`,fullPage:true});
  await dialog.getByRole('button',{name:'Review agreement',exact:true}).click();
  const agreement=page.getByRole('dialog',{name:'Agreements',exact:true});await agreement.waitFor();assert.equal(sendCount,0);await agreement.getByRole('button',{name:'Close Agreements',exact:true}).click();
  await card.getByRole('button',{name:/^Ask AI about/}).click();
  await dialog.getByRole('button',{name:'Review & send buyer reply',exact:true}).click();
  const conversation=page.getByRole('dialog',{name:/100 Example Street/});await conversation.waitFor();
  const input=conversation.getByRole('textbox',{name:'Text message',exact:true});await input.waitFor();
  await page.waitForFunction(({id,draft})=>document.getElementById(id)?.value===draft,{id:'reply-'+threadId,draft});assert.equal(await input.inputValue(),draft);assert.equal(sendCount,0,'Review only prefills the exact buyer thread');
  await input.fill('My unsent draft');await conversation.getByRole('button',{name:'Close conversation',exact:true}).click();
  await card.getByRole('button',{name:/^Ask AI about/}).click();dialog=page.getByRole('dialog',{name:'Ask AI Bot',exact:true});
  await dialog.getByRole('button',{name:'Review & send buyer reply',exact:true}).click();await conversation.getByRole('region',{name:'Suggested reply'}).waitFor();assert.equal(await input.inputValue(),'My unsent draft','Existing draft remains intact');
  await conversation.getByRole('button',{name:'Keep my draft',exact:true}).click();await input.fill('');await conversation.getByRole('button',{name:'Close conversation',exact:true}).click();
  changed=true;
  await card.getByRole('button',{name:/^Ask AI about/}).click();await dialog.getByRole('button',{name:'Review & send buyer reply',exact:true}).click();
  await conversation.getByRole('region',{name:'Suggested reply'}).waitFor();assert.equal(await input.inputValue(),'','New message requires reviewing suggestion');assert.equal(sendCount,0);
  await conversation.getByRole('button',{name:'Use suggested reply',exact:true}).click();await conversation.getByRole('button',{name:'Send text',exact:true}).click();
  await page.waitForFunction(()=>document.body.innerText.includes('Sent')||document.body.innerText.includes('accepted'));assert.equal(sendCount,1,'Only explicit Send submits once');
  assert.deepEqual(errors,[]);assert.deepEqual(writes,['/api/work/messages']);
  console.log(`PASS ${name}: coaching card, exact buyer draft, no implicit send, unsent draft preservation, changed-conversation review and explicit Send.`);
 }finally{await context.close();}
}
