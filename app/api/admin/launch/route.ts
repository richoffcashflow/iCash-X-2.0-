import {z} from 'zod';
import {requireDashboardPassword} from '@/lib/dashboard-password';
import {db} from '@/lib/stripe-test';
import {launchSlug,parseLaunchCsv,prepareLaunchImport} from '@/lib/legacy-launch';
import {webinarOwner,webinarOrigin,webinarBody,webinarHeaders,webinarError,WebinarError} from '@/lib/webinar-server';
export const dynamic='force-dynamic';
async function requireLaunchOwner(){const owner=await webinarOwner();await requireDashboardPassword(owner.id);}
const step=z.object({id:z.string().regex(/^[a-z0-9-]{1,50}$/),day:z.number().int().min(0).max(29),hour:z.number().int().min(0).max(23),channel:z.enum(['email','sms']),subject:z.string().max(160),body:z.string().min(20).max(6000)}).strict();
async function campaign(){const [l]=await db<{id:string;revision:number}[]>(`icash_legacy_launches?slug=eq.${launchSlug}&select=id,revision&limit=1`);if(!l)throw new WebinarError(503,'The launch is being prepared. Please refresh shortly.');return l;}
export async function GET(req:Request){try{
 await requireLaunchOwner();const l=await campaign(),params=new URL(req.url).searchParams;
 const q=z.string().max(200).parse(params.get('q')||''),page=z.coerce.number().int().min(1).max(10000).parse(params.get('page')||1);
 return Response.json(await db('rpc/icash_legacy_report','POST',{p_launch:l.id,p_query:q,p_page:page}),{headers:webinarHeaders});
}catch(e){return webinarError(e);}}
export async function POST(req:Request){try{
 webinarOrigin(req);await requireLaunchOwner();const l=await campaign(),raw=await webinarBody(req,12_100_000);
 const i=z.discriminatedUnion('action',[
  z.object({action:z.literal('import'),source:z.enum(['whop','highlevel']),csv:z.string().max(12_000_000)}).strict(),
  z.object({action:z.literal('save'),revision:z.number().int().positive(),steps:z.array(step).min(1).max(60)}).strict(),
  z.object({action:z.literal('pause')}).strict(),
  z.object({action:z.literal('link'),contactId:z.guid()}).strict()
 ]).parse(raw);
 if(i.action==='pause'){await db(`icash_legacy_launches?id=eq.${l.id}`,'PATCH',{state:'paused',updated_at:new Date().toISOString()});return Response.json({saved:true},{headers:webinarHeaders});}
 if(i.action==='link'){
  const [c]=await db<{token:string}[]>(`icash_legacy_contacts?id=eq.${i.contactId}&launch_id=eq.${l.id}&select=token&limit=1`);
  if(!c)throw new WebinarError(404,'Customer not found.');return Response.json({path:`/launch/${c.token}/join`},{headers:webinarHeaders});
 }
 if(i.action==='save'){
  if(new Set(i.steps.map(s=>s.id)).size!==i.steps.length)throw new WebinarError(400,'Each message needs its own name.');
  const revision=await db<number>('rpc/icash_legacy_save','POST',{p_id:l.id,p_revision:i.revision,p_steps:i.steps});return Response.json({saved:true,revision},{headers:webinarHeaders});
 }
 const imported=prepareLaunchImport(parseLaunchCsv(i.csv),i.source);
 if(!imported.contacts.length)throw new WebinarError(400,'This file has no customer emails or phone numbers. Export the customer contacts, not subaccount activity.');
 for(let n=0;n<imported.contacts.length;n+=250)await db('rpc/icash_legacy_import','POST',{p_launch:l.id,p_contacts:imported.contacts.slice(n,n+250)});
 return Response.json({imported:imported.contacts.length,duplicates:imported.duplicates,missingContact:imported.missingContact,nonBuyers:imported.nonBuyers},{headers:webinarHeaders});
}catch(e){if(e instanceof z.ZodError)return Response.json({error:'Check the file, message and day numbers.'},{status:400,headers:webinarHeaders});return webinarError(e);}}
