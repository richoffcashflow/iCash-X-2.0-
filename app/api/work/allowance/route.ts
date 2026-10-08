import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
import {validSpendingAllowance,allowanceIncreaseConfirmed} from '@/lib/spending-allowance';
const headers={'Cache-Control':'private, no-store'};
export const dynamic='force-dynamic';
function failure(error:unknown,stage:string){
 const message=error instanceof Error?error.message:'';
 const known:Record<string,{status:number;error:string}>={
  SIGN_IN_REQUIRED:{status:401,error:'Your session expired. Sign in again, then confirm today’s allowance.'},
  ACCOUNT_REQUIRED:{status:409,error:'Your workspace account could not be found. Sign in again or contact support.'},
  SUBSCRIPTION_REQUIRED:{status:403,error:'Restore your subscription before increasing today’s allowance.'},
  INVALID_ALLOWANCE_INPUT:{status:400,error:'Enter an amount within your available credits.'},
  'Too many attempts. Please wait and try again.':{status:429,error:'Too many attempts. Please wait a few minutes, then try again.'},
 };
 const result=known[message]??{status:503,error:'Could not confirm today’s allowance. Refresh to check whether the increase saved.'};
 console.warn('spending_allowance_failed',{stage,status:result.status,reason:known[message]?message:'SAVE_OR_READ_UNCONFIRMED'});
 return NextResponse.json({error:result.error},{status:result.status,headers});
}
export async function GET(){
 try{
  const {accountId}=await workAccount();const result=await db('rpc/icash_daily_allowance','POST',{p_account:accountId});
  if(!validSpendingAllowance(result))throw Error('ALLOWANCE_READ_UNCONFIRMED');
  return NextResponse.json(result,{headers});
 }catch(error){return failure(error,'read');}
}
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 let stage='account';
 try{
  const {accountId,userId}=await workAccount();stage='rate_limit';await limitRequest(req,'daily-allowance',accountId,20,600);
  stage='input';const raw=await req.text();if(raw.length>300)throw Error('INVALID_ALLOWANCE_INPUT');
  const i=z.object({day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),extraTotalCents:z.number().int().nonnegative().max(10000000)}).strict().parse(JSON.parse(raw));
  stage='save';const result=await db('rpc/icash_allow_more_today','POST',{p_user:userId,p_account:accountId,p_day:i.day,p_extra_total:i.extraTotalCents});
  if(!allowanceIncreaseConfirmed(result,i))throw Error('ALLOWANCE_SAVE_UNCONFIRMED');
  return NextResponse.json(result,{headers});
 }catch(error){return failure(stage==='input'?Error('INVALID_ALLOWANCE_INPUT'):error,stage);}
}
