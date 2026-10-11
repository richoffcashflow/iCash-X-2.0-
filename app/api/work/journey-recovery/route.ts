import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {recoveryInput} from '@/lib/deal-completion';
export async function POST(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 if(!allowedOrigin(req))return Response.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId,userId}=await workAccount(),raw=await req.text();if(raw.length>2500)throw Error();
  const b=recoveryInput.parse(JSON.parse(raw));
  await db('rpc/icash_resolve_journey_blocker','POST',{p_account:accountId,p_actor:userId,p_journey:b.journeyId,p_revision:b.revision,p_resolution:b.resolution});
  return Response.json({saved:true},{headers});
 }catch{return Response.json({error:'Refresh the buyer request and record the verified outcome before continuing.'},{status:409,headers});}
}
