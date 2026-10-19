import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
export const dynamic='force-dynamic';
export async function GET(){
 const headers={'Cache-Control':'private, no-store'};
 try{
  const {accountId}=await workAccount();
  await db('rpc/icash_refresh_opportunity_outcomes','POST',{p_account:accountId});
  const progress=await db('rpc/icash_prospecting_progress','POST',{p_account:accountId});
  return NextResponse.json({progress},{headers});
 }catch{return NextResponse.json({error:'Progress updates are temporarily unavailable.'},{status:503,headers});}
}
