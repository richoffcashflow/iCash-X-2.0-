import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {proceedsInput} from '@/lib/deal-completion';
export async function POST(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 if(!allowedOrigin(req))return Response.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId,userId}=await workAccount(),raw=await req.text();if(raw.length>700)throw Error();
  const b=proceedsInput.parse(JSON.parse(raw));
  const id=await db('rpc/icash_confirm_proceeds','POST',{p_account:accountId,p_actor:userId,p_deal:b.dealId,p_update:b.updateId,p_received:b.receivedDate});
  return Response.json({saved:true,id},{headers});
 }catch{return Response.json({error:'Refresh the closing record and check the date and payment confirmed by title.'},{status:409,headers});}
}
