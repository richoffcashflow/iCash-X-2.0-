// Built application + intercepted API responses. No credentials or live providers.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {chromium,webkit,devices} from 'playwright';
import {verifyWorkspace} from './workspace-browser-scenarios.mjs';
import {verifyCourse,coursePdf} from './course-browser.mjs';
import {verifyWebinarExit,verifyRegularWebinarRoom} from './webinar-exit-browser.mjs';
import {sellerFunnelStages} from '../lib/conversion-funnel.ts';
import {dashboardCookie,issueDashboardProof} from '../lib/dashboard-password-policy.ts';
const port=3015,upstream=`http://127.0.0.1:${port}`,base=`https://127.0.0.1:${port+1}`;
// Keep the production HTTPS policy intact, including Safari's upgrade behavior.
const tlsDir=mkdtempSync(join(tmpdir(),'icash-browser-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(tlsDir,'key.pem'),'-out',join(tlsDir,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
const proxy=https.createServer({key:readFileSync(join(tlsDir,'key.pem')),cert:readFileSync(join(tlsDir,'cert.pem'))},(request,response)=>{
 // Serve the fixture through HTTP instead of WebKit's mocked-download transport.
 if(new URL(request.url,upstream).pathname==='/api/course/assets/pdf'){response.writeHead(200,{'Content-Type':'application/pdf','Content-Length':String(coursePdf.length),'Content-Disposition':'attachment; filename="iCash-X-Course-Guide.pdf"','Cache-Control':'no-store'});response.end(coursePdf);return;}
 const forwarded=http.request(new URL(request.url,upstream),{method:request.method,headers:request.headers},incoming=>{response.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(response);});
 forwarded.on('error',()=>{response.writeHead(502);response.end();});request.pipe(forwarded);
});
// Navigation proof for this isolated server only. It cannot authenticate with
// Supabase; all browser API responses are intercepted, and no live key is loaded.
const fixtureKey='local-browser-fixture-key-never-use-in-production';
const fixtureUser='00000000-0000-4000-8000-000000000001';
const access='fixture.'+Buffer.from(JSON.stringify({sub:fixtureUser,session_id:fixtureUser})).toString('base64url')+'.fixture';
const fixtureCookies=`icash_access=${access}; ${dashboardCookie}=${issueDashboardProof(access,fixtureUser,fixtureKey)}`;
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{PATH:process.env.PATH,NODE_ENV:'production',VERCEL_ENV:'preview',NEXT_TELEMETRY_DISABLED:'1',SUPABASE_SECRET_KEY:fixtureKey},stdio:['ignore','pipe','pipe']});
let serverLog='';server.stdout.on('data',d=>{serverLog+=d});server.stderr.on('data',d=>{serverLog+=d});
const now=new Date().toISOString(),part={status:'ok',checkedAt:now};
const reliability={status:'degraded',fresh:true,components:{worker:part,maintenance:part},snapshot:{checkedAt:now,issueCount:1,issues:[{kind:'contract_delivery',resourceId:'00000000-0000-4000-8000-000000000003',accountId:'00000000-0000-4000-8000-000000000002',since:now}],texts:{accepted:1,delivered:0,review:0},contracts:{created:1,completed:0,review:0}}};
const experienceFixture={experience:{days:7,lastObservedAt:now,counts:[{event:'panel_open',stage:'closing',count:12,accounts:3},{event:'panel_error',stage:'closing',count:2,accounts:1},{event:'panel_retry',stage:'closing',count:1,accounts:1}]},alerts:{configuration:'ready',checkedAt:now,active:{id:'00000000-0000-4000-8000-000000000004',openedAt:now,issueCount:1,reasons:['workflows']},notifications:{pending:0,accepted:1,needsReview:0},lastNotificationAt:now}};
function fixture(url){const p=new URL(url).searchParams;return {report:{days:Number(p.get('days')),includeOwner:p.get('includeOwner')==='true',query:p.get('q'),page:Number(p.get('page')),pageSize:25,timezone:'America/Chicago',startAt:now,endAt:now,leadCount:0,matchedCount:0,reviewCount:0,leads:[],funnel:sellerFunnelStages.map(s=>({key:s.key,count:0})),reliability,usage:{completedCount:0,missingChargeCount:0,chargedCents:0,coveredCents:0,knownCostMicros:0,costMicros:0,marginMicros:0,missingCostCount:0,estimatedCount:0,pendingCount:0}}};}
try{
 let ready=false;
 for(let i=0;i<60;i++){if(server.exitCode!==null)throw Error(serverLog);try{const r=await fetch(upstream+'/admin');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
 assert(ready,'Local production server failed to start');
 proxy.listen(port+1,'127.0.0.1');await once(proxy,'listening');
 for(const [name,engine,options] of [['desktop Chromium',chromium,{viewport:{width:1280,height:900}}],[process.env.BROWSER_ENGINES==='chromium'?'mobile Chromium':'mobile WebKit',process.env.BROWSER_ENGINES==='chromium'?chromium:webkit,{...devices['iPhone 13']}]]){
  if(process.env.BROWSER_ENGINES==='chromium'&&engine!==chromium)continue;
  const browser=await engine.launch({headless:true});
  try{
   if(process.env.BROWSER_SCENARIOS==='course'){await verifyCourse(browser,base,options,name);continue;}
   if(name==='desktop Chromium')await verifyWebinarExit(browser);
   await verifyRegularWebinarRoom(browser,base,options);
   const context=await browser.newContext({...options,ignoreHTTPSErrors:true});let failure=false,denied=false,experienceFailure=false,experienceDenied=false,external=0;const errors=[];
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==base){external++;return route.abort();}
    if(url.pathname==='/api/admin/overview')return route.fulfill({status:denied?403:failure?503:200,contentType:'application/json',body:JSON.stringify(denied?{error:'Owner required'}:failure?{error:'Fixture outage'}:fixture(url))});
    if(url.pathname==='/api/admin/experience')return route.fulfill({status:experienceDenied?403:experienceFailure?503:200,contentType:'application/json',body:JSON.stringify(experienceDenied?{error:'Owner required'}:experienceFailure?{error:'Fixture outage'}:experienceFixture)});
    if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"error":"Fixture only"}'});
    if(url.pathname==='/admin')return route.fulfill({response:await route.fetch({headers:{...route.request().headers(),cookie:fixtureCookies},maxRedirects:0})});
    return route.continue();
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   const failures=[];page.on('requestfailed',r=>failures.push({url:r.url(),error:r.failure()?.errorText}));
   await page.goto(base+'/admin');
   const panel=page.locator('section[aria-label="Workflow reliability"]');
   try{await panel.getByText('Workflow reliability · Needs attention').waitFor();}
   catch(error){console.error({engine:name,url:page.url(),errors,failures,body:await page.locator('body').innerText()});throw error;}
   await panel.getByText('Review stalled work').click();
   await panel.getByText('Contract text awaiting delivery',{exact:true}).waitFor();
   assert.match(await panel.innerText(),/1 texts accepted, 0 delivery confirmations/);
   assert.match(await panel.innerText(),/AM|PM/);
   const experience=page.locator('section[aria-label="Workspace experience"]');
   await experience.getByText('12 panel opens · 2 panel errors · 1 retries',{exact:true}).waitFor();
   await experience.getByText('Review experience and alerts',{exact:true}).click();
   assert.match(await experience.innerText(),/accepted by the email provider/);
   assert.match(await experience.innerText(),/Provider acceptance does not confirm delivery/);
   assert.match(await experience.innerText(),/AM|PM/);
   experienceFailure=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
   await experience.getByText('Refresh failed. Showing the last saved checks.',{exact:true}).waitFor();
   assert.match(await experience.innerText(),/12 panel opens/);
   experienceFailure=false;await experience.getByRole('button',{name:'Try again',exact:true}).click();
   await experience.getByText('Refresh failed. Showing the last saved checks.',{exact:true}).waitFor({state:'hidden'});
   experienceDenied=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
   await experience.getByText('Sign in with the owner account to view these checks.',{exact:true}).waitFor();
   assert(!/12 panel opens|Configured|accepted by the email provider/.test(await experience.innerText()));
   failure=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();
   await page.getByText('Refresh failed. Showing the last saved view.').waitFor();
   failure=false;await page.getByRole('button',{name:'Try again',exact:true}).click();
   await page.getByText('Refresh failed. Showing the last saved view.').waitFor({state:'hidden'});
   denied=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();
   await page.getByRole('heading',{name:'Owner access only'}).waitFor();assert.equal(await panel.count(),0);
   assert.deepEqual(errors,[]);assert.equal(external,0,'No external requests during the fixture');
   console.log(`PASS ${name}: owner reports and aggregate experience → incident detail → refresh failure → recovery → private data cleared on denied access.`);
   await context.close();
   await verifyWorkspace(browser,base,options,name);
   await verifyCourse(browser,base,options,name);
  }finally{await browser.close();}
 }
}finally{proxy.closeAllConnections();proxy.close();server.kill('SIGTERM');if(server.exitCode===null)await once(server,'exit');rmSync(tlsDir,{recursive:true,force:true});}
