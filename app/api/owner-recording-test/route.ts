import {workAccount} from '@/lib/work-account';
import {ownerRecordingServer} from '@/lib/owner-recording-test-server';
import {ownerRecordingConfirmation} from '@/lib/owner-recording-test';
import {privateHeaders} from '@/lib/required-call-recording';
import {boundedBytes} from '@/lib/required-call-recording-provider';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function GET(){try{if(process.env.ICASH_OWNER_RECORDING_RECEIPTS_READY!=='true')return Response.json({ready:false,reason:'not_released'},{headers:privateHeaders});return Response.json(await ownerRecordingServer().status(await workAccount()),{headers:privateHeaders});}catch{return Response.json({ready:false,reason:'owner_preflight_unavailable'},{status:403,headers:privateHeaders});}}
export async function POST(request:Request){try{if(request.headers.get('origin')!==new URL(request.url).origin)return new Response(null,{status:403});const b=JSON.parse((await boundedBytes(request,512)).toString());if(Object.keys(b).length!==1||b.confirmation!==ownerRecordingConfirmation)return new Response(null,{status:400});if(process.env.ICASH_OWNER_RECORDING_RECEIPTS_READY!=='true')return Response.json({status:'disabled'},{headers:privateHeaders});return Response.json(await ownerRecordingServer().start(await workAccount()),{headers:privateHeaders});}catch{return Response.json({status:'owner_test_held_check_status_before_retry'},{status:503,headers:privateHeaders});}}
