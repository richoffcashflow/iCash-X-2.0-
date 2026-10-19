import {dashboardCurrentUser as currentUser} from '@/lib/dashboard-password';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {db} from '@/lib/stripe-test';
import {callbackPhone,callbackBusinessNumbers,validSellerCallbackContext} from '@/lib/seller-callback-context';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
export async function POST(req:Request){
 try{
  const user=await currentUser(true);
  if(!user)return Response.json({error:'Sign in to find the caller’s property.'},{status:401,headers});
  if(user.id!==ownerInboundTarget.ownerUserId)return Response.json({error:'Owner access required.'},{status:403,headers});
  if(Number(req.headers.get('content-length')??0)>512)return Response.json({error:'Enter a valid phone number.'},{status:400,headers});
  const raw=await req.text();if(Buffer.byteLength(raw)>512)return Response.json({error:'Enter a valid phone number.'},{status:400,headers});
  let body;try{body=JSON.parse(raw);}catch{return Response.json({error:'Enter a valid phone number.'},{status:400,headers});}
  const phone=typeof body?.phone==='string'?callbackPhone(body.phone):null,business=body?.businessNumber??null;
  if(!phone||business!==null&&!callbackBusinessNumbers.includes(business))return Response.json({error:'Enter a valid caller and business number.'},{status:400,headers});
  const report=await db<unknown>('rpc/icash_owner_callback_context','POST',{p_actor:user.id,p_phone:phone,p_business:business},req.signal);
  if(!validSellerCallbackContext(report,phone,business))throw Error('Invalid callback context');
  return Response.json({report},{headers});
 }catch{return Response.json({error:'Caller details could not load. Please try again.'},{status:503,headers});}
}
