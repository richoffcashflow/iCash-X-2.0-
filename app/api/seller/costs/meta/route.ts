import {dashboardCurrentUser} from '@/lib/dashboard-password';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {z} from 'zod';
import {listMetaCostAccounts,listMetaCostCampaigns,sellerMetaCostEnvironment,MetaCostError} from '@/lib/seller-meta-costs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:Request){
 try{
  const user=await dashboardCurrentUser(true);if(user?.id!==ownerInboundTarget.ownerUserId)return Response.json({error:'Platform owner access required.'},{status:403,headers});
  const account=new URL(req.url).searchParams.get('account'),env=await sellerMetaCostEnvironment(db,process.env);
  return Response.json(account?{campaigns:await listMetaCostCampaigns(account,env)}:{accounts:await listMetaCostAccounts(env)},{headers});
 }catch(e){return Response.json({error:e instanceof MetaCostError?e.message:'Meta connection could not be checked.'},{status:503,headers});}
}
const credential=z.object({token:z.string().trim().min(20).max(4096).regex(/^[A-Za-z0-9._|-]+$/)}).strict();
export async function POST(req:Request){
 if(!allowedOrigin(req))return Response.json({error:'Invalid origin.'},{status:403,headers});
 try{
  const user=await dashboardCurrentUser(true);if(user?.id!==ownerInboundTarget.ownerUserId)return Response.json({error:'Platform owner access required.'},{status:403,headers});
  const raw=await req.text();if(raw.length>6000)return Response.json({error:'Token entry is too large.'},{status:413,headers});
  let input;try{input=credential.safeParse(JSON.parse(raw));}catch{return Response.json({error:'Enter a valid Meta access token.'},{status:400,headers});}
  if(!input.success)return Response.json({error:'Enter a valid Meta access token.'},{status:400,headers});
  const accounts=await listMetaCostAccounts({...process.env,META_ADS_READ_ACCESS_TOKEN:input.data.token});
  if(!accounts.length)return Response.json({error:'This token cannot access a USD ad account. In Meta, assign the HomeOffer ad account and include ads_read permission, then try again.'},{status:400,headers});
  const sources=await db<{ad_account:string}[]>('icash_seller_meta_sources?enabled=eq.true&select=ad_account');
  if(sources.some(s=>!accounts.some(a=>a.id===s.ad_account)))return Response.json({error:'This token also needs access to your already connected ad accounts. Your saved connection is unchanged.'},{status:400,headers});
  const saved=await db<boolean>('rpc/icash_save_seller_meta_access','POST',{p_actor:user.id,p_token:input.data.token});if(saved!==true)throw Error();
  return Response.json({saved:true,accounts,message:'Meta access saved. Select your ad account and campaign below.'},{headers});
 }catch(e){return Response.json({error:e instanceof MetaCostError?e.message:'Meta access was not confirmed. Check the saved connection or try again.'},{status:503,headers});}
}
