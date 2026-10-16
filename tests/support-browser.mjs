import assert from 'node:assert/strict';

export async function verifySupport(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
 const page=await context.newPage(),errors=[],network=[];
 let live=false,signedIn=true,failWrite=false,requests=[],history={threads:[],messages:[],threadId:null,cancellations:[]};
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!==base){network.push(url.origin);return route.abort();}
  if(url.pathname.startsWith('/api/')){
   network.push(url.pathname);
   if(!live||url.pathname!=='/api/support')return route.fulfill({status:400,json:{error:'Unexpected preview request'}});
   if(!signedIn)return route.fulfill({status:401,json:{error:'Sign in to get help.'}});
   if(req.method()==='POST'){
    const body=req.postDataJSON();requests.push(body);
    if(body.message){
     if(!history.messages.length)history={...history,threads:[{id:'fixture-thread',subject:'Saved question',status:'open'}],threadId:'fixture-thread',messages:[{id:'q',role:'user',content:body.message},{id:'a',role:'assistant',content:'Your bot is paused. Review the pause in your workspace.'}]};
     if(failWrite){failWrite=false;return route.abort('failed');}
     return route.fulfill({json:{threadId:'fixture-thread'}});
    }
   }
   return route.fulfill({json:history});
  }
  return route.continue();
 });
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(base+'/preview/support');
  await page.getByRole('heading',{name:'Hey, I’m James.',exact:true}).waitFor();
  const chat=page.getByRole('region',{name:'Support conversation',exact:true});
  assert.match(await chat.innerText(),/AI Support/);
  const started=Date.now();await chat.getByRole('button',{name:'Send message',exact:true}).click();
  await chat.getByText('James is typing…',{exact:true}).waitFor();
  assert.equal(await chat.locator('.support-message-assistant').count(),0,'Fast replies wait briefly while typing is visible');
  await chat.locator('.support-message-assistant').waitFor();assert(Date.now()-started>=1600);
  assert.equal(await chat.locator('.support-message-user').count(),1);assert.equal(await chat.locator('.support-working').count(),0);
  assert.match(await chat.innerText(),/The pause flag alone does not tell us why/);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Preview fits the viewport');
  await page.screenshot({path:`/tmp/icash-james-${name.startsWith('mobile')?'mobile':'desktop'}.png`,fullPage:true});
  await chat.getByRole('button',{name:'Close support',exact:true}).click();
  await page.getByRole('button',{name:'Open chat',exact:true}).click();
  await chat.locator('.support-message-assistant').waitFor();assert.equal(await chat.locator('.support-message-user').count(),1,'Close/reopen preserves the conversation');
  await page.getByRole('button',{name:'Payment question',exact:true}).click();
  await chat.getByRole('button',{name:'Send message',exact:true}).click();
  await chat.getByText('James is typing…',{exact:true}).waitFor();
  await chat.getByRole('button',{name:'Close support',exact:true}).click();
  await page.getByRole('button',{name:'Open chat',exact:true}).click();
  await chat.locator('.support-message-assistant').waitFor();assert.match(await chat.innerText(),/Do not make another payment/);
  await chat.getByRole('button',{name:'Ask the team',exact:true}).click();
  await chat.getByText(/No real request has been sent/).waitFor();
  await page.getByRole('button',{name:'Interrupted connection',exact:true}).click();
  await chat.getByRole('button',{name:'Send message',exact:true}).click();
  await chat.getByRole('alert').waitFor();assert.equal(await chat.getByRole('textbox',{name:'Your message'}).inputValue(),'Why did my bot stop working?');
  await chat.getByRole('button',{name:'Send message',exact:true}).click();
  await chat.locator('.support-message-assistant').waitFor();assert.equal(await chat.locator('.support-message-user').count(),1,'Lost-response retry does not duplicate the question');
  assert.deepEqual(network,[],'Preview never calls live APIs or external services');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('button',{name:'Restart preview',exact:true}).click();
  assert.equal(await chat.locator('.support-message').count(),0);

  live=true;failWrite=true;await page.goto(base+'/support');
  await page.getByRole('heading',{name:'Hey, I’m James.',exact:true}).waitFor();
  const draft=chat.getByRole('textbox',{name:'Your message'});await draft.fill('Why is my bot paused?');
  await chat.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
  await chat.getByRole('alert').waitFor();assert.equal(requests.length,1,'Rapid submit is locked');
  assert.equal(await draft.inputValue(),'Why is my bot paused?');
  await chat.getByRole('button',{name:'Send message',exact:true}).click();
  await chat.locator('.support-message-assistant').waitFor();assert.equal(requests[0].requestId,requests[1].requestId,'The HTTP retry uses the original request receipt');
  assert.equal(await chat.locator('.support-message-user').count(),1);
  signedIn=false;await chat.getByLabel('Chat options',{exact:true}).click();await chat.getByRole('button',{name:'Refresh conversation',exact:true}).click();
  await page.getByRole('heading',{name:'Let’s get you some help',exact:true}).waitFor();assert.equal(await page.locator('.support-message').count(),0,'Sign-out removes account history');
  assert.deepEqual(errors,[]);
  console.log(`PASS ${name}: James pacing, mobile fit, close/reopen, team handoff, isolated preview, failed delivery/retry idempotency and signed-out privacy.`);
 }finally{await context.close();}
}
