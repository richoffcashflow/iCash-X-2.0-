import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {mergeStoredDealTerms} from '@/lib/deal-term-update';
import {buyerDepositCents} from '@/lib/buyer-purchase-terms';
import {z} from 'zod';
const input=z.object({screeningId:z.string().uuid(),terms:z.record(z.unknown())}).strict();
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 try{
  const {accountId}=await workAccount();const raw=await req.text();if(raw.length>24000)throw new Error();
  const {screeningId,terms:submittedTerms}=input.parse(JSON.parse(raw));
  const [existing]=await db<{id:string;terms:Record<string,unknown>;stage:string}[]>(`icash_deal_files?account_id=eq.${accountId}&screening_id=eq.${screeningId}&select=id,terms,stage`);
  const terms=mergeStoredDealTerms(submittedTerms,existing?.terms??null);
  const [identity]=await db<{principal:string}[]>(`icash_customer_identities?account_id=eq.${accountId}&select=principal`);
  if(!identity?.principal)return NextResponse.json({error:'Save your company or personal name in Account details first.'},{status:409});
  terms.buyer=identity.principal;
  if(terms.assignmentFeeCents===null)terms.assignmentFeeCents=1000000;
  const issued=existing?await db<{id:string}[]>(`icash_signing_envelopes?account_id=eq.${accountId}&deal_id=eq.${existing.id}&kind=eq.assignment&test_mode=eq.false&state=not.in.(failed,declined,cancelled)&select=id&limit=1`):[];
  if(!issued.length)terms.assignmentDepositCents=buyerDepositCents(terms.assignmentFeeCents);
  const [screening]=await db<{snapshot:unknown;result:{property:{legalDescription?:string|null}}}[]>(`icash_screening_jobs?id=eq.${screeningId}&account_id=eq.${accountId}&select=result,snapshot`);
  if(!screening)throw new Error();
  if(!terms.legalDescription&&screening.result.property.legalDescription)terms.legalDescription=screening.result.property.legalDescription;
  const id=await db<string>('rpc/icash_prepare_deal','POST',{p_account:accountId,p_screening:screeningId,p_terms:terms});
  return NextResponse.json({id,terms,stage:existing?.stage??'draft'});
 }catch{return NextResponse.json({error:'Could not save this draft. Check the fields; signed deals require an amendment.'},{status:400});}
}
