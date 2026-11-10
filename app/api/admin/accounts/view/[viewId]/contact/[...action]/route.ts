import {z} from 'zod';
import {allowedOrigin} from '@/lib/funding-policy';
import {ownerContactAccess,ownerContactAction,ownerContactEndAccess} from '@/lib/owner-contact-access';
import {ownerViewFailure,ownerViewHeaders} from '@/lib/owner-account-access';
import {messagesGET,messagesPOST,availabilityGET,textContactGET,textContactPOST,manualCallGET,browserCallGET,browserCallPOST,businessCallGET} from '@/lib/owner-contact-handlers';
export const dynamic='force-dynamic';export const runtime='nodejs';export const maxDuration=60;
type Context={params:Promise<{viewId:string;action:string[]}>};
const reads={messages:messagesGET,'messages/availability':availabilityGET,'text-contact':textContactGET,'manual-call':manualCallGET,'browser-call':browserCallGET,'business-call':businessCallGET};
const privateResponse=(response:Response)=>{for(const [name,value] of Object.entries(ownerViewHeaders))response.headers.set(name,value);return response;};
const writes={messages:messagesPOST,'text-contact':textContactPOST,'browser-call':browserCallPOST};
export async function GET(req:Request,context:Context){try{
 const {viewId,action}=await context.params,key=action.join('/');
 if(!Object.hasOwn(reads,key))return new Response(null,{status:404,headers:ownerViewHeaders});
 const access=await ownerContactAccess(z.guid().parse(viewId),!['messages','text-contact','business-call'].includes(key));
 return privateResponse(await reads[key as keyof typeof reads](req,access));
 }catch(e){return ownerViewFailure(e);}}
export async function POST(req:Request,context:Context){
 if(!allowedOrigin(req))return new Response(null,{status:403,headers:ownerViewHeaders});
 try{
  const {viewId,action}=await context.params,key=action.join('/');
  if(key!=='control'&&!Object.hasOwn(writes,key))return new Response(null,{status:404,headers:ownerViewHeaders});
  const parsedView=z.guid().parse(viewId);
  let end:{success:boolean;data?:{action:'end';id:string}}|null=null;
  if(key==='browser-call'){const raw=await req.clone().text();if(raw.length>1024)throw Error('Invalid call');end=z.object({action:z.literal('end'),id:z.guid()}).strict().safeParse(JSON.parse(raw));}
  const access=end?.success?await ownerContactEndAccess(parsedView,end.data!.id):await ownerContactAccess(parsedView);
  if(key==='control'){
   const raw=await req.text();if(raw.length>256)throw Error('Invalid control');
   const body=z.object({action:z.literal('return_to_bot'),screeningId:z.guid()}).strict().parse(JSON.parse(raw));
   await ownerContactAction(access,'return_to_bot',{p_screening:body.screeningId});
   return Response.json({saved:true},{headers:ownerViewHeaders});
  }
  return privateResponse(await writes[key as keyof typeof writes](req,access));
 }catch(e){return ownerViewFailure(e);}
}
