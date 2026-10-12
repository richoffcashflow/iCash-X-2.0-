'use client';
import {useRef,useState} from 'react';
import {webinarRequest} from '@/lib/webinar-client';

export function SigningLinkButton({envelopeId,disabled=false}:{envelopeId:string;disabled?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[link,setLink]=useState('');
 const inFlight=useRef(false);
 async function open(){
  if(inFlight.current||disabled)return;
  inFlight.current=true;setBusy(true);setError('');setLink('');
  try{
   const data=await webinarRequest<{url:string}>('/api/work/signing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'link',id:envelopeId})},35000);
   const url=new URL(data.url);
   if(url.protocol!=='https:'||url.hostname!=='docuseal.com'||url.port||url.username||url.password||!/^\/s\/[A-Za-z0-9_-]+$/.test(url.pathname)||url.search||url.hash)throw Error('The signing link could not be verified. Try again.');
   setLink(url.href);
   window.location.assign(url.href);
  }catch(e){setError(e instanceof Error?e.message:'Could not open the agreement. Try again.');}
  finally{inFlight.current=false;setBusy(false);}
 }
 return <div className="signing-link-action">
  <button type="button" disabled={busy||disabled} aria-busy={busy} onClick={()=>void open()}>{busy?'Opening agreement…':'Review & sign'}</button>
  {busy&&<p role="status">Getting your secure signing link…</p>}
  {link&&<p><a href={link}>Open agreement</a></p>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
