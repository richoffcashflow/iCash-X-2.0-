import {processPurchaseAccessEmails} from '@/lib/purchase-access-email';
import {processSupportOwnerNotifications} from '@/lib/support-owner-notifications';
import {processPurchaseAccessFollowups} from '@/lib/purchase-access-followups';
import {authorizeOutboundBilling} from '@/lib/outbound-billing-service';
import {maintenanceBatch} from '@/lib/maintenance-batch';
import {refreshReliability} from '@/lib/reliability-monitor';
import {db} from '@/lib/stripe-test';
import {pruneUsageLoopObservations} from '@/lib/usage-loop-tracking';
import {GET as outbound} from '@/app/api/billing/outbound/route';
import {GET as recording} from '@/app/api/internal/voice/recording/maintenance/route';
import {GET as ownerRecording} from '@/app/api/internal/voice/owner-recording-test/maintenance/route';
import {GET as reception} from '@/app/api/reception/recorded/maintenance/route';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=180;
export async function GET(request:Request){
 const headers={'Cache-Control':'private, no-store'};
 if(!authorizeOutboundBilling(request,process.env.CRON_SECRET))return Response.json({error:'Unauthorized'},{status:401,headers});
 const pruning=pruneUsageLoopObservations(db);
 const result=await maintenanceBatch({supportCopies:async()=>{const result=await processSupportOwnerNotifications({db,monitorAccess:true});return Response.json(result,{status:result.failed===0?200:503});},purchaseEmail:async()=>{const result=await processPurchaseAccessEmails({db,reconcile:true});return Response.json(result,{status:result.ready&&result.failed===0?200:503});},purchaseFollowups:async()=>{const result=await processPurchaseAccessFollowups({db});return Response.json(result,{status:result.ready&&result.failed===0?200:503});},outbound:()=>outbound(request),recording:()=>recording(request),ownerRecording:()=>ownerRecording(request),reception:()=>reception(request)});
 const monitored=await refreshReliability(db,result.ok);
 await pruning;
 return Response.json({...result,monitored},{status:result.ok&&monitored?200:503,headers});
}
