import assert from 'node:assert/strict';
import {supportCoachingReferral} from '../lib/support-coaching.ts';
/** Built customer UI with isolated fixture responses; no message, payment or provider calls. */
export async function verifySupportCoaching(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});
 const id='00000000-0000-4000-8000-000000000401',now=new Date().toISOString();
 let active=false,posts=0;
 const errors=[];
 try{
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin!==base)return route.abort();
   const json=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
   if(url.pathname==='/api/support'){
    if(route.request().method()!=='GET'){posts++;return route.abort();}
    return json({threads:[{id,subject:'Deal question',status:'open'}],threadId:id,cancellations:[],messages:[{id:id+'1',role:'user',content:'Analyze this deal',created_at:now},{id:id+'2',role:'assistant',created_at:now,content:supportCoachingReferral([{key:'vip',source:'icash_vip_features_active',status:'ok',code:active?'vip_active':'vip_inactive'}],'Analyze this deal',true)}]});
   }
   if(url.pathname.startsWith('/api/'))return json({signedIn:false});
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/support?threadId='+id);
  const upgrade=page.getByRole('link',{name:'Review VIP upgrade',exact:true});await upgrade.waitFor();
  assert.equal(await upgrade.getAttribute('href'),'https://www.geticashx.com/?upgrade=vip');
  await upgrade.focus();assert(await upgrade.evaluate(e=>e===document.activeElement),'Keyboard accessible');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
  active=true;await page.reload();await page.getByRole('link',{name:'Open workspace',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Review VIP upgrade',exact:true}).count(),0,'Existing VIP never sees an upgrade CTA');
  await page.reload();await page.getByRole('link',{name:'Open workspace',exact:true}).waitFor();
  assert.equal(posts,0,'Navigation and reload never post support or checkout actions');assert.deepEqual(errors,[]);
  console.log('PASS '+name+': support coaching links, VIP no-upgrade, keyboard, reload and no mutations.');
 }finally{await context.close();}
}
