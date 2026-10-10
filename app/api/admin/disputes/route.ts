import {currentUser} from '@/lib/account-auth';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {disputeIdPattern} from '@/lib/disputes';
import {listDisputes,prepareDisputeEvidence} from '@/lib/dispute-service';
import {disputePdf} from '@/lib/dispute-pdf';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
export async function GET(req:Request){
 try{
  const user=await currentUser(true);
  if(!user)return Response.json({error:'Sign in to your owner account.'},{status:401,headers});
  if(user.id!==ownerInboundTarget.ownerUserId)return Response.json({error:'Disputes are only available to the platform owner.'},{status:403,headers});
  const search=new URL(req.url).searchParams,id=search.get('id'),cursor=search.get('after'),format=search.get('format')??'json';
  if((id&&!disputeIdPattern.test(id))||(cursor&&!disputeIdPattern.test(cursor))||!['json','pdf','download'].includes(format)||(id&&cursor)||(!id&&format!=='json'))return Response.json({error:'Choose a valid dispute.'},{status:400,headers});
  if(!id)return Response.json(await listDisputes(cursor??undefined),{headers});
  const packet=await prepareDisputeEvidence(id,req.signal);
  if(format==='pdf')return new Response(Buffer.from(await disputePdf(packet)),{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${id}-evidence.pdf"`}});
  if(format==='download')return new Response(JSON.stringify(packet,null,2),{headers:{...headers,'Content-Type':'application/json','Content-Disposition':`attachment; filename="${id}-evidence.json"`}});
  return Response.json({packet},{headers});
 }catch{return Response.json({error:'Dispute records could not load. Retry, or open Stripe to check the deadline.'},{status:503,headers});}
}
