import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {readOwnerForwarding,OwnerForwardingError} from '@/lib/owner-forwarding-readiness';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// Existing owner auth can use two 15-second requests plus a 15-second account
// read; allow those bounded checks and the adapter's eight-second GET to finish.
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export async function GET(request:Request){
 try{
  const owner=await workAccount();
  if(owner.accountId!==ownerInboundTarget.accountId||owner.userId!==ownerInboundTarget.ownerUserId)return NextResponse.json({status:'owner_required'},{status:403,headers});
  if(new URL(request.url).search)return NextResponse.json({status:'fixed_source_only'},{status:400,headers});
  return NextResponse.json(await readOwnerForwarding({CONTIGUITY_API_KEY:process.env.CONTIGUITY_API_KEY,CONTIGUITY_FROM:process.env.CONTIGUITY_FROM}),{headers});
 }catch(error){
  const signIn=error instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(error.message);
  return NextResponse.json({status:signIn?'sign_in_required':error instanceof OwnerForwardingError?error.code:'readiness_unavailable'},{status:signIn?401:503,headers});
 }
}
