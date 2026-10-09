import {cookies} from 'next/headers';
import {db,guestHash} from '@/lib/stripe-test';
import {validGuest,limitRequest} from '@/lib/funding';
import {sellerSubmissionStatus} from '@/lib/seller-submission-status';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
type Intake={id:string;state:string;canonical_id:string|null};
export async function GET(req:Request){
 const request=new URL(req.url).searchParams.get('request');
 if(!request||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(request))return Response.json({error:'Valid request required.'},{status:400,headers});
 try{
  const token=(await cookies()).get('keypath_seller')?.value;
  if(!validGuest(token))return Response.json({error:'Request not found.'},{status:404,headers});
  await limitRequest(req,'seller-status',token,90,300);
  let [lead]=await db<Intake[]>(`icash_seller_intakes?request_id=eq.${request}&guest_hash=eq.${guestHash(token)}&select=id,state,canonical_id&limit=1`);
  if(!lead)return Response.json({error:'Request not found.'},{status:404,headers});
  // A duplicate submission keeps its own private receipt. Only generic progress
  // from its canonical request is returned, never the earlier seller's details.
  if(lead.state==='duplicate'&&lead.canonical_id){
   const [canonical]=await db<Intake[]>(`icash_seller_intakes?id=eq.${lead.canonical_id}&select=id,state,canonical_id&limit=1`);
   if(canonical)lead=canonical;
  }
  let responseState:string|undefined,voiceOutcome:string|undefined;
  if(lead.state==='assigned'){
   const responses=await db<{state:string;outcome?:{voice?:string}}[]>(`icash_seller_responses?lead_id=eq.${lead.id}&select=state,outcome&order=created_at.asc&limit=3`);
   responseState=responses.some(r=>r.state==='contact_started')?'contact_started':responses[0]?.state;
   voiceOutcome=responses[0]?.outcome?.voice;
  }
  return Response.json(sellerSubmissionStatus(lead.state,responseState,voiceOutcome),{headers});
 }catch{return Response.json({error:'Progress is temporarily unavailable. Your saved request is unchanged.'},{status:503,headers});}
}
