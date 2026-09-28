import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {renderDealDocument} from '@/lib/deal-documents';
import {z} from 'zod';
const input=z.object({dealId:z.string().uuid(),kind:z.enum(['purchase','assignment','buyer_package','title_packet'])}).strict();
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 try{
  const {accountId}=await workAccount();const raw=await req.text();if(raw.length>512)throw new Error();const {dealId,kind}=input.parse(JSON.parse(raw));
  const [deal]=await db<{terms:unknown}[]>(`icash_deal_files?id=eq.${dealId}&account_id=eq.${accountId}&select=terms`);if(!deal)throw new Error();
  const html=renderDealDocument(kind,deal.terms);
  const [doc]=await db<{id:string}[]>('icash_deal_documents','POST',{deal_id:dealId,kind,terms:deal.terms,html});
  return NextResponse.json({id:doc.id,html,filename:`icash-${kind}-draft.html`},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'Could not prepare your document.'},{status:400});}
}
