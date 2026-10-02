import {dealMachinePhoto} from './property-photo.ts';
import {propertyIdPattern} from './property-context.ts';
/** Free base-field preview only. No enrichment, contacts, retries or writes. */
export async function loadPropertyPhoto(id:string,key:string|undefined,transport:typeof fetch=fetch){
 const report=(reason:string,status?:number)=>console.info('property_photo_lookup',JSON.stringify({reason,...(status===undefined?{}:{status})}));
 if(typeof window!=='undefined'||!propertyIdPattern.test(id)){report('invalid_property');return null;}
 if(!key?.trim()){report('key_missing');return null;}
 if(!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(key)){report('key_invalid_format');return null;}
 try{
  const response=await transport(`https://api.v2.dealmachine.com/v1/properties/${id}?enrich=false&contact_audience=none`,{headers:{Authorization:`Bearer ${key}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok){report('provider_http_error',response.status);return null;}
  const body=await response.json();
  if(body?.data?.dm_property_id!==id){report('property_mismatch');return null;}
  const photo=dealMachinePhoto(body.data.images);
  if(!photo){const keys=(value:unknown)=>value&&typeof value==='object'?Object.keys(value).filter(k=>/^[a-zA-Z_]{1,40}$/.test(k)).slice(0,60):[];console.info('property_photo_shape',JSON.stringify({root:keys(body),data:keys(body.data),included:keys(body.included),relationships:keys(body.data.relationships)}));}
  report(photo?'photo_available':body.data.images?'image_format_unavailable':'images_missing');
  return photo;
 }catch{report('request_failed');return null;}
}
