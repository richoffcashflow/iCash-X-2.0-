import {dealMachinePhoto,type PropertyPhoto} from './property-photo.ts';
type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
export function checkedPhoto(value:unknown):PropertyPhoto|null{
 if(!value||typeof value!=='object')return null;
 const p=value as PropertyPhoto;
 if(p.source!=='DealMachine'||!['street_view','satellite'].includes(p.view))return null;
 const photo=dealMachinePhoto({[p.view]:p.url});if(!photo)return null;
 const fallback=dealMachinePhoto({satellite:p.fallbackUrl});
 return {...photo,...(fallback?{fallbackUrl:fallback.url}:{})};
}
/** Display previously fetched metadata without taking a lease, buying data or
 * changing customer work. CDN URLs remain usable after the lookup cache expires. */
export async function savedPropertyPhoto(db:Database,accountId:string,screeningId:string){
 return checkedPhoto(await db<unknown>('rpc/icash_read_photo_cache','POST',{p_account:accountId,p_screening:screeningId}));
}
/** Account + screening scoped, 15-minute metadata cache with a cross-instance lease.
 * An unavailable cache never starts uncontrolled provider requests.
 */
export async function persistentPropertyPhoto(db:Database,accountId:string,screeningId:string,load:()=>Promise<PropertyPhoto|null>){
 const claim=await db<{state:string;photo?:unknown;lease?:string}|null>('rpc/icash_claim_photo_cache','POST',{p_account:accountId,p_screening:screeningId});
 if(claim?.state==='cached')return checkedPhoto(claim.photo);
 if(claim?.state!=='claimed'||typeof claim.lease!=='string')return null;
 const photo=checkedPhoto(await load().catch(()=>null));
 await db('rpc/icash_finish_photo_cache','POST',{p_account:accountId,p_screening:screeningId,p_lease:claim.lease,p_photo:photo});
 return photo;
}
