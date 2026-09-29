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
  const [deals,contacts,controls,conversations,callbacks]=ids?await Promise.all([
   db<unknown[]>(`icash_deal_files?account_id=eq.${accountId}&screening_id=in.(${ids})&select=id,screening_id,terms,stage,updated_at`),
   db<unknown[]>(`icash_owner_contacts?account_id=eq.${accountId}&screening_id=in.(${ids})&select=screening_id,created_at`),
   propertyIds?db<unknown[]>(`icash_property_controls?account_id=eq.${accountId}&property_id=in.(${propertyIds})&manual=eq.true&select=property_id`):Promise.resolve([]),
   db<unknown[]>(`icash_live_conversations?account_id=eq.${accountId}&screening_id=in.(${ids})&state=eq.complete&select=id,screening_id,party,result,completed_at&order=completed_at.desc&limit=24`),
   db<unknown[]>(`icash_live_callbacks?account_id=eq.${accountId}&screening_id=in.(${ids})&select=id,screening_id,due_at,timezone,state&order=due_at&limit=24`)
  ]):[[],[],[],[],[]];
  const handoffs=await db<unknown[]>(`icash_handoffs?account_id=eq.${accountId}&state=neq.resolved&select=id,screening_id,party,reason,summary,next_action,state&order=created_at&limit=6`);
  const dealIds=(deals as {id:string}[]).map(d=>d.id).join(',');
  const signing=dealIds?await db<unknown[]>(`icash_signing_envelopes?account_id=eq.${accountId}&deal_id=in.(${dealIds})&select=id,deal_id,kind,state,test_mode,updated_at`):[];
  const signatureActions=await db<{id:string;kind:string;test_mode:boolean}[]>(`icash_signing_envelopes?account_id=eq.${accountId}&state=eq.customer_signature_needed&select=id,kind,test_mode&order=created_at&limit=6`);
  return NextResponse.json({signatureActions,signing,signingConfigured:!!(process.env.DOCUSEAL_API_KEY||process.env.DOCUSEAL_TEST_API_KEY),properties:properties.slice(0,6),hasMore:properties.length>6,deals,contacts,controls,conversations,callbacks,handoffs,page},{headers});
 }catch{return NextResponse.json({error:'Could not load your work. Sign in and retry.'},{status:503,headers});}
}
