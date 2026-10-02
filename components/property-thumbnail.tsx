'use client';
import {useEffect,useState} from 'react';
import Image from 'next/image';
import {House} from 'lucide-react';
import {dealMachinePhoto,type PropertyPhoto} from '@/lib/property-photo';
export function PropertyThumbnail({screeningId,address,images}:{screeningId:string;address:string;images?:unknown}){
 const [loaded,setLoaded]=useState<{id:string;photo:PropertyPhoto|null}|null>(null),[failed,setFailed]=useState<string[]>([]);
 const saved=dealMachinePhoto(images),primary=saved??(loaded?.id===screeningId?loaded.photo:null);
 const photo=primary&&failed.includes(primary.url)&&primary.fallbackUrl?dealMachinePhoto({satellite:primary.fallbackUrl}):primary;
 useEffect(()=>{
  if(saved)return;
  const controller=new AbortController();
  void fetch(`/api/work/property-photo?screeningId=${encodeURIComponent(screeningId)}`,{signal:controller.signal,cache:'no-store'}).then(async response=>{
   if(!response.ok)return;const body=await response.json();
   const candidate=body?.photo;
   const valid=candidate&&['street_view','satellite'].includes(candidate.view)?dealMachinePhoto({[candidate.view]:candidate.url}):null;
   if(valid&&candidate.fallbackUrl){const fallback=dealMachinePhoto({satellite:candidate.fallbackUrl});if(fallback)valid.fallbackUrl=fallback.url;}
   if(!controller.signal.aborted)setLoaded({id:screeningId,photo:valid});
  }).catch(()=>{/* Photos never block the workspace. */});
  return()=>controller.abort();
 },[screeningId,saved?.url]);
 return <span className="property-thumbnail">
  {photo&&!failed.includes(photo.url)?<><Image src={photo.url} alt={`${photo.view==='satellite'?'Satellite view':'Street view'} of ${address}`} width={80} height={80} unoptimized loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed([...failed,photo.url])}/><span className="property-thumbnail-source">{photo.view==='satellite'?'Aerial view':'Property photo'}</span></>:<span className="property-thumbnail-empty"><House size={24} aria-hidden="true"/><span>Photo unavailable</span></span>}
 </span>;
}
