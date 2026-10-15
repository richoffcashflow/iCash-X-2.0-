import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {startCustomerPhoneCall,endCustomerBrowserCall} from '@/lib/customer-phone';
import {browserPhoneIdentity,browserPhoneToken,type BrowserPhoneCredentials} from '@/lib/browser-phone-credentials';
import {z} from 'zod';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const headers={'Cache-Control':'private, no-store'};
async function config(){const [c]=await db<BrowserPhoneCredentials[]>('icash_browser_phone_config?id=eq.1&state=eq.ready&select=*');return c;}
export async function GET(){try{if(process.env.VERCEL_ENV==='preview')return Response.json({ready:false},{headers});await workAccount();const c=await config();return Response.json({ready:!!c&&c.provider_account_sid===process.env.TWILIO_ACCOUNT_SID},{headers});}catch{return Response.json({ready:false},{headers});}}
export async function POST(req:Request){
 if(!allowedOrigin(req))return new Response(null,{status:403,headers});
 try{
  if(process.env.VERCEL_ENV==='preview')throw Error('BROWSER_PHONE_SETUP_REQUIRED');
  const raw=await req.text();if(raw.length>1024)throw Error('INVALID_REQUEST');
  const body=z.discriminatedUnion('action',[
   z.object({action:z.literal('end'),id:z.string().uuid()}).strict(),
   z.object({action:z.enum(['prepare','start']),screeningId:z.string().uuid(),phone:z.string().regex(/^\+1[2-9][0-9]{9}$/),requestKey:z.string().uuid()}).strict(),
  ]).parse(JSON.parse(raw));
  const owner=await workAccount({allowInactiveMembership:body.action==='end',allowUnacknowledged:body.action==='end'});
  if(body.action==='end')return Response.json(await endCustomerBrowserCall(body.id,owner.accountId),{headers});
  const c=await config();if(!c)throw Error('BROWSER_PHONE_SETUP_REQUIRED');
  const identity=browserPhoneIdentity(owner.accountId,owner.userId,body.requestKey);
  // Validate credentials before creating any carrier work; secret never leaves the server.
  const token=browserPhoneToken(c,identity);
  if(body.action==='prepare'){
   const reason=await db<string|null>('rpc/icash_manual_contact_reason','POST',{p_account:owner.accountId,p_screening:body.screeningId,p_phone:body.phone,p_channel:'voice'});
   if(reason)return Response.json({error:reason},{status:409,headers});
   return Response.json({token},{headers});
  }
  const result=await startCustomerPhoneCall({...owner,...body,callbackPhone:'client:'+identity,browser:true});
  return Response.json(result,{status:'error' in result?409:200,headers});
 }catch(e){
  const key=e instanceof Error?e.message:'';
  const message=key==='BROWSER_PHONE_SETUP_REQUIRED'?'Calling is temporarily unavailable. Please try again.':key==='PHONE_SENDER_UNAVAILABLE'?'Your business calling number is unavailable. Please try again.':key==='PHONE_CONTACT_UNAVAILABLE'?'This contact cannot be called.':key==='PHONE_PRICE_UNAVAILABLE'?'Calling prices could not be checked. Please try again.':'Could not connect the call. Please try again.';
  return Response.json({error:message},{status:key==='SIGN_IN_REQUIRED'?401:409,headers});
 }
}
