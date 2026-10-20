import {NextResponse} from 'next/server';
import {db} from '@/lib/stripe-test';
import {launchTokenPattern,legacyLaunchCookie} from '@/lib/legacy-launch-server';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
export async function GET(req:Request,{params}:{params:Promise<{token:string;target:string}>}) {
 const {token,target}=await params;
 if(!launchTokenPattern.test(token)||!['watch','join','unsubscribe'].includes(target))return new Response('This invitation is unavailable.',{status:404,headers});
 if(target==='unsubscribe')return new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stop launch messages</title><main style="font-family:system-ui;max-width:520px;margin:80px auto;padding:24px"><h1>Stop these launch messages?</h1><p>This stops the iCash X 2.0 email and text launch sequence. Your purchases stay unchanged.</p><form method="post"><button style="padding:16px 24px">Unsubscribe</button></form></main></html>',{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
 try {
  const [c]=await db<{id:string;launch_id:string;suppressed_reason:string|null;converted_at:string|null;first_visit_at:string|null}[]>(`icash_legacy_contacts?token=eq.${token}&select=id,launch_id,suppressed_reason,converted_at,first_visit_at&limit=1`);
  if(!c||c.suppressed_reason)return new Response('This invitation is unavailable.',{status:404,headers});
  const [l]=await db<{webinar_id:string|null}[]>(`icash_legacy_launches?id=eq.${c.launch_id}&select=webinar_id&limit=1`);
  const [w]=l?.webinar_id?await db<{public_code:number}[]>(`icash_webinars?id=eq.${l.webinar_id}&select=public_code&limit=1`):[];
  if(target==='watch'&&!w)return new Response('The private walkthrough is being prepared. Please try again later.',{status:503,headers});
  const destination=c.converted_at?'/':target==='join'?'/join':`/live/${w!.public_code}`;
  const now=new Date().toISOString();await db(`icash_legacy_contacts?id=eq.${c.id}`,'PATCH',{last_visit_at:now,...(!c.first_visit_at?{first_visit_at:now}:{})});
  const response=NextResponse.redirect(new URL(destination,req.url));for(const [key,value] of Object.entries(headers))response.headers.set(key,value);
  response.cookies.set(legacyLaunchCookie,token,{httpOnly:true,secure:process.env.NODE_ENV!=='development',sameSite:'lax',path:'/',maxAge:86400*30});
  return response;
 }catch{return new Response('Your invitation could not open. Please try again.',{status:503,headers});}
}
export async function POST(_req:Request,{params}:{params:Promise<{token:string;target:string}>}) {
 const {token,target}=await params;if(target!=='unsubscribe'||!launchTokenPattern.test(token))return new Response(null,{status:404,headers});
 try{await db('rpc/icash_legacy_stop','POST',{p_token:token});return new Response('You have been unsubscribed from the iCash X 2.0 launch messages.',{headers});}
 catch{return new Response('Could not save your preference. Please retry.',{status:503,headers});}
}
