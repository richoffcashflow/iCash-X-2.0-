import {dealMachinePhoto} from './property-photo.ts';
import {propertyIdPattern} from './property-context.ts';
/** Free base-field preview only. No enrichment, contacts, retries or writes. */
export async function loadPropertyPhoto(id:string,key:string|undefined,transport:typeof fetch=fetch){
 if(typeof window!=='undefined'||!propertyIdPattern.test(id)||!key||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(key))return null;
 try{
  const response=await transport(`https://api.v2.dealmachine.com/v1/properties/${id}?enrich=false&contact_audience=none`,{headers:{Authorization:`Bearer ${key}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)return null;
  const body=await response.json();
  return body?.data?.dm_property_id===id?dealMachinePhoto(body.data.images):null;
 }catch{return null;}
}
