import {after} from 'next/server';
import {db} from '@/lib/stripe-test';
import {makeLeadAuthorized,makeLeadConfig,parseMakeLead,readMakeLeadBody,processMakeLead} from '@/lib/meta-make-intake';
import {processInstantLead} from '@/lib/meta-instant-lead-service';
import {dispatchTextMessage} from '@/lib/text-message-service';
import {dispatchLiveVoice} from '@/lib/live-dispatch-service';
export const runtime='nodejs';
export const maxDuration=60;
const headers={'Cache-Control':'no-store'};
export async function POST(req:Request){
 const config=makeLeadConfig(process.env);
 if(process.env.VERCEL_ENV!=='production'||!config)return Response.json({error:'receiver_unavailable'},{status:503,headers});
 if(!makeLeadAuthorized(req.headers.get('authorization'),config))return new Response(null,{status:401,headers});
 let lead;
 try{lead=parseMakeLead(await readMakeLeadBody(req),config);}catch(error){
  const reason=error instanceof Error?error.message:'';
  const status=reason==='MAKE_SOURCE_MISMATCH'?403:reason==='MAKE_BODY_TOO_LARGE'?413:reason==='MAKE_CONTENT_TYPE_REQUIRED'?415:400;
  return Response.json({error:reason==='MAKE_SUBMISSION_TIME_REQUIRED'?'Map the original submission time as an ISO timestamp with its timezone.':'invalid_lead_payload'},{status,headers});
 }
 try{
  const result=await db<{status:string;duplicate:boolean;outreach:string}>('rpc/icash_make_receive_lead','POST',{p_payload:lead.payload,p_test:lead.test});
  if(result.status==='conflict')return Response.json({error:'lead_receipt_conflict'},{status:409,headers});
  if(!lead.test&&result.outreach==='eligible_for_validation')after(async()=>{
   try{await processMakeLead({db,env:process.env,onAccepted:id=>processInstantLead({db,env:process.env,sms:dispatchTextMessage,voice:dispatchLiveVoice},id)},lead.payload.id);}catch{console.warn('make_lead_intake_pending');}
  });
  return Response.json({received:true,lead_id:lead.payload.id,...result},{headers});
 }catch{return Response.json({error:'storage_unavailable'},{status:503,headers});}
}
