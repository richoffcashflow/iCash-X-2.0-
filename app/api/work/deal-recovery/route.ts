import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {dealRecoveryInput} from '@/lib/deal-recovery';
const headers={'Cache-Control':'private, no-store'};
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>1000)throw Error('Input too long');
  const input=dealRecoveryInput.parse(JSON.parse(raw));
  const recovery=await db('rpc/icash_authorize_deal_recovery','POST',{p_account:accountId,p_actor:userId,p_deal:input.dealId,p_key:input.key,p_terms_hash:input.termsHash,p_minimum:input.minimumFeeCents});
  return NextResponse.json({saved:true,recovery},{headers});
 }catch{return NextResponse.json({error:'Could not approve these terms. Refresh the deal; already released prices require a separate review.'},{status:409,headers});}
}
