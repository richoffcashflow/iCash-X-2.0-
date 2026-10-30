import {requireTrustedOperator} from '@/lib/trusted-operator';
import {db} from '@/lib/stripe-test';
import {collectSupportQuality} from '@/lib/support-quality';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){
 try{await requireTrustedOperator();return Response.json(await collectSupportQuality(db),{headers});}
 catch(error){const denied=error instanceof Error&&['SIGN_IN_REQUIRED','OPERATOR_REQUIRED'].includes(error.message);return Response.json({error:denied?'A support operator account is required.':'Support quality could not load. Try refreshing.'},{status:denied?403:503,headers});}
}
