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
  const result=await db('rpc/icash_save_closing_setup','POST',{p_account:accountId,p_actor:userId,p_deal:b.dealId,p_action:b.action,p_data:b.data});
  return NextResponse.json({saved:true,result},{headers});
 }catch{return NextResponse.json({error:'Could not save. Refresh the deal. Selecting a closer requires a signed purchase, complete contact details, current delivery setup and agreement with the existing title choice. A different closer on a sent file needs human review.'},{status:409,headers});}
}
