import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{
  const {accountId}=await workAccount();
  const threadId=z.guid().parse(new URL(req.url).searchParams.get('threadId'));
  const rows=await db<{id:string}[]>(`icash_text_threads?account_id=eq.${accountId}&id=eq.${threadId}&retired_at=is.null&select=id&limit=1`);
  if(rows.length!==1||rows[0].id!==threadId)return NextResponse.json({error:'Conversation unavailable.'},{status:404,headers});
  const sendReason=await db<string|null>('rpc/icash_manual_text_reason','POST',{p_account:accountId,p_thread:threadId});
  if(sendReason!==null&&typeof sendReason!=='string')throw Error();
  return NextResponse.json({threadId,sendReason,manualReply:true},{headers});
 }catch{return NextResponse.json({error:'Text sending is temporarily unavailable. Your conversation and draft are saved.'},{status:503,headers});}
}
