import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {validActivityReport,type ActivityDays} from '@/lib/activity-report';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{
  const {accountId}=await workAccount();const params=new URL(req.url).searchParams;
  const period=params.get('days')??'1',timezone=params.get('timezone')??'UTC';
  if(!['1','7','30'].includes(period)||timezone.length>100)return NextResponse.json({error:'Choose Today, 7 days or 30 days.'},{status:400,headers});
  try{new Intl.DateTimeFormat('en-US',{timeZone:timezone});}catch{return NextResponse.json({error:'Invalid timezone.'},{status:400,headers});}
  const days=Number(period) as ActivityDays;
  const report=await db<unknown>('rpc/icash_activity_report','POST',{p_account:accountId,p_days:days,p_timezone:timezone});
  if(!validActivityReport(report,days))throw Error();
  return NextResponse.json(report,{headers});
 }catch{return NextResponse.json({error:'Could not load activity. Please retry.'},{status:503,headers});}
}
