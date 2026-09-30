import {NextResponse} from 'next/server';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin,fundingMode} from '@/lib/funding-policy';
import {stopDaily,type DailyPlan} from '@/lib/daily-billing';
import {supportId,hashCancelNonce,signCancelToken,verifyCancelToken} from '@/lib/support-policy';
export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store'};
const input=z.discriminatedUnion('action',[z.object({action:z.literal('prepare'),requestId:supportId.optional()}).strict(),z.object({action:z.literal('confirm'),token:z.string().max(1500),acknowledged:z.literal(true)}).strict()]);
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>3000)throw Error('INVALID_REQUEST');const i=input.parse(JSON.parse(raw));const mode=fundingMode();if(!mode)return NextResponse.json({error:'Billing mode could not be verified. No cancellation was attempted.'},{status:503,headers});
  const secret=process.env.ICASH_SUPPORT_CANCEL_SECRET??'';if(secret.length<32)return NextResponse.json({error:'Secure cancellation confirmation is not available here yet. Use Pause bot in your workspace to stop work and daily renewals.'},{status:503,headers});
  if(i.action==='prepare'){
   const nonce=randomBytes(32).toString('hex');const requestId=await db<string>('rpc/icash_support_prepare_cancel','POST',{p_account:accountId,p_user:userId,p_mode:mode,p_request:i.requestId??null,p_nonce:hashCancelNonce(nonce)});
   const expiresAt=Date.now()+10*60_000;const token=signCancelToken({requestId,accountId,userId,mode,nonce,expiresAt},secret);
   return NextResponse.json({token,expiresAt,summary:`Pause new bot work and stop future ${mode==='live'?'live':'test'} daily renewals in this environment. Work already in progress may still finish and incur previously authorized costs. Existing credit and account records stay in place. This does not delete your account or request a refund.`},{headers});
  }
  const claims=verifyCancelToken(i.token,secret,accountId,userId);if(claims.mode!==mode)throw Error('CONFIRMATION_MODE_MISMATCH');
  const claimed=await db<boolean>('rpc/icash_support_claim_cancel','POST',{p_account:accountId,p_user:userId,p_mode:mode,p_request:claims.requestId,p_nonce:hashCancelNonce(claims.nonce)});
  if(!claimed)return NextResponse.json({error:'This confirmation expired or was already used. Refresh to check the result before trying again.'},{status:409,headers});
  try{
   const plans=await db<DailyPlan[]>(`icash_daily_plans?account_id=eq.${accountId}&mode=eq.${mode}&state=neq.stopped&select=*`);
   for(const plan of plans){if(plan.mode!==mode)throw Error('PLAN_MODE_MISMATCH');await stopDaily(plan);}
   const [account]=await db<{bot_paused:boolean}[]>(`icash_accounts?id=eq.${accountId}&select=bot_paused`);
   const remaining=await db<{id:string}[]>(`icash_daily_plans?account_id=eq.${accountId}&mode=eq.${mode}&state=neq.stopped&select=id&limit=1`);
   if(!account?.bot_paused||remaining.length)throw Error('CANCELLATION_UNCONFIRMED');
   const result=`Your bot is paused and future ${mode==='live'?'live':'test'} daily renewals in this environment are stopped. Previously authorized in-progress work may still settle. Your account and credit remain available.`;
   await db(`icash_support_cancel_requests?id=eq.${claims.requestId}&account_id=eq.${accountId}&mode=eq.${mode}`,'PATCH',{state:'cancelled',result,updated_at:new Date().toISOString()});
   return NextResponse.json({confirmed:true,message:result},{headers});
  }catch{
   const result=`Your pause and ${mode==='live'?'live':'test'} daily-renewal stop request is saved. Provider cancellation in this environment is not yet confirmed; support review is needed. Do not assume future renewals have stopped until confirmed.`;
   await db(`icash_support_cancel_requests?id=eq.${claims.requestId}&account_id=eq.${accountId}&mode=eq.${mode}`,'PATCH',{state:'needs_review',result,updated_at:new Date().toISOString()});
   return NextResponse.json({confirmed:false,message:result},{status:202,headers});
  }
 }catch(e){const auth=e instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(e.message);return NextResponse.json({error:auth?'Sign in to confirm cancellation.':'Cancellation could not be confirmed. Refresh to check its status.'},{status:auth?401:400,headers});}
}
