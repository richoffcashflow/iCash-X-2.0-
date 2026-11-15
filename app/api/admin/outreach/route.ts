import {dashboardCurrentUser as currentUser} from '@/lib/dashboard-password';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {db} from '@/lib/stripe-test';
import {outreachStatuses,validOwnerOutreach,type OutreachFilters,type OutreachStatus} from '@/lib/owner-outreach';
import {validSellerConversionReport} from '@/lib/seller-conversion-report';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
export async function GET(req:Request){
 try{
  const user=await currentUser(true);
  if(!user)return Response.json({error:'Sign in to view outreach.'},{status:401,headers});
  if(user.id!==ownerInboundTarget.ownerUserId)return Response.json({error:'This report is only available to the platform owner.'},{status:403,headers});
  const params=new URL(req.url).searchParams,days=params.get('days')??'30',include=params.get('includeOwner')??'false',page=params.get('page')??'1',query=(params.get('q')??'').trim(),status=params.get('status')??'all';
  const measure=params.get('measure');
  if(measure!==null&&measure!=='conversion')return Response.json({error:'Choose a valid outreach measure.'},{status:400,headers});
  if(measure==='conversion'){
   if(!['1','7','30'].includes(days)||include!=='false'||page!=='1'||query!==''||status!=='all')return Response.json({error:'Choose a 1, 7 or 30 day customer conversion window.'},{status:400,headers});
   const report=await db<unknown>('rpc/icash_seller_conversion_report','POST',{p_actor:user.id,p_days:Number(days)},req.signal);
   if(!validSellerConversionReport(report,Number(days) as 1|7|30))throw Error('Incomplete seller conversion report');
   return Response.json({report},{headers});
  }
  if(!['1','7','30'].includes(days)||!['true','false'].includes(include)||!/^\d{1,6}$/.test(page)||Number(page)<1||Number(page)>100000||query.length>100||!outreachStatuses.includes(status as OutreachStatus))return Response.json({error:'Choose valid outreach filters and a search of up to 100 characters.'},{status:400,headers});
  const filters:OutreachFilters={days:Number(days) as 1|7|30,includeOwner:include==='true',page:Number(page),query,status:status as OutreachStatus};
  const report=await db<unknown>('rpc/icash_owner_outreach_report','POST',{p_actor:user.id,p_days:filters.days,p_include_owner:filters.includeOwner,p_query:filters.query,p_page:filters.page,p_status:filters.status},req.signal);
  if(!validOwnerOutreach(report,filters))throw Error('Incomplete outreach report');
  return Response.json({report},{headers});
 }catch{
  return Response.json({error:'Outreach activity could not load. Try refreshing in a moment.'},{status:503,headers});
 }
}
