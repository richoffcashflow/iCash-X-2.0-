import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
const tokenSchema=z.string().regex(/^[a-f0-9]{32}$/);
const line=z.string().trim().min(2).max(200).refine(v=>!/[\r\n]/.test(v));
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('details'),data:z.object({legalName:line,signerName:line,email:z.string().trim().email().max(254),askingPriceCents:z.number().int().positive().safe(),depositCents:z.number().int().min(1).max(500000),fundsReady:z.literal(true),authorized:z.literal(true),titleCompany:z.string().trim().max(200)}).strict()}).strict(),
 z.object({action:z.literal('choose_time'),data:z.object({startsAt:z.string().min(10).max(60)}).strict()}).strict(),
 z.object({action:z.enum(['confirm','cancel']),data:z.object({id:z.string().uuid(),version:z.number().int().positive()}).strict()}).strict(),
 z.object({action:z.literal('availability'),data:z.object({windows:z.array(z.string().min(10).max(200)).min(1).max(8)}).strict()}).strict()
]);
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
type Context={params:Promise<{token:string}>};
export async function GET(_req:Request,ctx:Context){
 try{const token=tokenSchema.parse((await ctx.params).token);const result=await db<unknown>('rpc/icash_read_journey','POST',{p_token:token});
  return Response.json(result??{error:'This link is unavailable. Please reply to your deal contact.'},{status:result?200:404,headers});
 }catch{return Response.json({error:'Could not load this next step. Please try again.'},{status:503,headers});}
}
export async function POST(req:Request,ctx:Context){
 if(!allowedOrigin(req))return Response.json({error:'Invalid origin'},{status:403,headers});
 try{const token=tokenSchema.parse((await ctx.params).token);const raw=await req.text();if(raw.length>6000)throw Error();const body=input.parse(JSON.parse(raw));
  const result=await db('rpc/icash_submit_journey','POST',{p_token:token,p_action:body.action,p_data:body.data});
  return Response.json(result,{headers});
 }catch{return Response.json({error:'This step changed or is missing information. Refresh and check the details. Reply to your deal contact if you need help.'},{status:409,headers});}
}
