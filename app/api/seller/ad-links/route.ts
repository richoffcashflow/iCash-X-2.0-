import {randomUUID} from 'node:crypto';
import {dashboardCurrentUser as currentUser} from '@/lib/dashboard-password';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {sellerAdInput,type SellerAdRow} from '@/lib/seller-ad-links';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
async function owner(){return (await currentUser(true))?.id===ownerInboundTarget.ownerUserId;}
export async function GET(){
 try{
  if(!await owner())return Response.json({error:'Platform owner access required.'},{status:403,headers});
  const rows=await db<SellerAdRow[]>('rpc/icash_seller_ad_report','POST',{});
  return Response.json({rows},{headers});
 }catch{return Response.json({error:'Ad reporting is temporarily unavailable. Try refreshing.'},{status:503,headers});}
}
export async function POST(req:Request){
 if(!allowedOrigin(req))return Response.json({error:'Invalid origin'},{status:403,headers});
 try{
  if(!await owner())return Response.json({error:'Platform owner access required.'},{status:403,headers});
  const raw=await req.text();if(raw.length>4000)return Response.json({error:'Invalid ad link.'},{status:400,headers});
  let body:unknown;try{body=JSON.parse(raw);}catch{return Response.json({error:'Invalid ad link.'},{status:400,headers});}
  const parsed=sellerAdInput.safeParse(body);
  if(!parsed.success)return Response.json({error:'Check the ad name, campaign ID, and HTTPS media link.'},{status:400,headers});
  const i=parsed.data;
  if(i.action==='asset'){
   const saved=await db<{slug:string}[]>(`icash_seller_ad_links?slug=eq.${i.slug}`,'PATCH',{asset_url:i.assetUrl});
   if(!saved.length)return Response.json({error:'Ad link not found.'},{status:404,headers});
   return Response.json({saved:true},{headers});
  }
  const slug='hon-'+randomUUID().replaceAll('-','').slice(0,16);
  await db('icash_seller_ad_links','POST',{slug,label:i.label,format:i.format,source:i.source,campaign:i.campaign,asset_url:i.assetUrl});
  return Response.json({saved:true,slug},{status:201,headers});
 }catch{return Response.json({error:'The ad link could not be saved. Try again.'},{status:503,headers});}
}
