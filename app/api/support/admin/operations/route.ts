import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireTrustedOperator} from '@/lib/trusted-operator';
import {db} from '@/lib/stripe-test';
import {collectOperatorExceptions,exceptionQuery} from '@/lib/operator-exceptions';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
/** Read-only: no claims, retries, provider requests, state writes or account impersonation. */
export async function GET(req:Request){
 try{
  await requireTrustedOperator('support');
  if(process.env.ICASH_OPERATOR_EXCEPTIONS_ENABLED!=='true')return NextResponse.json({enabled:false},{headers});
  const params=new URL(req.url).searchParams;
  if([...params.keys()].some(k=>params.getAll(k).length!==1))return NextResponse.json({error:'Invalid queue filters.'},{status:400,headers});
  const query=exceptionQuery.parse(Object.fromEntries(params));
  if(!query.source&&query.page!==0)return NextResponse.json({error:'Choose a category before paging.'},{status:400,headers});
  const snapshot=await collectOperatorExceptions(db,query,new Date(),req.signal);
  // Recheck expiry/revocation after a slow scan, before returning cross-account data.
  await requireTrustedOperator('support');
  return NextResponse.json({enabled:true,...snapshot},{headers});
 }catch(e){
  const denied=e instanceof Error&&['SIGN_IN_REQUIRED','OPERATOR_REQUIRED'].includes(e.message);
  return NextResponse.json({error:denied?'A provisioned support operator account is required.':e instanceof z.ZodError?'Invalid queue filters.':'Operations checks are temporarily unavailable.'},{status:denied?403:e instanceof z.ZodError?400:503,headers});
 }
}
