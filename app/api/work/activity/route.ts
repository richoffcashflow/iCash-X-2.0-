import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{
  const {accountId}=await workAccount();const page=Math.min(10000,Math.max(0,Number(new URL(req.url).searchParams.get('page'))||0));if(!Number.isInteger(page))throw new Error();
  const properties=await 
   db<Array<{id:string;state:string;result:{property:{propertyId:string;address:string;screeningBuyerCeilingCents:number|null;financialScreening:{status:string}};financialCheck:{status:string;reason:string};preliminarySellerCeilingCents:number|null};completed_at:string}>>(`icash_screening_jobs?account_id=eq.${accountId}&state=eq.complete&select=id,state,result,completed_at&order=completed_at.desc&limit=7&offset=${page*6}`);
  const visible=properties.slice(0,6);
  const ids=visible.map(p=>p.id).join(',');
  const propertyIds=visible.map(p=>p.result.property.propertyId).filter(id=>/^prop_[a-zA-Z0-9]+$/.test(id)).join(',');
  const [deals,contacts,controls]=ids?await Promise.all([
   db<unknown[]>(`icash_deal_files?account_id=eq.${accountId}&screening_id=in.(${ids})&select=id,screening_id,terms,stage,updated_at`),
   db<unknown[]>(`icash_owner_contacts?account_id=eq.${accountId}&screening_id=in.(${ids})&select=screening_id,created_at`),
   propertyIds?db<unknown[]>(`icash_property_controls?account_id=eq.${accountId}&property_id=in.(${propertyIds})&manual=eq.true&select=property_id`):Promise.resolve([])
  ]):[[],[],[]];
  return NextResponse.json({properties:properties.slice(0,6),hasMore:properties.length>6,deals,contacts,controls,page},{headers});
 }catch{return NextResponse.json({error:'Could not load your work. Sign in and retry.'},{status:503,headers});}
}
