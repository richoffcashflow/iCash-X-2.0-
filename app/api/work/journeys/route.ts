import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
export async function POST(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 if(!allowedOrigin(req))return Response.json({error:'Invalid origin'},{status:403,headers});
 try{const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>2000)throw Error();const b=z.object({dealId:z.guid(),dueAt:z.string().datetime(),source:z.string().trim().min(5).max(1000)}).strict().parse(JSON.parse(raw));
  await db('rpc/icash_save_journey_deadline','POST',{p_account:accountId,p_actor:userId,p_deal:b.dealId,p_due:b.dueAt,p_note:b.source});return Response.json({saved:true},{headers});
 }catch{return Response.json({error:'Check the agreed deadline and source. A current signed assignment is required.'},{status:409,headers});}
}
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{const {accountId}=await workAccount();const dealId=z.guid().parse(new URL(req.url).searchParams.get('dealId'));
  const [deal]=await db<{screening_id:string}[]>(`icash_deal_files?id=eq.${dealId}&account_id=eq.${accountId}&select=screening_id`);if(!deal)throw Error();
  const [journeys,messages]=await Promise.all([
   db('rpc/icash_journey_progress','POST',{p_account:accountId,p_screenings:[deal.screening_id]}),
   db<{id:string;state:string;event_key:string;delivery:{state:string}|null}[]>(`icash_journey_messages?account_id=eq.${accountId}&journey.deal_id=eq.${dealId}&select=id,state,event_key,journey:icash_deal_journeys!inner(deal_id),delivery:icash_text_messages(state)&order=created_at.desc&limit=20`)
  ]);
  return Response.json({journeys,messages:messages.map(m=>({id:m.id,state:m.state,event_key:m.event_key,deliveryState:m.delivery?.state??null}))},{headers});
 }catch{return Response.json({error:'Could not load buyer progress.'},{status:503,headers});}
}
