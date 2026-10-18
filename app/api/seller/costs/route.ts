import {dashboardCurrentUser} from '@/lib/dashboard-password';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {acquisitionCostInput,acquisitionCostReport} from '@/lib/seller-acquisition-costs';
import {validateMetaCostSource,sellerMetaCostEnvironment,MetaCostError} from '@/lib/seller-meta-costs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
async function owner(){const user=await dashboardCurrentUser(true);return user?.id===ownerInboundTarget.ownerUserId?user:null;}
export async function GET(){
 try{const user=await owner();if(!user)return Response.json({error:'Platform owner access required.'},{status:403,headers});
  const [report,automation]=await Promise.all([db<Record<string,unknown>>('rpc/icash_owner_seller_costs','POST',{p_actor:user.id}),db('rpc/icash_owner_seller_meta_costs','POST',{p_actor:user.id})]);
  return Response.json(acquisitionCostReport.parse({...report,automation}),{headers});
 }catch{return Response.json({error:'Lead costs could not load. Try again.'},{status:503,headers});}
}
export async function POST(req:Request){
 if(!allowedOrigin(req))return Response.json({error:'Invalid origin.'},{status:403,headers});
 try{const user=await owner();if(!user)return Response.json({error:'Platform owner access required.'},{status:403,headers});
  const raw=await req.text();if(raw.length>3000)return Response.json({error:'Cost entry is too large.'},{status:413,headers});
  const parsed=acquisitionCostInput.safeParse(JSON.parse(raw));if(!parsed.success)return Response.json({error:'Check the amount, source and note.'},{status:400,headers});
  const i=parsed.data;
  if(i.action==='meta'){
   if(i.enabled)await validateMetaCostSource(i.accountId,i.metaCampaignId,await sellerMetaCostEnvironment(db,process.env));
   const result=await db<{saved:boolean}>('rpc/icash_save_seller_meta_source','POST',{p_actor:user.id,p_campaign:i.campaign,p_account:i.accountId,p_meta_campaign:i.metaCampaignId,p_enabled:i.enabled});if(!result?.saved)throw Error();
   return Response.json({saved:true,message:i.enabled?'Automatic Meta cost tracking saved. The next scheduled check will import spend.':'Automatic Meta cost tracking paused.'},{headers});
  }
  const result=await db<{saved:boolean}>('rpc/icash_record_seller_acquisition_cost','POST',{p_actor:user.id,p_request:i.requestId,p_kind:i.action,p_lead:i.action==='lead'?i.leadId:null,p_source:i.action==='estimate'?i.source:null,p_campaign:i.action==='estimate'?i.campaign:null,p_cents:i.costCents,p_note:i.note});
  if(!result?.saved)throw Error('Save not confirmed');
  return Response.json({saved:true,message:i.action==='lead'?'Lead cost recorded. Existing charges are unchanged.':'Estimate saved for new leads. Existing charges are unchanged.'},{headers});
 }catch(e){return Response.json({error:e instanceof MetaCostError?e.message:'Cost was not confirmed. Retry the same entry or refresh before changing it.'},{status:400,headers});}
}
