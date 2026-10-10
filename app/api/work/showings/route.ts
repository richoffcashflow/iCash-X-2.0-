import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {z} from 'zod';
const localTime=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const input=z.object({dealId:z.string().uuid(),action:z.enum(['propose','confirm_seller','confirm_buyer','reschedule','cancel','complete']),id:z.string().uuid().optional(),version:z.number().int().positive().optional(),data:z.object({requestId:z.string().uuid().optional(),buyer:z.string().trim().min(1).max(200).optional(),start:localTime.optional(),end:localTime.optional(),timezone:z.string().min(1).max(80).optional(),note:z.string().trim().max(1000).optional()}).strict()}).strict();
const headers={'Cache-Control':'private, no-store'};
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>2500)throw Error();const i=input.parse(JSON.parse(raw));
  const id=await db('rpc/icash_manage_showing','POST',{p_account:accountId,p_actor:userId,p_deal:i.dealId,p_action:i.action,p_id:i.id??null,p_version:i.version??null,p_data:i.data});
  return NextResponse.json({id,saved:true,message:'Showing saved. Dashboard reminders are updated. Contact the parties to confirm any changes; no invitation was sent.'},{headers});
 }catch{return NextResponse.json({error:'Could not save. Refresh the showing, check both confirmations and choose a future time without an overlap.'},{status:409,headers});}
}
export async function GET(req:Request){
 try{
  const {accountId}=await workAccount();const dealId=z.string().uuid().parse(new URL(req.url).searchParams.get('dealId'));
  const [deal]=await db<{id:string}[]>(`icash_deal_files?id=eq.${dealId}&account_id=eq.${accountId}&select=id`);if(!deal)throw Error();
  const [showings,requests]=await Promise.all([
   db(`icash_showing_requests?deal_id=eq.${deal.id}&select=id,buyer_name,starts_at,ends_at,timezone,state,version,seller_confirmed_at,buyer_confirmed_at,seller_note,buyer_note,change_note,buyer_request_id&order=starts_at.desc&limit=50`),
   db(`icash_buyer_viewing_requests?account_id=eq.${accountId}&deal_id=eq.${deal.id}&state=eq.needs_confirmation&or=(kind.eq.viewing,viewing_quote.not.is.null)&select=id,quote,viewing_quote&order=created_at.desc&limit=50`),
  ]);
  return NextResponse.json({showings,requests},{headers});
 }catch{return NextResponse.json({error:'Showings unavailable'},{status:404,headers});}
}
