import {db} from '@/lib/stripe-test';
import {boundedBytes,createRecordingProviders} from '@/lib/required-call-recording-provider';
import {getRecordingRow,recordingTransition,canonicalCall} from '@/lib/required-call-recording-service';
import {settleRecordingGateOnly} from '@/lib/required-call-recording-billing';
import {recordingBaseUrl,verifiedTwilioForm,uuid,sid,privateHeaders} from '@/lib/required-call-recording';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(request:Request){
 try{
  const u=new URL(request.url),id=u.searchParams.get('id');if(!uuid(id)||u.searchParams.size!==1)return new Response(null,{status:400});
  const form=verifiedTwilioForm((await boundedBytes(request,16384)).toString('utf8'),request.headers.get('x-twilio-signature'),process.env.TWILIO_AUTH_TOKEN??'',recordingBaseUrl+'/terminal?id='+id);
  let row=await getRecordingRow(db,id);
  if(!form||!row||form.get('AccountSid')!==row.provider_account_sid||!sid(form.get('CallSid'),'CA'))return new Response(null,{status:401});
  const provider=createRecordingProviders(process.env),call=await provider.getCall(form.get('CallSid')!);
  if(!canonicalCall(row,call,Date.now(),false,row.call_sid===null)||!['completed','busy','failed','no-answer','canceled'].includes(String(call.status)))return new Response(null,{status:409});
  if(!row.call_sid)row=await recordingTransition(db,row,'bind_call',{callSid:call.sid,providerAccountSid:call.account_sid,fromPhone:call.from,toPhone:call.to});
  if(!row)return new Response(null,{status:409});
  if(!row.start_claimed_at&&row.state==='consent_pending')row=await recordingTransition(db,row,'fail',{reason:'call_ended_before_recording'});
  if(row&&!row.start_claimed_at)await settleRecordingGateOnly(db,provider,row);
  return new Response(null,{status:204,headers:privateHeaders});
 }catch{return new Response(null,{status:503,headers:privateHeaders});}
}
