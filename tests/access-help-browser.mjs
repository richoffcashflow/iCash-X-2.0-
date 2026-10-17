import assert from 'node:assert/strict';
/** Built pages with isolated API responses. Never sends a real support message. */
export async function verifyAccessHelp(browser,base,options,name,fixtureCookies){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
 let conversation=null,sends=0,denied=false,external=0;const errors=[];
 const id='00000000-0000-4000-8000-000000000301',now=new Date().toISOString();
 try{
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==base){external++;return route.abort();}
   const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(url.pathname==='/api/account/access')return json({signedIn:false,signInReady:true});
   if(url.pathname==='/api/support/access'){
    if(route.request().method()==='GET')return json({ready:true,conversation});
    sends++;const body=route.request().postDataJSON();assert.equal(body.email,'buyer@example.invalid');
    conversation={id,email:body.email,phone:'+12125551234',status:'open',messages:[{id,requestId:body.requestId,role:'user',content:body.message,createdAt:now}]};
    return json({error:'We could not confirm your message was saved. Refresh before retrying; your draft is still here.'},503);
   }
   if(url.pathname==='/api/support/admin/access'){
    if(denied)return json({error:'A support operator account is required.'},403);
    const request={id,email:conversation.email,phone:conversation.phone,status:conversation.status,created_at:now,updated_at:now};
    if(route.request().method()==='POST'){
     const body=route.request().postDataJSON();assert.equal(body.id,id);conversation.status=body.status;
     conversation.messages.push({id:'00000000-0000-4000-8000-000000000302',requestId:body.requestId,role:'operator',content:body.reply,createdAt:now});return json({saved:true});
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
  await page.getByRole('button',{name:'Refresh support',exact:true}).click();await page.getByText('Your earlier message was saved. The team can see it.',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Reply to the team',{exact:true}).inputValue(),'','Saved receipt clears only the confirmed draft');assert.equal(sends,1);
  await page.goto(base+'/support/admin');const desk=page.getByRole('region',{name:'Paid access support',exact:true});
  await desk.getByRole('button',{name:/buyer@example.invalid/}).click();
  await desk.getByLabel('Reply about access',{exact:true}).fill('Choose Use my checkout phone on the account page. Your payment is saved.');
  await desk.getByLabel('Access request status',{exact:true}).selectOption('waiting_on_customer');await desk.getByRole('button',{name:'Save access reply',exact:true}).click();
  await desk.getByText('Saved. The buyer can read your reply on their access-help page without signing in.',{exact:true}).waitFor();
  denied=true;await desk.getByRole('button',{name:'Refresh access queue',exact:true}).click();await desk.getByText('A support operator account is required.',{exact:true}).waitFor();assert(!(await desk.innerText()).includes('buyer@example.invalid'),'Denied operator read clears previous private ticket');
  await page.goto(base+'/access/help');await page.getByText('The team replied',{exact:true}).waitFor();
  await page.getByRole('log',{name:'Access support messages'}).getByText('Choose Use my checkout phone on the account page. Your payment is saved.',{exact:true}).waitFor();
  assert.equal(sends,1);assert.equal(external,0);assert.deepEqual(errors,[]);
  console.log(`PASS ${name}: locked-out support link, anonymous request, lost-response recovery without duplicate ticket, owner reply, private data cleared on denial, and reply readable without login. No real messages.`);
 }finally{await context.close();}
}
