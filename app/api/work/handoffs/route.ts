import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 try{
  const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>4000)throw new Error();
  const b=z.discriminatedUnion('action',[
   z.object({id:z.guid(),action:z.literal('assign'),assignee:z.string().trim().min(2).max(200),dueAt:z.string().datetime()}).strict(),
   z.object({id:z.guid(),action:z.literal('resolve'),resolution:z.string().trim().min(5).max(2000),resume:z.boolean()}).strict()
  ]).parse(JSON.parse(raw));
  await db('rpc/icash_manage_handoff','POST',{p_actor:userId,p_account:accountId,p_id:b.id,p_action:b.action,p_assignee:b.action==='assign'?b.assignee:null,p_due:b.action==='assign'?b.dueAt:null,p_resolution:b.action==='resolve'?b.resolution:null,p_resume:b.action==='resolve'&&b.resume});
  return NextResponse.json({saved:true},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'Could not save. Add a responsible person and future deadline, or a resolution. Resolve other closing issues before returning control.'},{status:409});}
}
