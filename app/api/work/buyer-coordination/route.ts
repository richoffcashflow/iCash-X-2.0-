import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
const headers={'Cache-Control':'private, no-store'};
const id=z.string().uuid();
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('availability'),dealId:id,key:id,statement:z.string().trim().min(1).max(4000),windows:z.array(z.string().min(1).max(200)).max(8),timezone:z.enum(['America/Chicago','America/New_York','America/Denver','America/Los_Angeles','UTC'])}).strict(),
 z.object({action:z.literal('deposit'),dealId:id,envelopeId:id,key:id,amountCents:z.number().int().min(1).max(500000),method:z.enum(['check','wire','cash_app','zelle']),reference:z.string().trim().min(3).max(120),cleared:z.literal(true)}).strict()
]);
export async function GET(req:Request){
 try{
  const {accountId}=await workAccount();const dealId=id.parse(new URL(req.url).searchParams.get('dealId'));
  const [deal]=await db<{id:string}[]>(`icash_deal_files?account_id=eq.${accountId}&id=eq.${dealId}&select=id`);
  if(!deal)return NextResponse.json({error:'Property unavailable.'},{status:404,headers});
  const [availability,assignments]=await Promise.all([
   db<unknown[]>(`icash_seller_viewing_availability?account_id=eq.${accountId}&deal_id=eq.${dealId}&select=id,quote,slots,state,timezone,stated_at&order=stated_at.desc,created_at.desc,id.desc&limit=1`),
   db<{id:string}[]>(`icash_signing_envelopes?account_id=eq.${accountId}&deal_id=eq.${dealId}&kind=eq.assignment&state=eq.completed&test_mode=eq.false&select=id,buyer:terms->>assignee,depositCents:terms->assignmentDepositCents&limit=2`)
  ]);
  const receipts=assignments.length===1?await db<unknown[]>(`icash_buyer_deposit_receipts?account_id=eq.${accountId}&deal_id=eq.${dealId}&envelope_id=eq.${assignments[0].id}&select=id,amount_cents,method,reference,created_at&limit=1`):[];
  return NextResponse.json({availability:availability[0]??null,receipt:receipts[0]??null,assignment:assignments.length===1?assignments[0]:null},{headers});
 }catch{return NextResponse.json({error:'Could not load viewing times and deposit status.'},{status:503,headers});}
}
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>7000)throw Error();const b=input.parse(JSON.parse(raw));
  const result=b.action==='availability'
   ?await db<string>('rpc/icash_save_viewing_slots','POST',{p_account:accountId,p_actor:userId,p_deal:b.dealId,p_key:b.key,p_quote:b.statement,p_slots:b.windows,p_timezone:b.timezone})
   :await db<string>('rpc/icash_confirm_buyer_deposit','POST',{p_account:accountId,p_actor:userId,p_deal:b.dealId,p_envelope:b.envelopeId,p_key:b.key,p_amount:b.amountCents,p_method:b.method,p_reference:b.reference,p_cleared:b.cleared});
  return NextResponse.json({saved:true,id:result},{headers});
 }catch{return NextResponse.json({error:'Could not save. Check the seller times or the current signed assignment and cleared deposit, then refresh.'},{status:409,headers});}
}
