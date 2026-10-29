import {processSupportCustomerNotifications} from '@/lib/support-customer-notifications';
import {refreshVoiceCapacity,readVoiceCapacityProvider} from '@/lib/voice-capacity';
import {applyApprovedProVoiceCapacity} from '@/lib/approved-pro-voice-capacity';
import {refreshInventoryGeographyBatch} from '@/lib/inventory-geographies';
import {readRecordingReview} from '@/lib/required-call-recording';
import {processPurchaseAccessEmails} from '@/lib/purchase-access-email';
import {recoverAccessHelpReplies} from '@/lib/access-help-replies';
import {processSupportOwnerNotifications} from '@/lib/support-owner-notifications';
import {processPurchaseAccessFollowups} from '@/lib/purchase-access-followups';
import {authorizeOutboundBilling} from '@/lib/outbound-billing-service';
import {maintenanceBatch} from '@/lib/maintenance-batch';
import {refreshReliability} from '@/lib/reliability-monitor';
import {syncResearchExclusions} from '@/lib/research-exclusions';
import {recoverOwnerActiveExports} from '@/lib/owner-active-export';
import {recoverOwnerExportCapacity} from '@/lib/owner-export-capacity-recovery';
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
 const capacity=(async()=>{
  const change=await applyApprovedProVoiceCapacity(db).catch(error=>{console.error('Approved Pro voice capacity unavailable',error instanceof Error&&/^PRO_VOICE_CAPACITY_[A-Z0-9_]+$/.test(error.message)?error.message:'verification_unavailable');return {status:'verification_unavailable'};});
  // Fresh capacity reads still run when the one-time change is held.
  const verified=await refreshVoiceCapacity(db,readVoiceCapacityProvider,readRecordingReview(process.env.RECORDED_OUTBOUND_REVIEW_JSON));
  return {...verified,change};
 })().catch(error=>{console.error('Voice capacity verification unavailable',error instanceof Error&&/^VOICE_CAPACITY_[A-Z0-9_]+$/.test(error.message)?error.message:'read_unavailable');return {status:'verification_unavailable'};});
 const inventory=refreshInventoryGeographyBatch(db).catch(()=>({status:'metadata_unavailable'}));
 const researchExclusions=syncResearchExclusions(db).catch(()=>({status:'sync_unavailable'}));
 const ownerExports=recoverOwnerActiveExports(db).catch(()=>({status:'export_receipt_held'}));
 const ownerExportCapacity=recoverOwnerExportCapacity(db).catch(()=>({status:'capacity_review_held'}));
 const pruning=pruneUsageLoopObservations(db);
 const result=await maintenanceBatch({supportCustomerEmail:async()=>{const result=await processSupportCustomerNotifications({db});return Response.json(result,{status:result.failed===0?200:503});},supportCopies:async()=>{const closed=await db('rpc/icash_close_inactive_support','POST',{}).catch(()=>null);const recovered=await recoverAccessHelpReplies(db).catch(()=>null);const result=await processSupportOwnerNotifications({db,monitorAccess:true});return Response.json({...result,recovered,closed},{status:result.failed===0&&recovered!==null&&closed!==null?200:503});},purchaseEmail:async()=>{const result=await processPurchaseAccessEmails({db,reconcile:true});return Response.json(result,{status:result.ready&&result.failed===0?200:503});},purchaseFollowups:async()=>{const result=await processPurchaseAccessFollowups({db});return Response.json(result,{status:result.ready&&result.failed===0?200:503});},outbound:()=>outbound(request),recording:()=>recording(request),ownerRecording:()=>ownerRecording(request),reception:()=>reception(request)});
 const monitored=await refreshReliability(db,result.ok);
 await pruning;
 return Response.json({...result,monitored,capacity:await capacity,inventory:await inventory,researchExclusions:await researchExclusions,ownerExports:await ownerExports,ownerExportCapacity:await ownerExportCapacity},{status:result.ok&&monitored?200:503,headers});
}
