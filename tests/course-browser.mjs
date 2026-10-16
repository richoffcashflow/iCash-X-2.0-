import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {readFileSync} from 'node:fs';
import {courseVideo} from './course-video-fixture.mjs';
const pdf=await PDFDocument.create();pdf.addPage().drawText('Fictional course test PDF');
export const coursePdf=Buffer.from(await pdf.save());
export const courseUploadReceipts=[];
const uploadOffsets=new Map();
export function serveCourseUpload(request,response){
 const id=request.url;
 if(request.headers['x-signature']!=='fixture-only'){response.writeHead(403);response.end();return;}
 if(request.method==='HEAD'){response.writeHead(200,{'Upload-Offset':String(uploadOffsets.get(id)??0)});response.end();return;}
 if(request.method!=='PATCH'){response.writeHead(405);response.end();return;}
 const offset=Number(request.headers['upload-offset']);assert.equal(offset,uploadOffsets.get(id)??0);
 const chunks=[];let size=0;
 request.on('data',chunk=>{size+=chunk.length;assert(size<=6*1024*1024,'Fixture upload is bounded');chunks.push(chunk);});
 request.on('end',()=>{const body=Buffer.concat(chunks);courseUploadReceipts.push({id,body,offset});uploadOffsets.set(id,offset+size);response.writeHead(204,{'Upload-Offset':String(offset+size),'Tus-Resumable':'1.0.0'});response.end();});
}
export async function verifyCourse(browser,base,options,name){
 const context=await browser.newContext({...options,ignoreHTTPSErrors:true});const page=await context.newPage(),errors=[],writes=[];
 let signedIn=true,owner=false,vip=false,ready=true;
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==base)throw Error('Unexpected external request: '+url.origin);
  if(url.pathname==='/api/course')return route.fulfill({status:signedIn?200:401,json:signedIn?{owner,canUpload:owner,vip,assets:{video:{ready,name:ready?'Course.webm':null,revision:ready?1:0},pdf:{ready,name:ready?'Course.pdf':null,revision:ready?1:0}}}:{error:'Sign in to watch your course.'}});
  if(url.pathname==='/api/course/assets/video'){
   const range=req.headers().range;
   if(range){const match=/bytes=(\d+)-(\d*)/.exec(range),start=Number(match?.[1]??0),end=Math.min(Number(match?.[2]||courseVideo.length-1),courseVideo.length-1);return route.fulfill({status:206,headers:{'Content-Type':'video/webm','Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${courseVideo.length}`},body:courseVideo.subarray(start,end+1)});}
   return route.fulfill({contentType:'video/webm',body:courseVideo});
  }
  // WebKit cannot reliably emit download events for route.fulfill PDF responses.
  // The isolated local HTTPS server serves real bytes; membership is tested at the API boundary.
  if(url.pathname==='/api/course/assets/pdf')return route.continue();
  if(url.pathname==='/api/course/upload'){const body=req.postDataJSON();writes.push(body);if(body.ticket){ready=true;return route.fulfill({json:{published:true}});}return route.fulfill({json:{uploadUrl:base+'/api/fixture-course-upload?id='+encodeURIComponent(name+'-'+body.kind),endpoint:base+'/api/fixture-course-upload',token:'fixture-only',ticket:'fixture-ticket'}});}
  // WebKit omits Blob request bodies from its interception API. Verify the wire bytes instead.
  if(url.pathname==='/api/fixture-course-upload')return route.continue();
  if(url.pathname.startsWith('/api/'))throw Error('Practice/course attempted unexpected API: '+url.pathname);
  return route.continue();
 });
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(base+'/course');await page.getByRole('link',{name:'Download PDF',exact:true}).waitFor();
  const video=page.getByLabel('How to use iCash X course video');await page.waitForFunction(()=>document.querySelector('video')?.readyState>=1);assert(await video.evaluate(node=>Number.isFinite(node.duration)&&node.duration>0));
  await video.evaluate(node=>{node.muted=true;return node.play();});await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0);
  assert.equal(await page.getByText('Manage course files',{exact:true}).count(),0);
  const pdfLink=page.getByRole('link',{name:'Download PDF',exact:true}),practice=page.getByRole('link',{name:'Open practice workspace',exact:true});
  assert((await pdfLink.boundingBox()).y<(await practice.boundingBox()).y,'Practice link is directly below the PDF');
  const downloading=page.waitForEvent('download');await pdfLink.click();const downloaded=await downloading;assert.equal(downloaded.suggestedFilename(),'iCash-X-Course-Guide.pdf');assert.deepEqual(readFileSync(await downloaded.path()),coursePdf);
  assert.equal(await page.getByRole('link',{name:'Upgrade to VIP',exact:true}).getAttribute('href'),'/?upgrade=vip');
  assert.match(await page.locator('main').innerText(),/\$50\s+more today.*\$100\/month total/s);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Course fits mobile and desktop');
  await page.screenshot({path:`/tmp/icash-course-${name.startsWith('mobile')?'mobile':'desktop'}.png`,fullPage:true});
  await practice.click();await page.getByRole('heading',{name:'One property. One clear next step.'}).waitFor();assert.equal(await page.getByLabel('Explore a step').inputValue(),'lead');
  await page.getByRole('link',{name:'Back to course',exact:true}).click();await page.getByRole('link',{name:'Download PDF',exact:true}).waitFor();assert.equal(writes.length,0);
  vip=true;await page.reload();await page.getByText('Included in your plan',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Upgrade to VIP',exact:true}).count(),0);
  vip=false;owner=true;ready=false;await page.reload();await page.getByText('Manage course files',{exact:true}).click();
  await page.getByLabel('Choose video',{exact:true}).setInputFiles({name:'Course.webm',mimeType:'video/webm',buffer:courseVideo});
  await page.getByRole('button',{name:'Upload & publish',exact:true}).first().click();await page.getByText('Published. Customers can now open this file.',{exact:true}).waitFor();assert.equal(writes[0].kind,'video');assert(courseUploadReceipts.some(r=>r.id.includes(encodeURIComponent(name+'-video'))&&r.body.equals(courseVideo)));assert(writes.some(w=>w.ticket==='fixture-ticket'));
  await page.getByLabel('Choose PDF',{exact:true}).setInputFiles({name:'Course.pdf',mimeType:'application/pdf',buffer:coursePdf});await page.getByRole('button',{name:'Upload & publish',exact:true}).nth(1).click();await page.waitForFunction(()=>[...document.querySelectorAll('[role="status"]')].filter(n=>n.textContent.includes('Published.')).length===2);
  assert(courseUploadReceipts.some(r=>r.id.includes(encodeURIComponent(name+'-pdf'))&&r.body.equals(coursePdf)));
  signedIn=false;await page.reload();await page.getByRole('heading',{name:'Welcome to your course'}).waitFor();assert.equal(await page.locator('video').count(),0);assert.equal(await page.getByText('Manage course files',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);console.log(`PASS ${name}: course playback, PDF download, ordered practice link, VIP entitlement, owner video/PDF uploads and signed-out privacy.`);
 }finally{await context.close();}
}
