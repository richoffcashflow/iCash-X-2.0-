import {authorizeOutboundBilling} from '@/lib/outbound-billing-service';
import {maintenanceBatch} from '@/lib/maintenance-batch';
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
 const result=await maintenanceBatch({outbound:()=>outbound(request),recording:()=>recording(request),ownerRecording:()=>ownerRecording(request),reception:()=>reception(request)});
 return Response.json(result,{status:result.ok?200:503,headers});
}
