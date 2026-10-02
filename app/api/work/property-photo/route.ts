import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {dealMachinePhoto} from '@/lib/property-photo';
import {loadPropertyPhoto} from '@/lib/dealmachine-photo';
import {cachedPropertyPhoto} from '@/lib/property-photo-cache';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{
  const {accountId}=await workAccount(),id=z.string().uuid().parse(new URL(req.url).searchParams.get('screeningId'));
  const [row]=await db<{snapshot:{propertyId?:string;raw?:{data?:{dm_property_id?:string;images?:unknown}}};result:{property:{propertyId:string;images?:unknown}}}[]>(`icash_screening_jobs?account_id=eq.${accountId}&id=eq.${id}&state=eq.complete&select=snapshot,result&limit=1`);
  if(!row)return NextResponse.json({photo:null},{status:404,headers});
  const property=row.result.property,raw=row.snapshot?.raw?.data;
  const stored=dealMachinePhoto(property.images)??(raw?.dm_property_id===property.propertyId?dealMachinePhoto(raw.images):null);
  const photo=stored??await cachedPropertyPhoto(accountId,id,()=>loadPropertyPhoto(property.propertyId,process.env.DEALMACHINE_API_KEY));
  return NextResponse.json({photo},{headers});
 }catch{return NextResponse.json({photo:null},{status:503,headers});}
}
