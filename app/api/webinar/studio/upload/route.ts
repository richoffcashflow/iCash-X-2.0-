import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarOwner,WebinarError} from '@/lib/webinar-server';
export async function POST(req:Request){try{
 webinarOrigin(req);const user=await webinarOwner();await webinarLimit(req,user.id,'upload',15,600);
 const i=z.object({type:z.enum(['video/mp4','video/webm','video/quicktime','image/jpeg','image/png','image/webp']),size:z.number().int().positive().max(2147483648)}).strict().parse(await webinarBody(req,512));
 if(i.type.startsWith('image/')&&i.size>8*1024*1024)throw new WebinarError(400,'Choose an image up to 8 MB.');
 const extensions={'video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov','image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
 const path=`${user.id}/${randomUUID()}.${extensions[i.type]}`;const base=process.env.SUPABASE_URL!;
 const response=await fetch(`${base}/storage/v1/object/upload/sign/icash-webinars/${path}`,{method:'POST',headers:{apikey:process.env.SUPABASE_SECRET_KEY!,Authorization:`Bearer ${process.env.SUPABASE_SECRET_KEY}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new WebinarError(503,'Could not prepare the upload. Confirm webinar storage is installed.');
 const data=await response.json();const signed=new URL(data.url,`${base}/storage/v1/`);const token=signed.searchParams.get('token');if(!token)throw Error('Upload signature missing');
 const endpoint=`${base.replace('.supabase.co','.storage.supabase.co')}/storage/v1/upload/resumable/sign`;
 // Each upload has a new UUID path, so browsers can reuse public media for a
 // month without serving an older recording after the owner publishes a change.
 const metadata=Object.entries({bucketName:'icash-webinars',objectName:path,contentType:i.type,cacheControl:'2592000'}).map(([key,value])=>`${key} ${Buffer.from(value).toString('base64')}`).join(',');
 const started=await fetch(endpoint,{method:'POST',headers:{'Tus-Resumable':'1.0.0','x-signature':token,'Upload-Length':String(i.size),'Upload-Metadata':metadata},signal:AbortSignal.timeout(30000)});
 if(!started.ok){console.error('webinar_upload_start',{status:started.status,requestId:started.headers.get('sb-request-id')});throw new WebinarError(502,`Storage could not start the upload (HTTP ${started.status}). Please retry.`);}
 const location=started.headers.get('Location');if(!location)throw new WebinarError(502,'Storage did not return an upload destination.');
 const uploadUrl=new URL(location,endpoint);if(uploadUrl.origin!==new URL(endpoint).origin)throw new WebinarError(502,'Storage returned an unexpected upload destination.');
 return Response.json({path,token,endpoint,uploadUrl:uploadUrl.href,publicUrl:`${base}/storage/v1/object/public/icash-webinars/${path}`},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
