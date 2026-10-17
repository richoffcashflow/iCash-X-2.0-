import {NextResponse} from 'next/server';
import {privateInvite,privateAccessCookie,privateAccessHeaders} from '@/lib/private-access';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(req:Request,{params}:{params:Promise<{token:string}>}){
 try{
  const {token}=await params,invite=await privateInvite(token);
  // No account is created by link previews, scanners or GET requests.
  const response=NextResponse.redirect(new URL('/private-access',req.url),303);
  for(const [key,value] of Object.entries(privateAccessHeaders))response.headers.set(key,value);
  response.cookies.set(privateAccessCookie,invite?token:'',{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:invite?3600:0});
  return response;
 }catch{return NextResponse.json({error:'Could not open this invitation. Please try again.'},{status:503,headers:privateAccessHeaders});}
}
