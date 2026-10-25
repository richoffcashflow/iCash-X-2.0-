import assert from 'node:assert/strict';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',id='22222222-2222-4222-8222-222222222222';
const base='https://fixture.supabase.co',prefix=`${base}/storage/v1/object/public/icash-webinars/${owner}/`;
const day=prefix+'a6749bda-829a-42d0-859b-0e1f0fd2cd39.mp4',night=prefix+'9116fb37-5319-4e53-8b4d-bf304de8cd88.mp4';
class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
process.env.SUPABASE_URL=base;process.env.SUPABASE_SECRET_KEY='fixture-secret';
let row,conflict=false,badCopy=false,copyFailure=false;const calls=[],requests=[],objects=new Map();
function reset(){row={config:{id,revision:7,videoUrl:day,nightVersion:{videoUrl:night,chat:['night cue']},chat:['day cue'],offers:['saved offer']},public_code:100000};conflict=false;badCopy=false;copyFailure=false;calls.length=0;requests.length=0;objects.clear();for(const url of [day,night])objects.set(url,{length:'12000',cache:'max-age=3600',type:'video/mp4'});}
const svc=await loadService('lib/webinar-delivery.ts',{WebinarError,webinarFromRow:r=>r.config,db:async(path,method,body)=>{
 calls.push({path,method,body});assert(path.startsWith(`icash_webinars?id=eq.${id}&revision=eq.7`));assert(!path.includes('sessions'));
 if(method==='PATCH'){if(conflict)return [];row={...row,config:body.config};return [row];}return [structuredClone(row)];
}});
globalThis.fetch=async(input,init)=>{
 const url=String(input);requests.push({url,init});assert.equal(init.redirect,'error');
 if(init.method==='HEAD'){assert(url.startsWith(prefix));const o=objects.get(url);return new Response(null,{status:o?200:404,headers:o?{'content-length':o.length,'content-type':o.type,'cache-control':o.cache}:{}});}
 assert.equal(url,base+'/storage/v1/object/copy');assert.equal(init.headers.Authorization,'Bearer fixture-secret');
 const b=JSON.parse(init.body);assert.equal(b.bucketId,'icash-webinars');assert.equal(b.copyMetadata,false);assert.equal(b.metadata.cacheControl,'max-age=2592000');assert(!('x-upsert' in init.headers));
 if(copyFailure)return new Response(null,{status:503});
 objects.set(`${base}/storage/v1/object/public/icash-webinars/${b.destinationKey}`,{length:badCopy?'1':'12000',type:'video/mp4',cache:b.metadata.cacheControl});return Response.json({});
};
reset();const snapshot=structuredClone(row.config);let result=await svc.optimizeWebinarDelivery(id,7,owner);
assert.equal(result.optimized,2);assert.equal(result.webinar.revision,8);assert.match(result.webinar.videoUrl,/-cache30d\.mp4$/);assert.match(result.webinar.nightVersion.videoUrl,/-cache30d\.mp4$/);assert.deepEqual(result.webinar.chat,snapshot.chat);assert.deepEqual(result.webinar.offers,snapshot.offers);assert.deepEqual(result.webinar.nightVersion.chat,snapshot.nightVersion.chat);assert.equal(objects.get(day).cache,'max-age=3600','Original active-session file is preserved');assert.equal(requests.filter(x=>x.init.method==='POST').length,2);
requests.length=0;calls.length=0;result=await svc.optimizeWebinarDelivery(id,7,owner);assert.equal(result.optimized,0);assert.equal(requests.filter(x=>x.init.method==='POST').length,0);assert(!calls.some(x=>x.method==='PATCH'));
reset();conflict=true;await assert.rejects(svc.optimizeWebinarDelivery(id,7,owner),e=>e.status===409);assert.equal(row.config.revision,7);
conflict=false;requests.length=0;await svc.optimizeWebinarDelivery(id,7,owner);assert(!requests.some(x=>x.init.method==='POST'),'Retry after a concurrent save reuses verified copies');
for(const bad of ['https://untrusted.invalid/video.mp4',`${base}/storage/v1/object/public/icash-course/${owner}/video.mp4`,day.replace(owner,id),day+'?download=1']){reset();row.config.videoUrl=bad;row.config.nightVersion=null;result=await svc.optimizeWebinarDelivery(id,7,owner);assert.equal(result.optimized,0);assert.equal(requests.length,0);assert(!calls.some(x=>x.method==='PATCH'));}
reset();badCopy=true;await assert.rejects(svc.optimizeWebinarDelivery(id,7,owner),e=>e.status===502);assert(!calls.some(x=>x.method==='PATCH'));
reset();copyFailure=true;await assert.rejects(svc.optimizeWebinarDelivery(id,7,owner),e=>e.status===502);assert(!calls.some(x=>x.method==='PATCH'));
let authorized=false,origin=true,called=0;
const {POST}=await loadService('app/api/webinar/studio/optimize-delivery/route.ts',{z,webinarOrigin:()=>{if(!origin)throw new WebinarError(403,'origin');},webinarOwner:async()=>{if(!authorized)throw new WebinarError(403,'owner');return {id:owner};},webinarLimit:async()=>{},webinarBody:r=>r.json(),webinarHeaders:{'Cache-Control':'private, no-store'},webinarError:e=>Response.json({error:e.message},{status:e.status??400}),optimizeWebinarDelivery:async(i,r,o)=>{assert.deepEqual([i,r,o],[id,7,owner]);called++;return {optimized:2};}});
const request=(extra={})=>new Request('https://example.invalid/api/webinar/studio/optimize-delivery',{method:'POST',body:JSON.stringify({webinarId:id,revision:7,...extra})});
assert.equal((await POST(request())).status,403);assert.equal(called,0);authorized=true;origin=false;assert.equal((await POST(request())).status,403);assert.equal(called,0);origin=true;assert.equal((await POST(request({ownerId:'another'}))).status,400);assert.equal(called,0);const response=await POST(request());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(called,1);
console.log('Video delivery: verified immutable copies, repeat-safe reuse, optimistic save, owner/origin checks and unchanged viewer snapshots. No external providers.');
