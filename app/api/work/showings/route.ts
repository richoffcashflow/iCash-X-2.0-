import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {z} from 'zod';
const input=z.object({dealId:z.string().uuid(),buyer:z.string().trim().min(1).max(200),start:z.string().datetime({offset:true}),end:z.string().datetime({offset:true}),timezone:z.string().max(80)}).strict();
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 try{const {accountId}=await workAccount();const raw=await req.text();if(raw.length>1000)throw new Error();const i=input.parse(JSON.parse(raw));
 const id=await db('rpc/icash_propose_showing','POST',{p_account:accountId,p_deal:i.dealId,p_buyer:i.buyer,p_start:i.start,p_end:i.end,p_zone:i.timezone});
 return NextResponse.json({id,state:'proposed',message:'Time held. Seller/occupant and buyer confirmation are still required. No invitation has been sent.'});
 }catch{return NextResponse.json({error:'Could not hold that time. Check for an overlap or missing details.'},{status:409});}
}
export async function GET(req:Request){
 try{const {accountId}=await workAccount();const dealId=z.string().uuid().parse(new URL(req.url).searchParams.get('dealId'));
 const [deal]=await db<{id:string}[]>(`icash_deal_files?id=eq.${dealId}&account_id=eq.${accountId}&select=id`);if(!deal)throw new Error();
 return NextResponse.json({showings:await db(`icash_showing_requests?deal_id=eq.${deal.id}&select=id,buyer_name,starts_at,ends_at,timezone,state&order=starts_at&limit=20`)},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'Showings unavailable'},{status:404});}
}
