import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {closingUpdateSchema} from '@/lib/closing-progress';
import {db} from '@/lib/stripe-test';
export async function POST(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>2048)throw Error();
  const parsed=closingUpdateSchema.safeParse(JSON.parse(raw));if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message??'Check the update.'},{status:400,headers});
  const b=parsed.data;
  const id=await db<string>('rpc/icash_confirm_closing_update','POST',{p_account:accountId,p_actor:userId,p_deal:b.dealId,p_reply:b.replyId,p_kind:b.kind,p_date:b.effectiveDate,p_amount:b.amountCents,p_file:b.fileReference});
  return NextResponse.json({saved:true,id},{headers});
 }catch{return NextResponse.json({error:'Could not record this milestone. Check the title confirmation, required signatures and earlier milestones, then refresh.'},{status:409,headers});}
}
