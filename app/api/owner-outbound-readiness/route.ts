import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/account-auth';
import {db} from '@/lib/stripe-test';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {readOutboundReadiness,validOutboundTemplate,type OutboundTemplate} from '@/lib/owner-outbound-readiness';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export async function GET(request:Request){
 try{
  if(new URL(request.url).search||request.body!==null)return NextResponse.json({status:'fixed_target_only'},{status:400,headers});
  const user=await currentUser(false);
  if(!user)return NextResponse.json({status:'sign_in_required'},{status:401,headers});
  if(user.id!==ownerInboundTarget.ownerUserId)return NextResponse.json({status:'owner_required'},{status:403,headers});
  const [account]=await db<{id:string}[]>(`icash_accounts?id=eq.${ownerInboundTarget.accountId}&owner_user_id=eq.${ownerInboundTarget.ownerUserId}&select=id`);
  if(!account)return NextResponse.json({status:'owner_required'},{status:403,headers});
  const [template]=await db<OutboundTemplate[]>('icash_voice_production_template?id=eq.1&select=id,enabled,agent_id,phone_number_id,agent_config_hash,required_tool_ids,max_duration_seconds,reviewed_at,reviewed_until');
  if(!validOutboundTemplate(template))return NextResponse.json({status:'template_review_required'},{status:409,headers});
  return NextResponse.json(await readOutboundReadiness(template,process.env.ELEVENLABS_API_KEY,process.env.CONTIGUITY_FROM),{headers});
 }catch{return NextResponse.json({status:'readiness_unavailable'},{status:503,headers});}
}
