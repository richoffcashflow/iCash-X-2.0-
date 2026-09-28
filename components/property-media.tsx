"use client";
import { useState } from "react";
import Image from "next/image";
import { House } from "lucide-react";
/** Only pass provider image URLs after server-side source/usage-rights validation. */
export function PropertyMedia({photo}:{photo?:{url:string;source:string;alt:string}}) {
  const [failedUrl,setFailedUrl]=useState<string|null>(null);
  return <div className="property-media">{photo && failedUrl!==photo.url ? <><Image src={photo.url} alt={photo.alt} width={600} height={260} unoptimized onError={()=>setFailedUrl(photo.url)}/><span>{photo.source}</span></> : <div className="property-photo-empty"><House size={35}/><span>Property photo</span><small>No provider photo connected in this preview.</small></div>}</div>;
}
