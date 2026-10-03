import {ownerRecordingServer} from '@/lib/owner-recording-test-server';
import {authorizeOutboundBilling} from '@/lib/outbound-billing-service';
import {privateHeaders} from '@/lib/required-call-recording';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function GET(request:Request){if(!authorizeOutboundBilling(request,process.env.CRON_SECRET))return new Response(null,{status:401});try{return Response.json(await ownerRecordingServer().maintain(),{headers:privateHeaders});}catch{return Response.json({status:'owner_recording_maintenance_held'},{status:503,headers:privateHeaders});}}
export const POST=GET;
