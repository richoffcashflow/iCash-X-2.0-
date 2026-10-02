import type {PropertyPhoto} from './property-photo.ts';
// Bounded, short-lived and account scoped. Never a shared customer data cache.
const cached=new Map<string,{until:number;photo:PropertyPhoto|null}>();
const inFlight=new Map<string,Promise<PropertyPhoto|null>>();
const attempts=new Map<string,number[]>();
export async function cachedPropertyPhoto(accountId:string,screeningId:string,load:()=>Promise<PropertyPhoto|null>,now=Date.now()){
 const key=`${accountId}:${screeningId}`,hit=cached.get(key);
 if(hit&&hit.until>now)return hit.photo;
 if(inFlight.has(key))return inFlight.get(key)!;
 const recent=(attempts.get(accountId)??[]).filter(time=>time>now-60000);
 // At most two six-property pages per account per minute, regardless of retries.
 if(recent.length>=12||inFlight.size>=64)return null;
 if(attempts.size>=256&&!attempts.has(accountId))attempts.delete(attempts.keys().next().value!);
 attempts.set(accountId,[...recent,now]);
 const pending=load().catch(()=>null).then(photo=>{
  if(cached.size>=256)cached.delete(cached.keys().next().value!);
  cached.set(key,{until:now+(photo?15*60000:60000),photo});return photo;
 }).finally(()=>inFlight.delete(key));
 inFlight.set(key,pending);return pending;
}
