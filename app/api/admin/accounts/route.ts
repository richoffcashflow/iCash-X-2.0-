import {db} from '@/lib/stripe-test';
import {ownerAccountActor,ownerViewFailure,ownerViewHeaders} from '@/lib/owner-account-access';
import {ownerAccountFilters,ownerAccountsSchema} from '@/lib/owner-accounts';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{
 const actor=await ownerAccountActor(),params=new URL(req.url).searchParams;
 const parsed=ownerAccountFilters.safeParse(Object.fromEntries(params));
 if(!parsed.success||[...params.keys()].some(k=>params.getAll(k).length!==1))return Response.json({error:'Choose a valid sort and search of up to 100 characters.'},{status:400,headers:ownerViewHeaders});
 const f=parsed.data;
 const report=ownerAccountsSchema.parse(await db('rpc/icash_owner_accounts','POST',{p_actor:actor.userId,p_sort:f.sort,p_query:f.q,p_page:f.page},req.signal));
 if(report.sort!==f.sort||report.query!==f.q||report.page!==f.page)throw Error('Account filter mismatch');
 return Response.json({report},{headers:ownerViewHeaders});
 }catch(e){return ownerViewFailure(e);}}
