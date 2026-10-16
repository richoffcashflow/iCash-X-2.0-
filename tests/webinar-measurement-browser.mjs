import assert from 'node:assert/strict';
export async function verifyWebinarMeasurement(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
 let consent=false,scriptLoads=0,reads=0;
 const errors=[],pixelId='1104248230721457';
 try{
  await context.addInitScript(()=>{sessionStorage.setItem('icash-webinar-session','fixture-webinar');window.__pixelCalls=[];});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href==='https://connect.facebook.net/en_US/fbevents.js'){
    scriptLoads++;return route.fulfill({contentType:'application/javascript',body:'window.__pixelCalls.push(...window.fbq.queue);window.fbq.callMethod=(...args)=>window.__pixelCalls.push(args);'});
   }
   if(url.origin!==base)return route.abort();
   if(url.pathname==='/api/webinar/measurement'){
    reads++;if(route.request().method()==='POST'){consent=route.request().postDataJSON().allow;return route.fulfill({json:{consent}});}
    return route.fulfill({json:{enabled:true,pixelId,consent,events:consent?[{eventName:'Purchase',eventId:'webinar:purchase:pi_fixture',data:{value:50,currency:'USD'}}]:[]}});
   }
   if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,json:{error:'Local fixture only'}});
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const calls=()=>page.evaluate(()=>window.__pixelCalls);
  const tracks=async event=>(await calls()).filter(c=>c[0]==='trackSingle'&&c[2]===event);
  await page.goto(base+'/live/123456');
  await page.getByRole('button',{name:'Allow measurement',exact:true}).waitFor();
  assert.equal(scriptLoads,0,'No Meta script before consent');
  await page.getByRole('button',{name:'Allow measurement',exact:true}).click();
  await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[2]==='PageView'));
  assert.equal(scriptLoads,1);assert.equal((await calls()).filter(c=>c[0]==='init'&&c[1]===pixelId).length,1);
  assert.equal((await tracks('PageView')).length,1);assert.equal((await tracks('ViewContent')).length,1);assert.equal((await tracks('Purchase')).length,1);
  const firstView=(await tracks('PageView'))[0][4].eventID;
  for(let n=0;n<3;n++)await page.evaluate(()=>window.dispatchEvent(new CustomEvent('icash-webinar-ready',{detail:{sessionId:'fixture-webinar'}})));
  await page.waitForFunction(()=>window.fbq!==undefined);await page.getByRole('button',{name:'Ad privacy',exact:true}).click();
  assert.equal((await tracks('PageView')).length,1,'Repeated session refresh does not duplicate a page view');
  assert.equal((await tracks('Purchase')).length,1,'Purchase IDs remain deduplicated');
  await page.getByRole('button',{name:'No thanks',exact:true}).click();
  await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[0]==='consent'&&c[1]==='revoke'));
  await page.reload();await page.getByRole('button',{name:'Ad privacy',exact:true}).waitFor();
  assert.deepEqual(await calls(),[],'Declined measurement stays off on reload');assert.equal(scriptLoads,1);
  await page.getByRole('button',{name:'Ad privacy',exact:true}).click();await page.getByRole('button',{name:'Allow measurement',exact:true}).click();
  await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[2]==='PageView'));
  assert.notEqual((await tracks('PageView'))[0][4].eventID,firstView,'A real reload has a new PageView');assert.equal((await tracks('Purchase')).length,0,'Reload cannot resend a settled purchase');
  await page.goto(base+'/live/123457');await page.waitForFunction(()=>window.__pixelCalls.some(c=>c[2]==='PageView'));
  assert.equal((await tracks('PageView')).length,1,'VIP uses the shared pixel integration');
  const before=reads;
  for(const path of ['/webinar?preview=00000000-0000-4000-8000-000000000123','/webinar/privacy','/preview/workspace']){
   await page.goto(base+path);await page.waitForLoadState('networkidle');assert.deepEqual(await calls(),[]);
  }
  assert.equal(reads,before,'Previews and non-webinar pages never request tracking configuration');assert.deepEqual(errors,[]);
  console.log(`PASS ${name}: supplied Meta pixel, one script/init, PageView, deduplicated purchases, consent/revocation, regular/VIP and preview exclusions. All Meta traffic intercepted.`);
 }finally{await context.close();}
}
