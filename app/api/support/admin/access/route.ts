import {scheduleSupportCustomerNotifications} from '@/lib/support-customer-dispatch';
import {db} from '@/lib/stripe-test';
import {requireTrustedOperator} from '@/lib/trusted-operator';
import {allowedOrigin} from '@/lib/funding-policy';
import {accessHelpUpdate,accessHelpRedact} from '@/lib/access-help';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
function failure(error:unknown){const denied=error instanceof Error&&['SIGN_IN_REQUIRED','OPERATOR_REQUIRED'].includes(error.message);return Response.json({error:denied?'A support operator account is required.':'Access support is temporarily unavailable.'},{status:denied?403:503,headers});}
export async function GET(req:Request){
 try{
  await requireTrustedOperator();const id=new URL(req.url).searchParams.get('id');
  if(id){
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return Response.json({error:'Invalid request.'},{status:400,headers});
   const [request]=await db<Record<string,unknown>[]>(`icash_access_help_requests?id=eq.${id}&select=id,email,phone,status,created_at,updated_at`);
   if(!request)return Response.json({error:'Request not found.'},{status:404,headers});
   const messages=await db<Record<string,unknown>[]>(`icash_access_help_messages?request_id=eq.${id}&select=id,role,content,created_at&order=created_at.desc,id.desc&limit=100`);
   const [notification]=await db<{status:string;delivery:string|null}[]>(`icash_support_customer_emails?access_request_id=eq.${id}&select=status,delivery&order=created_at.desc,id.desc&limit=1`);
   return Response.json({request,messages:messages.reverse(),notification:notification??null},{headers});
  }
  const [requests,resolved,purchases]=await Promise.all([
   db<Record<string,unknown>[]>('icash_access_help_requests?status=neq.resolved&select=id,email,phone,status,created_at,updated_at&order=updated_at.desc&limit=100'),
   db<Record<string,unknown>[]>('icash_access_help_requests?status=eq.resolved&select=id,email,phone,status,created_at,updated_at&order=updated_at.desc&limit=20'),
   db('icash_purchase_access_attention?select=id,email,paid_at,email_status,email_delivery,text_status,text_delivery,reason&order=paid_at.asc&limit=100')
  ]);
  return Response.json({requests:[...requests,...resolved],purchases},{headers});
 }catch(error){return failure(error);}
}
export async function POST(req:Request){
 if(!allowedOrigin(req))return Response.json({error:'Invalid origin.'},{status:403,headers});
 try{
  const {userId}=await requireTrustedOperator();const raw=await req.text();
  if(raw.length>6000)return Response.json({error:'Reply too long.'},{status:413,headers});
  const parsed=accessHelpUpdate.safeParse(JSON.parse(raw));if(!parsed.success)return Response.json({error:'Check the reply and status.'},{status:400,headers});
  const i=parsed.data;await db('rpc/icash_access_help_operator_update','POST',{p_operator:userId,p_id:i.id,p_key:i.requestId,p_status:i.status,p_reply:i.reply?accessHelpRedact(i.reply):null});
  scheduleSupportCustomerNotifications();
  return Response.json({saved:true},{headers});
 }catch(error){return failure(error);}
}
