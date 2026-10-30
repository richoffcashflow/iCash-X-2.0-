import {z} from 'zod';
import {dashboardCurrentUser} from '@/lib/dashboard-password';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {db} from '@/lib/stripe-test';
import {targetingDefinitionSchema} from '@/lib/dealmachine-targeting';
import {targetingReportSchema} from '@/lib/targeting-report';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('set_enabled'),enabled:z.boolean()}).strict(),
 z.object({action:z.literal('set_experiment'),enabled:z.boolean(),definition:targetingDefinitionSchema}).strict(),
]);
export async function GET(req:Request){
 try{
  const user=await dashboardCurrentUser(true);
  if(!user)return Response.json({error:'Sign in.'},{status:401,headers});
  if(user.id!==ownerInboundTarget.ownerUserId)return Response.json({error:'Owner access only.'},{status:403,headers});
  return Response.json({report:targetingReportSchema.parse(await db('rpc/icash_targeting_report','POST',{p_actor:user.id},req.signal))},{headers});
 }catch{return Response.json({error:'Targeting report unavailable.'},{status:503,headers});}
}
export async function POST(req:Request){
 try{
  const origin=req.headers.get('origin');
  if(!origin||origin!==new URL(req.url).origin)return Response.json({error:'Same-origin request required.'},{status:403,headers});
  const user=await dashboardCurrentUser(true);
  if(!user)return Response.json({error:'Sign in.'},{status:401,headers});
  if(user.id!==ownerInboundTarget.ownerUserId)return Response.json({error:'Owner access only.'},{status:403,headers});
  const body=input.parse(await req.json());
  const saved=await db('rpc/icash_configure_targeting','POST',{p_actor:user.id,p_action:body.action,p_definition:'definition' in body?body.definition:null,p_enabled:body.enabled},req.signal);
  return Response.json({saved},{headers});
 }catch{return Response.json({error:'Targeting configuration was not saved. Refresh before retrying.'},{status:409,headers});}
}
