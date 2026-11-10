import assert from 'node:assert/strict';
import {makeWorkspaceFixture,fixtureAccount} from './fixtures/workspace-volume.mjs';
export async function verifyConversationInbox(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true}),page=await context.newPage(),errors=[],sends=[],otherWrites=[];
 page.setDefaultTimeout(12000);
 const data=makeWorkspaceFixture({count:1});data.textAttention=[];data.propertyAttentionIds=[];
 data.conversations=[];
 const dealId=data.deals[0].id,screenId=data.properties[0].id,tid='66666666-6666-4666-8666-666666666666',rid='33333333-3333-4333-8333-333333333333',phone='+12025550101',otherTid='99999999-9999-4999-8999-999999999998',otherPhone='+12025550102';
 let manual=false,blocked=false,zeroCredits=false,contactFailure=true,availabilityFailure=false;
 let releaseCalls;const callsWait=new Promise(resolve=>{releaseCalls=resolve;});
 let releaseAvailability;const availabilityWait=new Promise(resolve=>{releaseAvailability=resolve;});
 const read=new Set(),readRequests=[];const replyId='77777777-7777-4777-8777-777777777777';
 const first={id:'initial',thread_id:tid,direction:'outgoing',author:'bot',body:'Hi Alex, would you consider a cash offer for 100 Example Street?',state:'delivered',created_at:'2026-10-21T14:00:00Z'};
 const messages=[{...first,id:replyId,direction:'incoming',author:'contact',body:'Yes, I would like to hear more.',state:'received',created_at:'2026-10-21T14:02:00Z'},first];
 const reply=messages[0];
 messages.unshift(...Array.from({length:9},(_,i)=>({...first,id:'followup-'+i,body:'Saved outgoing follow-up '+i,created_at:`2026-10-21T14:${String(15-i).padStart(2,'0')}:00Z`})));
 const calls=[{id:rid,source:'outbound',party:'seller',completedAt:'2026-10-21T14:01:00Z',durationSeconds:42,recordingId:rid,transcriptAvailable:false,recordingReceipt:{id:rid,status:'available',durationSeconds:42,audioAvailable:true,audioExpiresAt:'2027-01-01T00:00:00Z'}}];
 calls.push({...calls[0],id:'44444444-4444-4444-8444-444444444444',source:'personal',completedAt:'2026-10-21T14:01:30Z',recordingId:undefined,recordingReceipt:{...calls[0].recordingReceipt,id:'44444444-4444-4444-8444-444444444444'}});
 data.conversations=[{id:rid,source:'outbound',screening_id:screenId,party:'seller',completed_at:'2026-10-21T14:01:00Z',durationSeconds:42,summary:'Seller said: I would consider a cash offer.',voicemail:false},{id:'99999999-9999-4999-8999-999999999999',source:'outbound',screening_id:screenId,party:'seller',completed_at:'2026-10-21T14:00:00Z',summary:'Automated voicemail greeting.',voicemail:true}];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;
  if(url.origin!==base)return route.abort();
  if(!p.startsWith('/api/'))return route.continue();
  if(p==='/api/work/messages/read'){const body=req.postDataJSON();assert.equal(body.threadId,tid);readRequests.push(body.messageIds);body.messageIds.forEach(id=>read.add(id));return route.fulfill({json:{saved:true}});}
  if(p==='/api/work/messages/availability'){
   await availabilityWait;
   if(availabilityFailure)return route.fulfill({status:503,json:{error:'Unavailable'}});
   return route.fulfill({json:{threadId:url.searchParams.get('threadId'),manualReply:true,sendReason:blocked?'This contact asked not to be texted.':null}});
  }
  if(p==='/api/work/messages'){
   if(req.method()==='POST'){const body=req.postDataJSON();sends.push(body);manual=true;messages.unshift({...first,id:'manual',author:'you',body:body.message,created_at:'2026-10-21T14:03:00Z'});return route.fulfill({json:{manual:true,status:'message_accepted',state:'delivered'}});}
   const selected=url.searchParams.get('threadId')||tid;
   if(url.searchParams.get('includeCalls')==='true')await callsWait;
   return route.fulfill({json:{availabilityRequired:true,threads:[{id:otherTid,recipient:otherPhone,party:'seller',paused:false},{id:tid,recipient:phone,party:'seller',paused:manual,reply:{preview:reply.body,received_at:reply.created_at,unread_count:read.has(replyId)?0:1},manualReply:false,sendReason:'Checking text availability…'}],threadId:selected,messages:selected===tid?messages:[{...first,id:'other-message',thread_id:otherTid,body:'No response from this contact yet.'}],calls:selected===tid&&url.searchParams.get('includeCalls')==='true'?calls:[],callsUnavailable:false,next:null,nextThread:null,firstMessage:selected===tid?first:null}});
  }
  if(req.method()!=='GET'){
   if(p==='/api/work/control'){manual=false;return route.fulfill({json:{saved:true}});}
   otherWrites.push(p);return route.fulfill({json:{recorded:true}});
  }
  if(p==='/api/account')return route.fulfill({json:{...fixtureAccount,balanceCents:zeroCredits?0:12500,mode:'live',paused:false,workReady:true,membershipActive:true,billingModel:'membership_credits',vip:false,vipFeatures:false}});
  if(p==='/api/work/activity'){
   const unread=messages.filter(m=>m.direction==='incoming'&&!read.has(m.id)).length;
   const omitted=url.searchParams.get('view')==='unread'&&!unread&&!url.searchParams.has('screeningId');
   return route.fulfill({json:{...data,conversations:omitted?[]:data.conversations,properties:omitted?[]:data.properties,sellerTexts:omitted?[]:[{screening_id:screenId,thread_id:tid,message_id:replyId,preview:'Yes, I would like to hear more.',received_at:'2026-10-21T14:02:00Z',unread_count:unread}],textReplyCounts:{properties:1,unreadProperties:unread?1:0,unreadMessages:unread},replyOrder:omitted?[]:[screenId],controls:manual?[{property_id:data.properties[0].result.property.propertyId}]:[]}});
  }
  if(p==='/api/work/text-contact')return contactFailure?route.fulfill({status:503,json:{error:'Unavailable'}}):route.fulfill({json:{dealId,threadId:tid,contacts:[{phone,name:'Alex Seller With A Very Long Name',phone_type:'wireless',blocked:false}]}});
  if(p==='/api/work/call-history')return route.fulfill({json:{recordings:[{...calls[0].recordingReceipt,source:'outbound',party:'seller',createdAt:'2026-10-21T14:01:00Z',conversationId:rid,voicemail:false}],next:null}});
  if(p==='/api/work/conversation')return route.fulfill({json:{transcript:[{role:'user',message:'I would consider a cash offer.'}],next:null}});
  if(p==='/api/work/manual-call')return route.fulfill({json:{contacts:[],personalCalls:[]}});
  if(p==='/api/work/browser-call')return route.fulfill({json:{ready:false}});
  if(p==='/api/work/property-photo')return route.fulfill({json:{photo:null}});
  if(p==='/api/billing/membership')return route.fulfill({json:{membership:{state:'active',accessible:true,vip:false,priceCents:5000,paidThrough:'2027-01-01T00:00:00Z',cancelAtPeriodEnd:false}}});
  if(p==='/api/funding/status')return route.fulfill({json:{enabled:true,mode:'live',paidCents:0,needsClaim:false,packs:[]}});
  if(p==='/api/notifications/updates')return route.fulfill({json:{items:[],preferences:{seenAt:null}}});
  if(p==='/api/work/progress')return route.fulfill({json:{progress:null}});
  if(p==='/api/work/next-action')return route.fulfill({json:{offer:null,balanceCents:12500,paused:false,checkedAt:new Date().toISOString()}});
  if(p==='/api/work/report')return route.fulfill({json:{days:7,leads:1,calls:1,texts:1,contracts:0}});
  return route.fulfill({json:{items:[],ready:false}});
 });
 try{
  await page.goto(base+'/');
  await page.getByRole('button',{name:'View unread texts',exact:true}).click();
  const card=page.locator('#property-'+screenId);await card.getByRole('button',{name:'Open seller reply, 1 unread text'}).click();
  const dialog=page.getByRole('dialog'),log=dialog.getByRole('log',{name:'Conversation history'});
  await log.getByText(first.body,{exact:true}).waitFor();await log.getByText('AI bot',{exact:true}).first().waitFor();
  await log.getByText(reply.body,{exact:true}).waitFor();
  const textbox=dialog.getByRole('textbox',{name:'Text message',exact:true});
  await textbox.fill('Can we talk about your property this afternoon?');
  assert(await dialog.getByRole('button',{name:'Send text',exact:true}).isDisabled(),'Replies load before contact and sending availability recover');
  availabilityFailure=true;releaseAvailability();
  await dialog.getByText('Text sending is temporarily unavailable. Your conversation and draft are saved.',{exact:true}).waitFor();
  assert.equal(await textbox.inputValue(),'Can we talk about your property this afternoon?');assert(await log.getByText(reply.body,{exact:true}).isVisible());
  availabilityFailure=false;contactFailure=false;
  assert.equal(await log.locator('audio').count(),0,'Delayed call loading does not block texts or drafts');
  assert(await dialog.getByRole('checkbox',{name:'Include calls',exact:true}).isChecked());
  await page.screenshot({path:`/tmp/icash-texts-default-${name.startsWith('mobile')?'mobile':'desktop'}.png`});
  releaseCalls();await log.locator('audio[aria-label="Call recording"]').first().waitFor();
  await log.locator('audio[src*="business-call"]').waitFor();
  const replyBox=await log.getByText(reply.body,{exact:true}).boundingBox(),historyBox=await log.boundingBox();assert(replyBox.y>=historyBox.y&&replyBox.y< historyBox.y+historyBox.height,'Seller reply opens in view despite later outgoing activity');
  assert((await dialog.getByRole('button',{name:'Call seller',exact:true}).boundingBox()).y<historyBox.y,'Call action is above the thread');assert.equal(await log.getByText('Call details and transcript',{exact:true}).count(),0);
  assert.equal(sends.length,0);assert(!otherWrites.includes('/api/work/text-contact'),'Opening existing history sends and creates nothing');
  await page.waitForFunction(()=>!document.querySelector('.seller-text-alert'));assert.deepEqual(readRequests.flat(),[replyId]);assert(await dialog.isVisible(),'Reading keeps the conversation open after leaving the unread list');
  await textbox.fill('Can we talk about your property this afternoon?');
  await dialog.getByRole('button',{name:/^Calls/}).click();
  await dialog.getByText('Seller said: I would consider a cash offer.',{exact:true}).waitFor();
  assert.equal(await dialog.getByText('Automated voicemail greeting.',{exact:true}).count(),0);
  await page.screenshot({path:`/tmp/icash-calls-${name.startsWith('mobile')?'mobile':'desktop'}.png`});
  const laterId='88888888-8888-4888-8888-888888888888';messages.unshift({...reply,id:laterId,body:'Can we discuss the price?',created_at:'2026-10-21T14:02:30Z'});
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.locator('.seller-text-alert').waitFor({state:'attached'});
  assert(!read.has(laterId),'A reply arriving while viewing calls stays unread');
  await dialog.getByRole('button',{name:'Texts',exact:true}).click();await log.getByText('Can we discuss the price?',{exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.seller-text-alert'));assert(read.has(laterId));
  assert.equal(await textbox.inputValue(),'Can we talk about your property this afternoon?','Draft survives switching to calls and back');
  const box=await textbox.boundingBox(),sendBox=await dialog.getByRole('button',{name:'Send text',exact:true}).boundingBox(),viewport=page.viewportSize();
  assert(box.height<=104,'Composer grows only as needed');
  const composerBox=await dialog.locator('.message-composer').boundingBox();assert(composerBox.height<150,'Compact reply composer leaves room for history');assert((await log.boundingBox()).height>140,'Conversation retains useful space');
  assert(box.y>=0&&box.y+box.height<=viewport.height&&sendBox.y+sendBox.height<=viewport.height,'Reply and send stay visible without page scrolling');
  await page.screenshot({path:`/tmp/icash-conversation-${name.startsWith('mobile')?'mobile':'desktop'}.png`});
  await dialog.getByRole('button',{name:'Send text',exact:true}).click();await log.getByText('You',{exact:true}).waitFor();
  assert.equal(sends.length,1);assert.equal(sends[0].threadId,tid);assert(sends[0].requestKey);assert.equal(await textbox.inputValue(),'');
  assert((await textbox.boundingBox()).height<=52,'Empty message input is slim');
  await dialog.getByRole('button',{name:'Return to bot',exact:true}).click();await dialog.getByText('Bot manages this lead',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Close conversation'}).click();
  // Switch out of the unread filter to revisit a read conversation.
  await page.getByRole('button',{name:/^Text replies/}).click();
  // A different selected contact and its draft must not override reply-first reopening.
  await card.getByRole('button',{name:/Text conversation for/}).click();
  await dialog.getByRole('button',{name:new RegExp(otherPhone.replace('+','\\+'))}).click();await log.getByText('No response from this contact yet.',{exact:true}).waitFor();await textbox.fill('Draft for the other contact');
  await dialog.getByRole('button',{name:'Close conversation'}).click();await card.getByRole('button',{name:/Text conversation for/}).click();await log.getByText(reply.body,{exact:true}).waitFor();assert.equal(await textbox.inputValue(),'');
  await dialog.getByRole('button',{name:new RegExp(otherPhone.replace('+','\\+'))}).click();await log.getByText('No response from this contact yet.',{exact:true}).waitFor();assert.equal(await textbox.inputValue(),'Draft for the other contact');await textbox.fill('');await dialog.getByRole('button',{name:'Close conversation'}).click();
  blocked=true;messages.splice(0,messages.length,{...first,id:'later',body:'A later message',created_at:'2026-10-21T14:04:00Z'});await card.getByRole('button',{name:/Text conversation for/}).click();
  // Retained views refresh on activation and preserve the backend's exact send hold.
  await dialog.getByText('This contact asked not to be texted.',{exact:true}).waitFor();await dialog.locator('.conversation-first-message summary').click();await dialog.locator('.conversation-first-message').getByText(first.body,{exact:true}).waitFor();await textbox.fill('An unsent draft');assert(await dialog.getByRole('button',{name:'Send text',exact:true}).isDisabled());
  assert.equal(sends.length,1);assert.deepEqual(errors,[]);
  await textbox.fill('');await dialog.getByRole('button',{name:'Close conversation'}).click();
  await page.goto(base+'/?screeningId='+screenId+'&contactView=texts&threadId='+otherTid);
  await page.getByRole('dialog').getByText('No response from this contact yet.',{exact:true}).waitFor();
  await page.getByRole('dialog').getByText('This contact asked not to be texted.',{exact:true}).waitFor();
  assert(!otherWrites.includes('/api/work/text-contact'));assert.equal(sends.length,1);
  zeroCredits=true;await page.goto(base+'/');await page.locator('#property-'+screenId).getByRole('button',{name:/Text conversation for/}).click();
  await page.getByRole('dialog').getByText('This contact asked not to be texted.',{exact:true}).waitFor();
  console.log(`${name}: reply preview, unread filter/read receipts, retained conversation, reply-first reopening, independent inline AI/manual recordings, slim composer, retained draft, one mocked send, opt-out and exact conversation deep link passed.`);
 }catch(error){console.error('Conversation fixture state',JSON.stringify({readRequests,otherWrites,errors,dom:await page.locator('.deal-texts').evaluateAll(nodes=>nodes.map(n=>({text:n.innerText,rect:n.getBoundingClientRect().toJSON(),bubbles:[...n.querySelectorAll('[data-message-id]')].map(b=>({id:b.dataset.messageId,rect:b.getBoundingClientRect().toJSON()}))})))}));await page.screenshot({path:'/tmp/icash-conversation-failed.png'});throw error;}finally{await context.close();}
}
