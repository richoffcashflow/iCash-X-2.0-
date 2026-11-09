import {retryVolumeDeferredText} from '@/lib/text-message-service';
import {recoverTextDeliveryReceipts} from '@/lib/text-delivery-recovery';
import {processSupportCustomerNotifications} from '@/lib/support-customer-notifications';
import {refreshVoiceCapacity,readVoiceCapacityProvider} from '@/lib/voice-capacity';
import {recoverVoiceConfiguration} from '@/lib/voice-configuration-recovery';
import {applyApprovedProVoiceCapacity} from '@/lib/approved-pro-voice-capacity';
import {applyApprovedEightyPercentVoiceCapacity} from '@/lib/approved-eighty-percent-voice-capacity';
import {refreshInventoryGeographyBatch} from '@/lib/inventory-geographies';
import {readRecordingReview} from '@/lib/required-call-recording';
import {processPurchaseAccessEmails} from '@/lib/purchase-access-email';
import {recoverAccessHelpReplies} from '@/lib/access-help-replies';
import {processSupportOwnerNotifications} from '@/lib/support-owner-notifications';
import {processPurchaseAccessFollowups} from '@/lib/purchase-access-followups';
import {authorizeOutboundBilling} from '@/lib/outbound-billing-service';
import {maintenanceBatch} from '@/lib/maintenance-batch';
import {refreshReliability} from '@/lib/reliability-monitor';
import {drainResearchExclusions} from '@/lib/research-exclusions';
import {recoverOwnerActiveExports} from '@/lib/owner-active-export';
import {recoverOwnerExportCapacity} from '@/lib/owner-export-capacity-recovery';
import {cleanupOwnerPreflight} from '@/lib/owner-export-preflight';
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
 let capacityOk=true;
 const capacity=(async()=>{
  const change=await applyApprovedProVoiceCapacity(db).catch(error=>{capacityOk=false;console.error('Approved Pro voice capacity unavailable',error instanceof Error&&/^PRO_VOICE_CAPACITY_[A-Z0-9_]+$/.test(error.message)?error.message:'verification_unavailable');return {status:'verification_unavailable'};});
  const eightyPercentChange=await applyApprovedEightyPercentVoiceCapacity(db).catch(error=>{capacityOk=false;console.error('Approved eighty-percent voice capacity unavailable',error instanceof Error&&/^EIGHTY_VOICE_CAPACITY_[A-Z0-9_]+$/.test(error.message)?error.message:'verification_unavailable');return {status:'verification_unavailable'};});
  // Fresh capacity reads still run when the one-time change is held.
  let recovery:{status:string;requeued:number}={status:'not_checked',requeued:0};
  const verified=await refreshVoiceCapacity(db,readVoiceCapacityProvider,readRecordingReview(process.env.RECORDED_OUTBOUND_REVIEW_JSON),async agent=>{
   recovery=await recoverVoiceConfiguration(db,agent).catch(()=>({status:'recovery_unavailable',requeued:0}));
   if(recovery.status==='recovery_unavailable'){capacityOk=false;console.error('Voice configuration recovery unavailable');}
  });
  return {...verified,change,eightyPercentChange,recovery};
 })().catch(error=>{capacityOk=false;console.error('Voice capacity verification unavailable',error instanceof Error&&/^VOICE_CAPACITY_[A-Z0-9_]+$/.test(error.message)?error.message:'read_unavailable');return {status:'verification_unavailable'};});
 const inventory=refreshInventoryGeographyBatch(db).catch(()=>({status:'metadata_unavailable'}));
 const researchExclusions=drainResearchExclusions(db).catch(()=>({status:'sync_unavailable'}));
 const ownerExports=recoverOwnerActiveExports(db).catch(()=>({status:'export_receipt_held'}));
 const ownerExportCapacity=recoverOwnerExportCapacity(db).catch(()=>({status:'capacity_review_held'}));
 const ownerPreflightCleanup=cleanupOwnerPreflight(db).catch(()=>({status:'cleanup_pending'}));
 const pruning=pruneUsageLoopObservations(db);
 const result=await maintenanceBatch({capacity:async()=>{await capacity;return new Response(null,{status:capacityOk?200:503});},senderVolume:async()=>Response.json(await retryVolumeDeferredText()),textReceipts:async()=>{const result=await recoverTextDeliveryReceipts(db);return Response.json(result,{status:result.errors===0&&['idle','checked'].includes(result.status)?200:503});},supportCustomerEmail:async()=>{const result=await processSupportCustomerNotifications({db});return Response.json(result,{status:result.failed===0?200:503});},supportCopies:async()=>{const closed=await db('rpc/icash_close_inactive_support','POST',{}).catch(()=>null);const recovered=await recoverAccessHelpReplies(db).catch(()=>null);const result=await processSupportOwnerNotifications({db,monitorAccess:true});return Response.json({...result,recovered,closed},{status:result.failed===0&&recovered!==null&&closed!==null?200:503});},purchaseEmail:async()=>{const result=await processPurchaseAccessEmails({db,reconcile:true});return Response.json(result,{status:result.ready&&result.failed===0?200:503});},purchaseFollowups:async()=>{const result=await processPurchaseAccessFollowups({db});return Response.json(result,{status:result.ready&&result.failed===0?200:503});},outbound:()=>outbound(request),recording:()=>recording(request),ownerRecording:()=>ownerRecording(request),reception:()=>reception(request)});
 const monitored=await refreshReliability(db,result.ok);
 await pruning;
 return Response.json({...result,monitored,capacity:await capacity,inventory:await inventory,researchExclusions:await researchExclusions,ownerExports:await ownerExports,ownerExportCapacity:await ownerExportCapacity,ownerPreflightCleanup:await ownerPreflightCleanup},{status:result.ok&&monitored?200:503,headers});
}
