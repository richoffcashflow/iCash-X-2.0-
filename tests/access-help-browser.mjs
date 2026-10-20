import assert from 'node:assert/strict';
/** Built pages with isolated API responses. Never sends a real support message. */
export async function verifyAccessHelp(browser,base,options,name,fixtureCookies){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
 let conversation=null,sends=0,denied=false,external=0,returnCalls=0,returnFailure=true,restored=false,requiresReturn=false,memberScenario=false;
 const returnToken='a'.repeat(64);const errors=[];
 const id='00000000-0000-4000-8000-000000000301',now=new Date().toISOString();
 try{
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==base){external++;return route.abort();}
   const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(url.pathname==='/api/account/access')return json({signedIn:false,signInReady:true});
   if(url.pathname==='/api/support/access/return'){
    returnCalls++;assert.equal(new URL(route.request().frame().url()).hash,'','Secret is removed before the first API request');
    const {token}=route.request().postDataJSON();
    if(token!==returnToken)return json({error:'This support link has expired. Open a newer support email, or contact us again below.'},410);
    if(returnFailure){returnFailure=false;return json({error:'Your conversation could not open. Please try again.'},503);}
    restored=true;return json({restored:true});
   }
   if(url.pathname==='/api/support'&&memberScenario){
    assert.equal(url.searchParams.get('threadId'),id,'Account email opens the specified conversation at '+route.request().frame().url());
    return json({threads:[{id,subject:'Earlier conversation',status:'waiting_on_customer'}],threadId:id,messages:[{id,role:'operator',content:'Your earlier account support reply.',created_at:now}],cancellations:[]});
   }
   if(url.pathname==='/api/support/access'){
    if(route.request().method()==='GET')return json({ready:true,conversation:requiresReturn&&!restored?null:conversation});
    sends++;const body=route.request().postDataJSON();assert.equal(body.email,'buyer@example.invalid');
    conversation={id,email:body.email,phone:'+12125551234',status:'open',messages:[{id,requestId:body.requestId,role:'user',content:body.message,createdAt:now}]};
    return json({error:'We could not confirm your message was saved. Refresh before retrying; your draft is still here.'},503);
   }
   if(url.pathname==='/api/support/admin/access'){
    if(denied)return json({error:'Sign in with a support operator account to open this inbox.'},403);
    const request={id,email:conversation.email,phone:conversation.phone,status:conversation.status,created_at:now,updated_at:now};
    if(route.request().method()==='POST'){
     const body=route.request().postDataJSON();assert.equal(body.id,id);conversation.status=body.status;
     if(body.reply)conversation.messages.push({id:'00000000-0000-4000-8000-000000000302',requestId:body.requestId,role:'operator',content:body.reply,createdAt:now});return json({saved:true});
    }
    if(url.searchParams.has('id'))return json({request,messages:conversation.messages.map(message=>({...message,created_at:message.createdAt}))});
    return json({requests:[request],purchases:[{id:'00000000-0000-4000-8000-000000000303',email:'paid@example.invalid',paid_at:now,email_status:'sent',email_delivery:'bounced',text_status:'needs_review',text_delivery:null,reason:'delivery_problem'}]});
   }
   if(url.pathname==='/api/support/admin')return json({threads:[],cancellations:[],deployment:{detail:'Fixture deployment ready.'}});
   if(url.pathname.startsWith('/api/'))return json({error:'Fixture only'},401);
   if(url.pathname==='/support/admin')return route.fulfill({response:await route.fetch({headers:{...route.request().headers(),cookie:fixtureCookies},maxRedirects:0})});
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/access');await page.getByRole('link',{name:'Still need help getting in?',exact:true}).click();
  await page.getByRole('heading',{name:'Already paid and need help getting in?',exact:true}).waitFor();
  await page.getByLabel('Payment email',{exact:true}).fill('buyer@example.invalid');await page.getByLabel('Mobile number (optional)',{exact:true}).fill('2125551234');
  const question='I paid, but neither sign-in code arrived.';await page.getByLabel('What happened?',{exact:true}).fill(question);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No mobile support overflow');
  if(process.env.ACCESS_HELP_SCREENSHOT)await page.screenshot({path:process.env.ACCESS_HELP_SCREENSHOT,fullPage:true});
  await page.getByRole('button',{name:'Send to support',exact:true}).click();await page.getByRole('button',{name:'Refresh support',exact:true}).waitFor();
  assert.equal(await page.locator('textarea').inputValue(),question,'Failed response preserves draft');
  await page.getByRole('button',{name:'Refresh support',exact:true}).click();await page.getByText('Your earlier message was saved. Support continues here.',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Reply to support',{exact:true}).inputValue(),'','Saved receipt clears only the confirmed draft');assert.equal(sends,1);
  await page.goto(base+'/support/admin');const desk=page.getByRole('region',{name:'Support inbox',exact:true});
  await desk.getByRole('button',{name:/buyer@example.invalid/}).waitFor();
  assert.equal(await desk.getByText('Fixture deployment ready.',{exact:true}).isVisible(),false,'Diagnostics stay out of the inbox');
  assert.equal(await desk.getByText('Operations needing review',{exact:true}).isVisible(),false,'Review tools are collapsed');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No mobile inbox overflow');
  if(process.env.SUPPORT_DESK_SCREENSHOT)await page.screenshot({path:process.env.SUPPORT_DESK_SCREENSHOT.replace('.png',name.startsWith('mobile')?'-mobile.png':'-desktop.png'),fullPage:true});
  await desk.getByRole('button',{name:/buyer@example.invalid/}).click();
  await desk.getByLabel('Reply to customer',{exact:true}).fill('Draft kept while navigating');
  if(name.startsWith('mobile')){await desk.getByRole('button',{name:'← Inbox',exact:true}).click();await desk.getByRole('button',{name:/buyer@example.invalid/}).click();assert.equal(await desk.getByLabel('Reply to customer',{exact:true}).inputValue(),'Draft kept while navigating');}
  await desk.getByLabel('Reply to customer',{exact:true}).fill('Choose Use my checkout phone on the account page. Your payment is saved.');
  await desk.getByRole('button',{name:'Send reply ↗',exact:true}).click();
  await desk.getByText('Reply saved. A customer email notification is queued.',{exact:true}).waitFor();
  assert.equal(await desk.getByLabel('Reply to customer',{exact:true}).inputValue(),'','Confirmed reply clears the draft');
  if(process.env.SUPPORT_DESK_SCREENSHOT)await page.screenshot({path:process.env.SUPPORT_DESK_SCREENSHOT.replace('.png',name.startsWith('mobile')?'-conversation-mobile.png':'-conversation-desktop.png'),fullPage:true});
  await desk.getByRole('button',{name:'Close chat',exact:true}).click();
  await desk.getByText('Conversation closed.',{exact:true}).waitFor();
  assert.equal(conversation.status,'closed');
  await desk.getByRole('button',{name:'Reopen',exact:true}).click();
  await desk.getByText('Conversation reopened.',{exact:true}).waitFor();
  assert.equal(conversation.status,'open');
  denied=true;await desk.getByRole('button',{name:'Refresh',exact:true}).click();await desk.getByText('Sign in with a support operator account to open this inbox.',{exact:true}).waitFor();assert(!(await desk.innerText()).includes('buyer@example.invalid'),'Denied operator read clears previous private ticket');
  await page.goto(base+'/access/help');await page.getByText('Request saved',{exact:true}).waitFor();
  await page.getByRole('log',{name:'Access support messages'}).getByText('Choose Use my checkout phone on the account page. Your payment is saved.',{exact:true}).waitFor();
  // Open the actual standalone return page as a fresh browser, with no account.
  await context.clearCookies();requiresReturn=true;
  await page.goto(base+'/access/help/return#'+returnToken);
  await page.getByRole('button',{name:'Try again',exact:true}).waitFor();
  assert.equal(new URL(page.url()).hash,'');assert.equal(returnCalls,1);
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await page.getByRole('log',{name:'Access support messages'}).getByText('Choose Use my checkout phone on the account page. Your payment is saved.',{exact:true}).waitFor();
  assert.equal(new URL(page.url()).pathname,'/access/help');assert.equal(returnCalls,2);
  await page.reload();await page.getByRole('log',{name:'Access support messages'}).waitFor();
  await page.goto(base+'/access/help/return#'+'b'.repeat(64));
  await page.getByText('This support link has expired. Open a newer support email, or contact us again below.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Try again',exact:true}).isVisible(),false);
  await page.getByRole('link',{name:'Open support',exact:true}).click();await page.getByRole('log',{name:'Access support messages'}).waitFor();
  memberScenario=true;await page.goto(base+'/support?threadId='+id);await page.getByText('Your earlier account support reply.',{exact:true}).waitFor();
  assert.equal(sends,1);assert.equal(external,0);assert.deepEqual(errors,[]);
  console.log(`PASS ${name}: locked-out support link, anonymous request, lost-response recovery without duplicate ticket, owner reply, private data cleared on denial, and email return across devices, transient/expired-link recovery, and exact account conversation links. No real messages.`);
 }finally{await context.close();}
}
