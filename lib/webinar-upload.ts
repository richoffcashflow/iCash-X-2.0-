/** TUS upload with server-scoped signatures. No service key reaches the browser. */
export async function uploadWebinarFile(file:File,onProgress:(n:number)=>void,signal?:AbortSignal){
 const init=await fetch('/api/webinar/studio/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:file.type,size:file.size}),signal});
 const config=await init.json();if(!init.ok)throw Error(config.error||'Could not prepare upload.');
 const headers={'Tus-Resumable':'1.0.0','x-signature':config.token};
 const metadata=Object.entries({bucketName:'icash-webinars',objectName:config.path,contentType:file.type,cacheControl:'3600'}).map(([key,value])=>`${key} ${btoa(unescape(encodeURIComponent(value as string)))}`).join(',');
 const started=await fetch(config.endpoint,{method:'POST',headers:{...headers,'Upload-Length':String(file.size),'Upload-Metadata':metadata},signal});
 if(!started.ok)throw Error('Upload could not start. Try a direct video URL or retry the file.');
 const location=started.headers.get('Location');if(!location)throw Error('Upload destination is missing.');const url=new URL(location,config.endpoint);
 if(url.origin!==new URL(config.endpoint).origin)throw Error('Unexpected upload destination.');
 let offset=0,attempts=0;
 while(offset<file.size){
  try{
   const end=Math.min(offset+6*1024*1024,file.size);
   const res=await fetch(url,{method:'PATCH',headers:{...headers,'Content-Type':'application/offset+octet-stream','Upload-Offset':String(offset)},body:file.slice(offset,end),signal});
   if(!res.ok)throw Error('Upload interrupted');const next=Number(res.headers.get('Upload-Offset'));if(!Number.isFinite(next)||next<=offset||next>file.size)throw Error('Invalid upload progress');offset=next;attempts=0;onProgress(Math.round(100*offset/file.size));
  }catch(e){
   if(signal?.aborted||++attempts>3)throw e;
   await new Promise(r=>setTimeout(r,Math.min(1000*2**attempts,8000)));
   const status=await fetch(url,{method:'HEAD',headers,signal});if(!status.ok)throw e;const next=Number(status.headers.get('Upload-Offset'));if(!Number.isSafeInteger(next)||next<0||next>file.size)throw e;offset=next;
  }
 }
 return config.publicUrl as string;
}
