import {cookies} from 'next/headers';
import {randomBytes,createHash} from 'node:crypto';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
import {accessHelpCookie} from '@/lib/access-help';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export async function POST(req:Request){
 if(!allowedOrigin(req))return Response.json({error:'Open the link in your support email again.'},{status:403,headers});
 if(process.env.VERCEL_ENV!=='production')return Response.json({error:'Open your support email link on the live site.'},{status:503,headers});
 let token:string;
 try{const raw=await req.text();if(raw.length>200)throw Error();const value=JSON.parse(raw);if(Object.keys(value).length!==1||typeof value.token!=='string'||!/^[a-f0-9]{64}$/.test(value.token))throw Error();token=value.token;}catch{return Response.json({error:'Open the complete link in your support email.'},{status:400,headers});}
 try{
  const linkHash=createHash('sha256').update(token).digest('hex');
  await limitRequest(req,'access-help-return',linkHash,20,300);
  const secret=randomBytes(32).toString('hex');
  const restored=await db<boolean>('rpc/icash_access_help_return','POST',{p_link_hash:linkHash,p_session_hash:createHash('sha256').update(secret).digest('hex')});
  if(!restored)return Response.json({error:'This support link has expired. Open a newer support email, or contact us again below.'},{status:410,headers});
  (await cookies()).set(accessHelpCookie,secret,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:86400*7});
  return Response.json({restored:true},{headers});
 }catch(error){const limited=(error as {status?:number})?.status===429;return Response.json({error:limited?'Please wait a few minutes, then open this link again.':'Your conversation could not open. Please try again.'},{status:limited?429:503,headers});}
}
