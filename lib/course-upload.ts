/** Direct, chunked upload. A complete file is verified before replacing the published course. */
export async function uploadCourseFile(file:File,kind:'video'|'pdf',revision:number,onProgress:(n:number)=>void,signal:AbortSignal){
 const response=await fetch('/api/course/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,type:file.type,size:file.size,name:file.name,revision}),signal});
 const config=await response.json();if(!response.ok)throw Error(config.error||'Could not prepare the upload.');
 const url=new URL(config.uploadUrl);if(url.origin!==new URL(config.endpoint).origin)throw Error('Unexpected upload destination.');
 const headers={'Tus-Resumable':'1.0.0','x-signature':config.token};let offset=0,attempts=0;
 while(offset<file.size){
  try{
   const end=Math.min(offset+6*1024*1024,file.size);
   const res=await fetch(url,{method:'PATCH',headers:{...headers,'Content-Type':'application/offset+octet-stream','Upload-Offset':String(offset)},body:file.slice(offset,end),signal});
   if(!res.ok)throw Error('Upload interrupted. Please retry.');const next=Number(res.headers.get('Upload-Offset'));if(!Number.isSafeInteger(next)||next<=offset||next>file.size)throw Error('Invalid upload progress.');offset=next;attempts=0;onProgress(Math.round(offset/file.size*100));
  }catch(error){
   if(signal.aborted||++attempts>3)throw error;
   await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**attempts,8000)));signal.throwIfAborted();
   const status=await fetch(url,{method:'HEAD',headers,signal});const next=Number(status.headers.get('Upload-Offset'));if(!status.ok||!Number.isSafeInteger(next)||next<0||next>file.size)throw error;offset=next;
  }
 }
 const saved=await fetch('/api/course/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:config.ticket}),signal});const result=await saved.json();if(!saved.ok)throw Error(result.error||'Could not publish this file.');
}
