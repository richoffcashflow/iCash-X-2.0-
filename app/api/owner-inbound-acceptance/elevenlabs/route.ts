import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {readOwnerElevenLabsReadiness,OwnerElevenLabsReadinessError} from '@/lib/owner-elevenlabs-readiness';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export async function GET(request:Request){
 try{
  const owner=await workAccount();
  if(owner.accountId!==ownerInboundTarget.accountId||owner.userId!==ownerInboundTarget.ownerUserId)return NextResponse.json({status:'owner_required'},{status:403,headers});
  if(new URL(request.url).search)return NextResponse.json({status:'fixed_target_only'},{status:400,headers});
  return NextResponse.json(await readOwnerElevenLabsReadiness({ELEVENLABS_API_KEY:process.env.ELEVENLABS_API_KEY,ELEVENLABS_INBOUND_WEBHOOK_SECRET:process.env.ELEVENLABS_INBOUND_WEBHOOK_SECRET}),{headers});
 }catch(error){
  const signIn=error instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(error.message);
  return NextResponse.json({status:signIn?'sign_in_required':error instanceof OwnerElevenLabsReadinessError?error.code:'readiness_unavailable'},{status:signIn?401:503,headers});
 }
}
