import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {courseBucket,courseUploadInput,issueCourseTicket,readCourseTicket,type CourseAsset} from '@/lib/course-policy';
import {courseOwner,courseAssets,courseStorage,courseError,courseHeaders,CourseError} from '@/lib/course-server';
import {webinarOrigin,webinarBody,webinarLimit,WebinarError} from '@/lib/webinar-server';
import {db} from '@/lib/stripe-test';
export const maxDuration=60;
export async function POST(req:Request){try{
 try{webinarOrigin(req);}catch(e){if(e instanceof WebinarError)throw new CourseError(e.status,e.message);throw e;}
 const owner=await courseOwner();await webinarLimit(req,owner.id,'course-upload',20,600);
 const raw=await webinarBody(req,4096),{base,key,headers}=courseStorage();
 if(raw?.ticket){
  const {ticket}=z.object({ticket:z.string().max(3000)}).strict().parse(raw);const i=readCourseTicket(ticket,owner.id,key);
  const current=(await courseAssets()).find(a=>a.kind===i.kind);if(current?.path===i.path)return Response.json({published:true},{headers:courseHeaders});
  if(current?.revision!==i.revision)throw new CourseError(409,'The course changed in another tab. Reload before replacing this file.');
  const check=await fetch(`${base}/storage/v1/object/${courseBucket}/${i.path}`,{method:'HEAD',headers,cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!check.ok||Number(check.headers.get('content-length'))!==i.size||check.headers.get('content-type')?.split(';')[0]!==i.type)throw new CourseError(409,'The file has not finished uploading. Please retry the upload.');
  const saved=await db<CourseAsset[]>(`icash_course_assets?kind=eq.${i.kind}&revision=eq.${i.revision}`,'PATCH',{path:i.path,name:i.name,size:i.size,mime_type:i.type,revision:i.revision+1,updated_by:owner.id,updated_at:new Date().toISOString()});
  if(saved.length!==1)throw new CourseError(409,'The course changed in another tab. Reload before replacing this file.');
  return Response.json({published:true},{headers:courseHeaders});
 }
 const i=courseUploadInput.parse(raw);if((await courseAssets()).find(a=>a.kind===i.kind)?.revision!==i.revision)throw new CourseError(409,'Reload the course before uploading a replacement.');
 const ext={'video/mp4':'mp4','video/webm':'webm','application/pdf':'pdf'}[i.type],path=`${owner.id}/${randomUUID()}.${ext}`;
 const signed=await fetch(`${base}/storage/v1/object/upload/sign/${courseBucket}/${path}`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
 if(!signed.ok)throw new CourseError(503,'Could not prepare course storage. Please retry.');
 const data=await signed.json();const token=new URL(data.url,`${base}/storage/v1/`).searchParams.get('token');if(!token)throw Error('Missing upload signature');
 const endpoint=`${base.replace('.supabase.co','.storage.supabase.co')}/storage/v1/upload/resumable/sign`;
 const metadata=Object.entries({bucketName:courseBucket,objectName:path,contentType:i.type,cacheControl:'3600'}).map(([k,v])=>`${k} ${Buffer.from(v).toString('base64')}`).join(',');
 const started=await fetch(endpoint,{method:'POST',headers:{'Tus-Resumable':'1.0.0','x-signature':token,'Upload-Length':String(i.size),'Upload-Metadata':metadata},signal:AbortSignal.timeout(30000)});
 const location=started.headers.get('Location');if(!started.ok||!location)throw new CourseError(502,'Could not start the upload. Please retry.');
 const uploadUrl=new URL(location,endpoint);if(uploadUrl.origin!==new URL(endpoint).origin)throw Error('Invalid upload destination');
 return Response.json({token,endpoint,uploadUrl:uploadUrl.href,ticket:issueCourseTicket({...i,owner:owner.id,path,expires:Math.floor(Date.now()/1000)+7200},key)},{headers:courseHeaders});
 }catch(e){return courseError(e);}}
