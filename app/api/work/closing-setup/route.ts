import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {closingSetupInput} from '@/lib/closing-setup';
export async function POST(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>4096)throw Error();
  const parsed=closingSetupInput.safeParse(JSON.parse(raw));
  if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message??'Check the closing details.'},{status:400,headers});
  const b=parsed.data;
  const result=b.action==='use_closer'
   ?await db('rpc/icash_select_saved_closer','POST',{p_account:accountId,p_actor:userId,p_deal:b.dealId,p_source:b.data.sourceDealId})
   :await db('rpc/icash_save_closing_setup','POST',{p_account:accountId,p_actor:userId,p_deal:b.dealId,p_action:b.action,p_data:b.data});
  return NextResponse.json({saved:true,result},{headers});
 }catch{return NextResponse.json({error:'Could not save. Refresh the deal and check the signed purchase, complete closer details and existing title choice. If title delivery has already been reserved or attempted, choose “I’ll handle this property” below to review it before changing the closer.'},{status:409,headers});}
}
