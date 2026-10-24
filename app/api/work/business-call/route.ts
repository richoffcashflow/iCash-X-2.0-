import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {reconcileCustomerPhoneCall,getCustomerPhoneCall,customerPhoneReadiness,customerPhoneAudioAvailable,customerPhoneProvider,customerPhoneRecordingReceipt} from '@/lib/customer-phone';
import {z} from 'zod';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const headers={'Cache-Control':'private, no-store'};
// Preserve historical receipts and audio below; new calls use browser-call only.
export async function POST(req:Request){
 if(!allowedOrigin(req))return new Response(null,{status:403,headers});
 try{await workAccount();return Response.json({error:'Use the Call button in iCash X.'},{status:410,headers});}
 catch{return Response.json({error:'Sign in to call.'},{status:401,headers});}
}
export async function GET(req:Request){try{
 const owner=await workAccount(),params=new URL(req.url).searchParams;
 if(params.has('screeningId'))return Response.json(await customerPhoneReadiness(owner.accountId,z.guid().parse(params.get('screeningId'))),{headers});
 const id=z.guid().parse(params.get('id')),row=await getCustomerPhoneCall(id,owner.accountId);
 if(!row)return new Response(null,{status:404,headers});
 if(params.get('audio')==='1'){
  if(!customerPhoneAudioAvailable(row))return new Response(null,{status:404,headers});
  const p=customerPhoneProvider();if(p.account!==row.provider_account_sid)return new Response(null,{status:404,headers});
  const recording=customerPhoneRecordingReceipt(row,await p.recordings.getRecording(row.recording_sid!));
  if(!recording||recording.status!=='completed')return new Response(null,{status:404,headers});
  return new Response(new Uint8Array(await p.recordings.media(row.recording_sid!)),{headers:{...headers,'Content-Type':'audio/mpeg','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
 }
 const latest=await reconcileCustomerPhoneCall(row).catch(()=>row);
 return Response.json({id:latest.id,status:latest.state,parentSid:latest.parent_sid,connected:!!latest.recipient_answered_at,ended:!!latest.ended_at,costPending:!!latest.ended_at&&!latest.settled_at,audioAvailable:customerPhoneAudioAvailable(latest)},{headers});
 }catch{return new Response(null,{status:503,headers});}}
