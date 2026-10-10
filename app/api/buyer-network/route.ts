import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentUser} from '@/lib/account-auth';
import {db} from '@/lib/stripe-test';
import {networkProfileSchema,networkError} from '@/lib/buyer-network';
import {limitRequest} from '@/lib/funding';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
async function user(){const u=await currentUser(true);if(!u)throw Error('SIGN_IN_REQUIRED');return u;}
export async function GET(){
 try{const u=await currentUser(true);if(!u)return NextResponse.json({signedIn:false},{headers});
  const [profile,matches]=await Promise.all([
   db('rpc/icash_network_profile','POST',{p_user:u.id}),db('rpc/icash_network_inbox','POST',{p_user:u.id}),
  ]);
  return NextResponse.json({signedIn:true,email:u.email,profile,matches},{headers});
 }catch{return NextResponse.json({error:'Could not load your matches. Please retry.'},{status:503,headers});}
}
export async function POST(req:Request){
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Same-origin session required.'},{status:403,headers});
 try{const u=await user();const raw=await req.text();if(raw.length>4000)throw Error('Too long');
  const profile=networkProfileSchema.parse(JSON.parse(raw));await limitRequest(req,'network-profile',u.id,10,3600);
  await db('rpc/icash_network_save_buyer','POST',{p_user:u.id,p_profile:profile});
  return NextResponse.json({saved:true},{headers});
 }catch(error){const e=networkError(error);return NextResponse.json({error:e.error},{status:e.status,headers});}
}
export async function PATCH(req:Request){
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Same-origin session required.'},{status:403,headers});
 try{const u=await user(),raw=await req.text();if(raw.length>500)throw Error('Too long');
  const input=z.object({matchId:z.string().uuid(),state:z.enum(['interested','passed'])}).strict().parse(JSON.parse(raw));
  await db('rpc/icash_network_respond','POST',{p_user:u.id,p_match:input.matchId,p_state:input.state});return NextResponse.json({saved:true},{headers});
 }catch(error){const e=networkError(error);return NextResponse.json({error:e.error},{status:e.status,headers});}
}
export async function DELETE(req:Request){
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Same-origin session required.'},{status:403,headers});
 try{const u=await user();await db('rpc/icash_network_pause','POST',{p_user:u.id});return NextResponse.json({paused:true},{headers});}
 catch(error){const e=networkError(error);return NextResponse.json({error:e.error},{status:e.status,headers});}
}
