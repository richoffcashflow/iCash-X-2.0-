import {currentUser} from '@/lib/account-auth';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {db} from '@/lib/stripe-test';
import {sellerLookupHistory} from '@/lib/seller-lookup-history';
export const dynamic='force-dynamic';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:Request){
 try{
  const user=await currentUser(true);
  if(user?.id!==ownerInboundTarget.ownerUserId)return Response.json({error:'Platform owner access required.'},{status:403,headers});
  const id=new URL(req.url).searchParams.get('lead');
  if(!id||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))return Response.json({error:'Valid lead required.'},{status:400,headers});
  const [lead]=await db<{id:string;address:string;state:string;claimed_at:string|null;created_at:string;result:unknown;hold_reason:string|null}[]>(`icash_seller_intakes?id=eq.${id}&select=id,address,state,claimed_at,created_at,result,hold_reason`);
  if(!lead)return Response.json({error:'Lead not found.'},{status:404,headers});
  const history=await sellerLookupHistory(lead,process.env.DEALMACHINE_API_KEY);
  return Response.json({lead,...history},{headers});
 }catch(error){return Response.json({error:error instanceof Error&&/^HISTORY_[A-Z_0-9]+$/.test(error.message)?error.message:'Lookup history unavailable.'},{status:503,headers});}
}
