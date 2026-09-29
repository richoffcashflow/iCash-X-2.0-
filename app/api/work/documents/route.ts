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

export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{const {accountId}=await workAccount();const id=z.string().uuid().parse(new URL(req.url).searchParams.get('id'));
 const [meta]=await db<{deal_id:string}[]>(`icash_deal_documents?id=eq.${id}&select=deal_id`);if(!meta)throw Error();
 const [deal]=await db<{id:string}[]>(`icash_deal_files?id=eq.${meta.deal_id}&account_id=eq.${accountId}&select=id`);if(!deal)throw Error();
 const [doc]=await db<{html:string;kind:string}[]>(`icash_deal_documents?id=eq.${id}&deal_id=eq.${deal.id}&select=html,kind`);if(!doc)throw Error();
 return NextResponse.json({html:doc.html,filename:`icash-${doc.kind}-draft.html`},{headers});
 }catch{return NextResponse.json({error:'Document unavailable.'},{status:404,headers});}
}
