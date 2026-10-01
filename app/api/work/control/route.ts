import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {stopDaily,type DailyPlan} from '@/lib/daily-billing';
import {fundingMode} from '@/lib/funding-policy';
import {z} from 'zod';
const input=z.object({action:z.enum(['pause','resume','takeover','return_to_bot']),screeningId:z.string().uuid().optional()}).strict();
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 try{const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>512)throw new Error();const i=input.parse(JSON.parse(raw));
 if(['resume','return_to_bot'].includes(i.action)&&process.env.ICASH_LIVE_WORK_READY!=='true')return NextResponse.json({error:'Live work is not ready. Funding does not start or unlock it.'},{status:503});
 if(i.action==='pause'){
  const mode=fundingMode();
  await db('rpc/icash_pause_work_and_billing','POST',{p_user:userId,p_account:accountId,p_mode:mode});
  const retry=()=>NextResponse.json({paused:true,billingStopRequested:true,error:'Your bot is paused. Daily billing cancellation is still retrying.'},{status:503});
  try{const plans=await db<DailyPlan[]>(`icash_daily_plans?account_id=eq.${accountId}&mode=eq.${mode}&state=neq.stopped&select=*`);let failed=false;for(const p of plans){try{await stopDaily(p);}catch{failed=true;}}if(failed)return retry();}catch{return retry();}
 }else await db('rpc/icash_set_work_control','POST',{p_user:userId,p_account:accountId,p_action:i.action,p_screening:i.screeningId??null});
 return NextResponse.json({saved:true});}catch{return NextResponse.json({error:'Could not confirm the full update. Your bot may be paused while billing cancellation retries. Please retry.'},{status:400});}
}
