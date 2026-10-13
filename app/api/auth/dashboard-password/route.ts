import {cookies} from 'next/headers';
import {currentUser,authRequest,saveSession} from '@/lib/account-auth';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
import {db} from '@/lib/stripe-test';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {dashboardCookie,dashboardLifetime,dashboardRememberLifetime,issueDashboardProof,validDashboardProof} from '@/lib/dashboard-password-policy';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
async function principal(){
 const u=await currentUser(true);if(!u)return null;
 if(u.id===ownerInboundTarget.ownerUserId||u.id===process.env.WEBINAR_OWNER_USER_ID)return u;
 const [op]=await db<{expires_at:string;revoked_at:string|null;scopes:string[]}[]>(`icash_trusted_operators?user_id=eq.${u.id}&select=expires_at,revoked_at,scopes&limit=1`);
 return op&&!op.revoked_at&&Date.parse(op.expires_at)>Date.now()&&op.scopes.some(s=>['support','authority_review'].includes(s))?u:null;
}
export async function GET(){try{
 const u=await principal();if(!u)return Response.json({allowed:false,unlocked:false},{status:403,headers});
 const jar=await cookies();return Response.json({allowed:true,unlocked:validDashboardProof(jar.get(dashboardCookie)?.value,jar.get('icash_access')?.value,process.env.SUPABASE_SECRET_KEY,u.id)},{headers});
 }catch{return Response.json({error:'Dashboard access is temporarily unavailable.'},{status:503,headers});}}
export async function POST(req:Request){
 if(!allowedOrigin(req))return new Response(null,{status:403,headers});
 try{
  const u=await principal();if(!u?.email)return Response.json({error:'Sign in with your dashboard account first.'},{status:403,headers});
  await limitRequest(req,'dashboard-password',u.id,5,900);
  const raw=await req.text();if(raw.length>2048)throw Error();const body=JSON.parse(raw);
  if(!body||Object.keys(body).some(k=>!['password','remember'].includes(k))||typeof body.password!=='string'||!body.password||body.password.length>512||(body.remember!==undefined&&typeof body.remember!=='boolean'))throw Error();
  const verified=await authRequest<{access_token:string;user:{id:string;email_confirmed_at?:string}}>('token?grant_type=password',{email:u.email,password:body.password});
  // The password grant is verification only: revoke its refresh session and retain the original login.
  await authRequest('logout?scope=local',{},verified.access_token);
  if(verified.user.id!==u.id||!verified.user.email_confirmed_at)throw Error();
  const jar=await cookies(),key=process.env.SUPABASE_SECRET_KEY;
  if(!key)throw Error();
  const lifetime=body.remember===true?dashboardRememberLifetime:dashboardLifetime;
  jar.set(dashboardCookie,issueDashboardProof(jar.get('icash_access')?.value??'',u.id,key,Date.now(),lifetime),{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:lifetime});
  return Response.json({unlocked:true},{headers});
 }catch{return Response.json({error:'Could not unlock. Check your account password, or wait 15 minutes if you have tried several times.'},{status:403,headers});}
}
export async function DELETE(req:Request){if(!allowedOrigin(req))return new Response(null,{status:403,headers});(await cookies()).set(dashboardCookie,'',{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:0});return Response.json({unlocked:false},{headers});}

// A fresh code sent to the verified account is required to set or change its password.
export async function PUT(req:Request){
 if(!allowedOrigin(req))return new Response(null,{status:403,headers});
 try{const u=await principal();if(!u?.email)throw Error();
  await limitRequest(req,'dashboard-password-email',u.id,3,600);
  await authRequest('otp',{email:u.email,create_user:false});
  return Response.json({sent:true},{headers});
 }catch{return Response.json({error:'Could not send a code. Wait a moment and try again.'},{status:403,headers});}
}
export async function PATCH(req:Request){
 if(!allowedOrigin(req))return new Response(null,{status:403,headers});
 let temporaryAccess:string|undefined;
 try{const u=await principal();if(!u?.email)throw Error();
  await limitRequest(req,'dashboard-password-change',u.id,5,900);
  const raw=await req.text();if(raw.length>2048)throw Error();const body=JSON.parse(raw);
  if(!body||Object.keys(body).some(k=>!['password','code','remember'].includes(k))||typeof body.password!=='string'||body.password.length<8||body.password.length>512||typeof body.code!=='string'||!/^\d{6,10}$/.test(body.code)||(body.remember!==undefined&&typeof body.remember!=='boolean'))throw Error();
  const key=process.env.SUPABASE_SECRET_KEY;if(!key||key.length<32)throw Error();
  const session=await authRequest<{access_token:string;refresh_token:string;expires_in:number;user:{id:string;email_confirmed_at?:string}}>('verify',{email:u.email,token:body.code,type:'email'});
  temporaryAccess=session.access_token;
  if(session.user.id!==u.id||!session.user.email_confirmed_at)throw Error();
  const lifetime=body.remember===true?dashboardRememberLifetime:dashboardLifetime;
  const proof=issueDashboardProof(session.access_token,u.id,key,Date.now(),lifetime);
  const updated=await authRequest<{id:string}>('user',{password:body.password},session.access_token,'PUT');
  if(updated.id!==u.id)throw Error();
  await saveSession(session);
  (await cookies()).set(dashboardCookie,proof,{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:lifetime});
  temporaryAccess=undefined;
  return Response.json({unlocked:true},{headers});
 }catch{return Response.json({error:'Could not save your password. Request a new email code and use a unique password with at least 8 characters.'},{status:403,headers});}
 finally{if(temporaryAccess)try{await authRequest('logout?scope=local',{},temporaryAccess);}catch{/* The failed verification session is never saved in browser cookies. */}}
}
