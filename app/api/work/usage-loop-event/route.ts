import {currentUser} from '@/lib/account-auth';
import {accountMode} from '@/lib/account-mode';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {usageLoopEventSchema} from '@/lib/usage-loop-tracking';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
export async function POST(req:Request){
 if(!allowedOrigin(req))return Response.json({recorded:false},{status:403,headers});
 try{
  const user=await currentUser(true);if(!user||accountMode()!=='live')return Response.json({recorded:false},{status:401,headers});
  const body=await req.text();if(body.length>512)return Response.json({recorded:false},{status:400,headers});
  const parsed=usageLoopEventSchema.safeParse(JSON.parse(body));if(!parsed.success)return Response.json({recorded:false},{status:400,headers});
  // The RPC joins the authenticated user to the stored observation's account.
  const event=parsed.data;
  const recorded=await db<boolean>('rpc/icash_record_usage_loop_event','POST',{p_user:user.id,p_observation:event.impressionId,p_event:event.event,p_action:event.action,p_reason:event.reason},AbortSignal.timeout(2000));
  return Response.json({recorded:recorded===true},{headers});
 }catch{return Response.json({recorded:false},{headers});}
}
