import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {receptionTarget} from '@/lib/general-reception';
import {readReceptionCarrierDiagnostic} from '@/lib/reception-carrier-diagnostic';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const unavailable=(status:number)=>NextResponse.json({status:'unavailable'},{status,headers});
export async function GET(request:Request){try{
 const account=await workAccount();if(account.accountId!==receptionTarget.accountId||account.userId!==receptionTarget.ownerUserId)return unavailable(403);
 const url=new URL(request.url);if(url.search||url.username||url.password||request.headers.get('host')!==url.host)return unavailable(400);
 if(!['same-origin','none',null].includes(request.headers.get('sec-fetch-site'))||request.headers.has('origin')&&request.headers.get('origin')!==url.origin)return unavailable(403);
 return NextResponse.json(await readReceptionCarrierDiagnostic({TWILIO_ACCOUNT_SID:process.env.TWILIO_ACCOUNT_SID,TWILIO_AUTH_TOKEN:process.env.TWILIO_AUTH_TOKEN},{rpc:(name:string,body?:Record<string,unknown>)=>db('rpc/'+name,'POST',body??{})}),{headers});
}catch(e){return unavailable(e instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(e.message)?401:503);}}
