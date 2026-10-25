import {db} from '@/lib/stripe-test';
import {webinarFromRow,type WebinarRow} from '@/lib/webinar-policy';
import {WebinarError} from '@/lib/webinar-server';
const cacheSeconds=2592000;
const bucket='icash-webinars';
/** Copy only saved, owner-uploaded public videos. Existing viewer snapshots and
 * original objects stay intact; repeated requests reuse the same destination. */
export async function optimizeWebinarDelivery(id:string,revision:number,ownerId:string){
 const [row]=await db<WebinarRow[]>(`icash_webinars?id=eq.${id}&revision=eq.${revision}&select=config,public_code,parent_webinar_id&limit=1`);
 if(!row)throw new WebinarError(409,'This session changed in another tab. Reload before optimizing.');
 const base=new URL(process.env.SUPABASE_URL!),key=process.env.SUPABASE_SECRET_KEY;
 if(!key)throw new WebinarError(503,'Video storage is unavailable.');
 const storageHeaders={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
 const signal=AbortSignal.timeout(45000),prefix=`/storage/v1/object/public/${bucket}/`;
 let changed=0;
 async function optimize(url:string){
  if(!url)return url;
  const source=new URL(url);
  // External videos and private course files are never fetched or copied.
  if(source.origin!==base.origin||source.search||source.hash||!source.pathname.startsWith(prefix))return url;
  const object=source.pathname.slice(prefix.length),[owner,file,...rest]=object.split('/');
  if(owner!==ownerId||rest.length||!file||!/^[0-9a-f-]{36}(?:-cache30d)?\.(mp4|webm|mov)$/i.test(file))return url;
  const head=await fetch(source,{method:'HEAD',redirect:'error',cache:'no-store',signal});
  const length=head.headers.get('content-length'),type=head.headers.get('content-type');
  if(!head.ok||!length||!/^\d+$/.test(length)||Number(length)<1||!type?.startsWith('video/'))throw new WebinarError(502,'Could not verify the saved video. No session changes were published.');
  if(Number(head.headers.get('cache-control')?.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1]??0)>=cacheSeconds)return url;
  const destination=`${owner}/${file.replace(/(?:-cache30d)?\.(mp4|webm|mov)$/i,'-cache30d.$1')}`;
  if(destination===object)throw new WebinarError(502,'The optimized file needs review. No session changes were published.');
  const publicUrl=new URL(prefix+destination,base).href;
  const existing=await fetch(publicUrl,{method:'HEAD',redirect:'error',cache:'no-store',signal});
  if(!existing.ok){
   if(existing.status!==404&&existing.status!==400)throw new WebinarError(502,'Could not check video storage. Please retry.');
   const copied=await fetch(new URL('/storage/v1/object/copy',base),{method:'POST',headers:storageHeaders,body:JSON.stringify({bucketId:bucket,sourceKey:object,destinationKey:destination,copyMetadata:false,metadata:{cacheControl:`max-age=${cacheSeconds}`,mimetype:type}}),redirect:'error',signal});
   // A concurrent request may have created the same immutable destination.
   if(!copied.ok&&copied.status!==409)throw new WebinarError(502,'Could not optimize video storage. No session changes were published.');
  }
  const verified=existing.ok?existing:await fetch(publicUrl,{method:'HEAD',redirect:'error',cache:'no-store',signal});
  if(!verified.ok||verified.headers.get('content-length')!==length||verified.headers.get('content-type')!==type||Number(verified.headers.get('cache-control')?.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1]??0)<cacheSeconds)throw new WebinarError(502,'The optimized video could not be verified. No session changes were published.');
  changed++;return publicUrl;
 }
 const config={...row.config,videoUrl:await optimize(row.config.videoUrl)};
 if(config.nightVersion)config.nightVersion={...config.nightVersion,videoUrl:await optimize(config.nightVersion.videoUrl)};
 if(!changed)return {webinar:webinarFromRow(row),optimized:0};
 config.revision=revision+1;
 const [saved]=await db<WebinarRow[]>(`icash_webinars?id=eq.${id}&revision=eq.${revision}`,'PATCH',{revision:config.revision,config,updated_at:new Date().toISOString()});
 if(!saved)throw new WebinarError(409,'This session changed in another tab. Reload before optimizing.');
 return {webinar:webinarFromRow(saved),optimized:changed};
}
