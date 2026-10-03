import {ensureRecordedConversationBinding} from '@/lib/required-call-recording-binding';
import {NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {db} from '@/lib/stripe-test';
const schema=z.object({conversationId:z.string().regex(/^conv_[A-Za-z0-9]+$/),dueAt:z.string().datetime({offset:true}),timezone:z.string().min(3).max(80),readback:z.string().min(10).max(1000),confirmation:z.string().min(2).max(1000)}).strict();
export async function POST(req:Request){const token=req.headers.get('authorization')?.replace(/^Bearer /,'');if(!token||!/^[a-f0-9]{64}$/.test(token))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{const raw=await req.text();if(raw.length>5000)throw new Error();const i=schema.parse(JSON.parse(raw));if(process.env.ICASH_RECORDING_RECEIPTS_READY==='true')await ensureRecordedConversationBinding(token,i.conversationId,db,process.env);
  const result=await db('rpc/icash_live_callback_tool','POST',{p_hash:createHash('sha256').update(token).digest('hex'),p_conversation:i.conversationId,p_due:i.dueAt,p_timezone:i.timezone,p_readback:i.readback,p_confirmation:i.confirmation});return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({saved:false,instruction:'The callback was not confirmed. Explain that follow-up needs review.'},{status:409});}}
