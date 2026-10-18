import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {instantLeadsEnabled} from '@/lib/meta-instant-lead-service';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){
 try{const {accountId}=await workAccount();const report=instantLeadsEnabled(process.env)?await db('rpc/icash_meta_response_report','POST',{p_account:accountId}):[];return Response.json({report},{headers});}
 catch{return Response.json({error:'Could not load response results.'},{status:503,headers});}
}
export async function POST(req:Request){
 if(!allowedOrigin(req)||!instantLeadsEnabled(process.env))return new Response(null,{status:403,headers});
 try{const raw=await req.text();if(raw.length>512)throw Error();const i=z.object({leadId:z.string().uuid(),paused:z.boolean()}).strict().parse(JSON.parse(raw));const {accountId}=await workAccount({allowInactiveMembership:i.paused,allowUnacknowledged:i.paused});
 const saved=await db<boolean>('rpc/icash_meta_pause_lead','POST',{p_account:accountId,p_lead:i.leadId,p_paused:i.paused});if(!saved)throw Error();return Response.json({saved:true},{headers});}
 catch{return Response.json({error:'Could not update this lead. Refresh and try again.'},{status:409,headers});}
}
