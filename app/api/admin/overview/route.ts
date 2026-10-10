import {currentUser} from '@/lib/account-auth';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {db} from '@/lib/stripe-test';
import {validOwnerOverview,type OverviewFilters} from '@/lib/owner-overview';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
export async function GET(req:Request){
 try{
  const user=await currentUser(true);
  if(!user)return Response.json({error:'Sign in to view the owner overview.'},{status:401,headers});
  if(user.id!==ownerInboundTarget.ownerUserId)return Response.json({error:'This overview is only available to the platform owner.'},{status:403,headers});
  const search=new URL(req.url).searchParams,days=search.get('days')??'30',include=search.get('includeOwner')??'false',page=search.get('page')??'1',query=(search.get('q')??'').trim();
  if(!['1','7','30'].includes(days)||!['true','false'].includes(include)||!/^\d{1,6}$/.test(page)||Number(page)<1||Number(page)>100000||query.length>100){
   return Response.json({error:'Choose a valid period and search of up to 100 characters.'},{status:400,headers});
  }
  const filters:OverviewFilters={days:Number(days) as 1|7|30,includeOwner:include==='true',query,page:Number(page)};
  const report=await db<unknown>('rpc/icash_owner_overview_with_funnel','POST',{p_actor:user.id,p_days:filters.days,p_include_owner:filters.includeOwner,p_query:filters.query,p_page:filters.page},req.signal);
  if(!validOwnerOverview(report,filters)||!report.funnel)throw Error('Incomplete overview');
  return Response.json({report},{headers});
 }catch{
  return Response.json({error:'The overview could not load. Try refreshing in a moment.'},{status:503,headers});
 }
}
