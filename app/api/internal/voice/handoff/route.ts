import {NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {db} from '@/lib/stripe-test';
const input=z.object({conversationId:z.string().regex(/^conv_[A-Za-z0-9]+$/),reason:z.string().trim().min(1).max(1000)}).strict();
/** Per-call secret capability, never a public agent ID or a shared browser credential. */
export async function POST(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!token||!/^[0-9a-f]{64}$/.test(token))return NextResponse.json({error:'Unauthorized'},{status:401,headers});
 try{
  const raw=await req.text();if(raw.length>3000)throw new Error();const i=input.parse(JSON.parse(raw));
  const result=await db('rpc/icash_live_handoff_tool','POST',{p_hash:createHash('sha256').update(token).digest('hex'),p_conversation:i.conversationId,p_reason:i.reason});
  return NextResponse.json(result,{headers});
 }catch{return NextResponse.json({error:'Handoff not confirmed. Stop negotiating and state that follow-up is needed.'},{status:409,headers});}
}
