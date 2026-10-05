import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {currentBotActivity} from '@/lib/bot-activity';
export const dynamic='force-dynamic';
export async function GET(){
 const headers={'Cache-Control':'private, no-store'};
 try{
  const {accountId}=await workAccount();
  const [accounts,tickets,screening]=await Promise.all([
   db<{bot_paused:boolean}[]>(`icash_accounts?id=eq.${accountId}&select=bot_paused&limit=1`),
   db<{kind:string;state:string;expires_at:string}[]>(`icash_automation_tickets?account_id=eq.${accountId}&state=eq.consumed&expires_at=gt.${new Date().toISOString()}&select=kind,state,expires_at&order=created_at.desc&limit=10`),
   db<{state:string;lease_until:string|null}[]>(`icash_screening_jobs?account_id=eq.${accountId}&state=eq.running&select=state,lease_until&limit=10`),
  ]);
  if(!accounts[0])throw Error('ACCOUNT_REQUIRED');
  return NextResponse.json(currentBotActivity({paused:accounts[0].bot_paused,tickets,screening}),{headers});
 }catch(e){
  const unauthorized=e instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(e.message);
  return NextResponse.json({error:'Status unavailable'},{status:unauthorized?401:503,headers});
 }
}
