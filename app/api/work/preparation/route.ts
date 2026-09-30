import {createHash} from 'node:crypto';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {dealTermsSchema} from '@/lib/deal-documents';
import {contractPreparation,type TermMessage} from '@/lib/contract-preparation';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{
  const {accountId}=await workAccount();const screeningId=z.string().uuid().parse(new URL(req.url).searchParams.get('screeningId'));
  const [property]=await db<{id:string}[]>(`icash_screening_jobs?id=eq.${screeningId}&account_id=eq.${accountId}&state=eq.complete&select=id`);if(!property)throw Error();
  const [deal]=await db<{id:string;stage:string;terms:unknown}[]>(`icash_deal_files?account_id=eq.${accountId}&screening_id=eq.${screeningId}&select=id,stage,terms`);
  const calls=await db<{id:string;contact_key:string;party:'seller'|'buyer';result:{transcript?:{role:string;message:string}[]}}[]>(`icash_live_conversations?account_id=eq.${accountId}&screening_id=eq.${screeningId}&state=eq.complete&select=id,contact_key,party,result&order=completed_at.desc&limit=4`);
  const threads=deal?await db<{id:string;party:string;recipient:string}[]>(`icash_text_threads?account_id=eq.${accountId}&deal_id=eq.${deal.id}&select=id,party,recipient&limit=30`):[];
  const messages:TermMessage[]=calls.flatMap(c=>(c.result.transcript??[]).filter(t=>t.role==='user').slice(-30).map(t=>({id:c.id,party:c.party,body:t.message,partyKey:c.contact_key||c.id})));
  if(threads.length){
   const texts=await db<{id:string;thread_id:string;body:string}[]>(`icash_text_messages?account_id=eq.${accountId}&thread_id=in.(${threads.map(t=>t.id).join(',')})&direction=eq.incoming&state=eq.received&select=id,thread_id,body&order=created_at.desc&limit=30`);
   for(const t of texts){const thread=threads.find(th=>th.id===t.thread_id);const party=thread?.party;if(thread&&(party==='seller'||party==='buyer'))messages.push({id:t.id,party,body:t.body,partyKey:createHash('sha256').update(thread.recipient).digest('hex')});}
  }
  return NextResponse.json(contractPreparation(messages,deal?.stage??'draft',dealTermsSchema.parse(deal?.terms??{})),{headers});
 }catch{return NextResponse.json({error:'Could not load saved conversation terms.'},{status:400,headers});}
}
