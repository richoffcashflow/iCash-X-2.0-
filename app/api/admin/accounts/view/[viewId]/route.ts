import {z} from 'zod';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {ownerAccountActor,ownerAccountView,ownerViewFailure,ownerViewHeaders} from '@/lib/owner-account-access';
export const dynamic='force-dynamic';
type Context={params:Promise<{viewId:string}>};
export async function GET(_req:Request,context:Context){try{
 const id=z.string().uuid().parse((await context.params).viewId),{view}=await ownerAccountView(id);
 return Response.json({view},{headers:ownerViewHeaders});
 }catch(e){return ownerViewFailure(e);}}
export async function DELETE(req:Request,context:Context){
 if(!allowedOrigin(req))return Response.json({error:'Invalid origin'},{status:403,headers:ownerViewHeaders});
 try{const id=z.string().uuid().parse((await context.params).viewId),actor=await ownerAccountActor();
 await db('rpc/icash_owner_account_view_end','POST',{p_actor:actor.userId,p_session:actor.sessionId,p_view:id});
 return Response.json({ended:true},{headers:ownerViewHeaders});
 }catch(e){return ownerViewFailure(e);}}
