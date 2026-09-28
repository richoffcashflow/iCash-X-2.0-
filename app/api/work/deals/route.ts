import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {dealTermsSchema} from '@/lib/deal-documents';
import {z} from 'zod';
const input=z.object({screeningId:z.string().uuid(),terms:dealTermsSchema}).strict();
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 try{
  const {accountId}=await workAccount();const raw=await req.text();if(raw.length>12000)throw new Error();
  const {screeningId,terms}=input.parse(JSON.parse(raw));
  const [identity]=await db<{principal:string}[]>(`icash_customer_identities?account_id=eq.${accountId}&select=principal`);
  if(!identity?.principal)return NextResponse.json({error:'Save your company or personal name in Account details first.'},{status:409});
  terms.buyer=identity.principal;
  const id=await db<string>('rpc/icash_prepare_deal','POST',{p_account:accountId,p_screening:screeningId,p_terms:terms});
  return NextResponse.json({id,terms,stage:'draft'});
 }catch{return NextResponse.json({error:'Could not save this draft. Check the fields; signed deals require an amendment.'},{status:400});}
}
