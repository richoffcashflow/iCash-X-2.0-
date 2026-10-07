import {NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {ensureRecordedConversationBinding} from '@/lib/required-call-recording-binding';
import {textPendingContract} from '@/lib/contract-text-service';
const input=z.object({conversationId:z.string().regex(/^conv_[A-Za-z0-9]+$/),agreedPriceCents:z.number().int().positive().safe()}).strict();
export async function POST(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!token||!/^[a-f0-9]{64}$/.test(token))return NextResponse.json({sent:false},{status:401,headers});
 try{
  const raw=await req.text();if(raw.length>500)throw Error();const {conversationId,agreedPriceCents}=input.parse(JSON.parse(raw));
  if(process.env.ICASH_RECORDING_RECEIPTS_READY==='true')await ensureRecordedConversationBinding(token,conversationId,db,process.env);
  const context=await db<{accountId:string;envelopeId:string;phone:string}|null>('rpc/icash_live_contract_context','POST',{p_hash:createHash('sha256').update(token).digest('hex'),p_conversation:conversationId});
  if(!context)throw Error();
  const [envelope]=await db<{terms:{priceCents?:number}}[]>(`icash_signing_envelopes?id=eq.${context.envelopeId}&account_id=eq.${context.accountId}&select=terms`);
  if(envelope?.terms?.priceCents!==agreedPriceCents)return NextResponse.json({sent:false,instruction:'The agreed price does not match the approved contract. Request a revised agreement; do not send the old contract.'},{status:409,headers});
  return NextResponse.json(await textPendingContract(context.accountId,context.envelopeId,context.phone),{headers});
 }catch{return NextResponse.json({sent:false,instruction:'An approved contract text is not available for this call. Say it needs follow-up; do not invent terms, a link, or delivery.'},{status:409,headers});}
}
