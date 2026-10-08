import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {startCustomerPhoneCall,reconcileCustomerPhoneCall,getCustomerPhoneCall,customerPhoneReadiness,customerPhoneAudioAvailable,customerPhoneProvider,customerPhoneRecordingReceipt} from '@/lib/customer-phone';
import {z} from 'zod';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const headers={'Cache-Control':'private, no-store'};
export async function POST(req:Request){
 if(!allowedOrigin(req))return new Response(null,{status:403,headers});
 try{const owner=await workAccount();const raw=await req.text();if(raw.length>1024)throw Error();const body=z.object({screeningId:z.string().uuid(),phone:z.string().regex(/^\+1[2-9][0-9]{9}$/),callbackPhone:z.string().regex(/^\+1[2-9][0-9]{9}$/),requestKey:z.string().uuid()}).strict().parse(JSON.parse(raw));const result=await startCustomerPhoneCall({...owner,...body});return Response.json(result,{status:result.error?409:200,headers});}
 catch(e){const errors:Record<string,string>={PHONE_DIFFERENT_NUMBER_REQUIRED:'Use your own phone number, different from the seller’s number.',PHONE_CONTACT_UNAVAILABLE:'This contact cannot be called.',PHONE_SENDER_UNAVAILABLE:'Open the text conversation first to connect the business number.',PHONE_PRICE_UNAVAILABLE:'Current calling prices could not be verified. No call was started.',PHONE_PROVIDER_UNAVAILABLE:'The calling provider could not be reached. No call was started.',PHONE_SETUP_REQUIRED:'Business calling setup is unavailable.'};return Response.json({error:errors[e instanceof Error?e.message:'']??'The call could not start. Your credits, budget or contact status may need attention.'},{status:409,headers});}
}
export async function GET(req:Request){try{
 const owner=await workAccount(),params=new URL(req.url).searchParams;
 if(params.has('screeningId'))return Response.json(await customerPhoneReadiness(owner.accountId,z.string().uuid().parse(params.get('screeningId'))),{headers});
 const id=z.string().uuid().parse(params.get('id')),row=await getCustomerPhoneCall(id,owner.accountId);
 if(!row)return new Response(null,{status:404,headers});
 if(params.get('audio')==='1'){
  if(!customerPhoneAudioAvailable(row))return new Response(null,{status:404,headers});
  const p=customerPhoneProvider();if(p.account!==row.provider_account_sid)return new Response(null,{status:404,headers});
  const recording=customerPhoneRecordingReceipt(row,await p.recordings.getRecording(row.recording_sid!));
  if(!recording||recording.status!=='completed')return new Response(null,{status:404,headers});
  return new Response(new Uint8Array(await p.recordings.media(row.recording_sid!)),{headers:{...headers,'Content-Type':'audio/mpeg','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
 }
 const latest=await reconcileCustomerPhoneCall(row).catch(()=>row);
 return Response.json({id:latest.id,status:latest.state,ended:!!latest.ended_at,costPending:!!latest.ended_at&&!latest.settled_at,audioAvailable:customerPhoneAudioAvailable(latest)},{headers});
 }catch{return new Response(null,{status:503,headers});}}
