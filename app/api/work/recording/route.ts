import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {recordingPresentation} from '@/lib/required-call-recording-receipt';
import {uuid,privateHeaders} from '@/lib/required-call-recording';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const {accountId}=await workAccount();const id=new URL(request.url).searchParams.get('conversationId');if(!uuid(id))return new Response(null,{status:400,headers:privateHeaders});
 // Legacy deployment need not have the new table installed. Enable receipts only after schema review.
 if(process.env.ICASH_RECORDING_RECEIPTS_READY!=='true')return Response.json({status:'not_recorded'},{headers:privateHeaders});
 const result=await recordingPresentation(db,accountId,id);return result?Response.json(result,{headers:privateHeaders}):new Response(null,{status:404,headers:privateHeaders});
 }catch{return Response.json({error:'Recording receipt unavailable.'},{status:503,headers:privateHeaders});}}
