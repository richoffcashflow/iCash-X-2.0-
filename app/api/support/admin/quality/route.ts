import {requireTrustedOperator} from '@/lib/trusted-operator';
import {db} from '@/lib/stripe-test';
import {collectSupportQuality,type QualityScope} from '@/lib/support-quality';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request?:Request){
 try{await requireTrustedOperator();const params=new URL(request?.url??'https://localhost/api/support/admin/quality').searchParams;
  const scope=params.get('scope')??'unresolved';if(!['unresolved','recent'].includes(scope))throw Error('Invalid support quality scope');
  return Response.json(await collectSupportQuality(db,new Date(),{scope:scope as QualityScope,cursor:params.get('cursor')??undefined}),{headers});}
 catch(error){const denied=error instanceof Error&&['SIGN_IN_REQUIRED','OPERATOR_REQUIRED'].includes(error.message),invalid=error instanceof Error&&/^Invalid support quality (?:scope|cursor)$/.test(error.message);return Response.json({error:denied?'A support operator account is required.':invalid?'This review page is invalid. Restart the review.':'Support quality could not load. Try refreshing.'},{status:denied?403:invalid?400:503,headers});}
}
