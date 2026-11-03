import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {opportunityPeriod,readOpportunityProgress} from '@/lib/opportunity-progress-read';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{
  const {accountId}=await workAccount({signal:req.signal});
  const period=opportunityPeriod(new URL(req.url).searchParams);
  if(!period)return NextResponse.json({error:'Choose Today, 7 days or 30 days and a valid timezone.'},{status:400,headers});
  const progress=await readOpportunityProgress(accountId,period.days,period.timezone,req.signal);
  return NextResponse.json({progress},{headers});
 }catch{return NextResponse.json({error:'Progress updates are temporarily unavailable.'},{status:503,headers});}
}
