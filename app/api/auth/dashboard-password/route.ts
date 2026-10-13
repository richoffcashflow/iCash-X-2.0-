import {cookies} from 'next/headers';
import {currentUser,authRequest} from '@/lib/account-auth';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
import {db} from '@/lib/stripe-test';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {dashboardCookie,dashboardLifetime,issueDashboardProof,validDashboardProof} from '@/lib/dashboard-password-policy';
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
  if(Object.keys(body).length!==1||typeof body.password!=='string'||!body.password||body.password.length>512)throw Error();
  const verified=await authRequest<{access_token:string;user:{id:string;email_confirmed_at?:string}}>('token?grant_type=password',{email:u.email,password:body.password});
  // The password grant is verification only: revoke its refresh session and retain the original login.
  await authRequest('logout?scope=local',{},verified.access_token);
  if(verified.user.id!==u.id||!verified.user.email_confirmed_at)throw Error();
  const jar=await cookies(),key=process.env.SUPABASE_SECRET_KEY;
  if(!key)throw Error();
  jar.set(dashboardCookie,issueDashboardProof(jar.get('icash_access')?.value??'',u.id,key),{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:dashboardLifetime});
  return Response.json({unlocked:true},{headers});
 }catch{return Response.json({error:'Could not unlock. Check your account password, or wait 15 minutes if you have tried several times.'},{status:403,headers});}
}
export async function DELETE(req:Request){if(!allowedOrigin(req))return new Response(null,{status:403,headers});(await cookies()).set(dashboardCookie,'',{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:0});return Response.json({unlocked:false},{headers});}
