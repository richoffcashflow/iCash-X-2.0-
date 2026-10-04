import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarOwner,WebinarError} from '@/lib/webinar-server';
export async function POST(req:Request){try{
 webinarOrigin(req);const user=await webinarOwner();await webinarLimit(req,user.id,'upload',15,600);
 const i=z.object({type:z.enum(['video/mp4','video/webm','video/quicktime','image/jpeg','image/png','image/webp']),size:z.number().int().positive().max(2147483648)}).strict().parse(await webinarBody(req,512));
 const extensions={'video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov','image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
 const path=`${user.id}/${randomUUID()}.${extensions[i.type]}`;const base=process.env.SUPABASE_URL!;
 const response=await fetch(`${base}/storage/v1/object/upload/sign/icash-webinars/${path}`,{method:'POST',headers:{apikey:process.env.SUPABASE_SECRET_KEY!,Authorization:`Bearer ${process.env.SUPABASE_SECRET_KEY}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new WebinarError(503,'Could not prepare the upload. Confirm webinar storage is installed.');
 const data=await response.json();const signed=new URL(data.url,`${base}/storage/v1/`);const token=signed.searchParams.get('token');if(!token)throw Error('Upload signature missing');
 return Response.json({path,token,endpoint:`${base.replace('.supabase.co','.storage.supabase.co')}/storage/v1/upload/resumable`,publicUrl:`${base}/storage/v1/object/public/icash-webinars/${path}`},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
