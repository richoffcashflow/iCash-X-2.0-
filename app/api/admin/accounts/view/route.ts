import {z} from 'zod';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
import {db} from '@/lib/stripe-test';
import {ownerAccountActor,ownerViewFailure,ownerViewHeaders} from '@/lib/owner-account-access';
export async function POST(req:Request){
 if(!allowedOrigin(req))return Response.json({error:'Invalid origin'},{status:403,headers:ownerViewHeaders});
 try{
  const actor=await ownerAccountActor(),raw=await req.text();
  const input=raw.length<=200?z.object({accountId:z.guid()}).strict().safeParse(JSON.parse(raw)):null;
  if(!input?.success)return Response.json({error:'Choose an account from Accounts.'},{status:400,headers:ownerViewHeaders});
  await limitRequest(req,'owner-account-view',actor.userId,30,600);
  const view=z.object({id:z.guid(),expiresAt:z.string().datetime({offset:true})}).parse(await db('rpc/icash_owner_account_view_start','POST',{p_actor:actor.userId,p_session:actor.sessionId,p_account:input.data.accountId}));
  return Response.json({url:`/admin/accounts/${view.id}`,expiresAt:view.expiresAt},{headers:ownerViewHeaders});
 }catch(e){return ownerViewFailure(e);}
}
