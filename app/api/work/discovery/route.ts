import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/account-auth';
import {fundingMode} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {discoverForAccount} from '@/lib/discovery-service';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(request:Request){
 const headers={'Cache-Control':'private, no-store'};
 if(request.headers.get('origin')!==new URL(request.url).origin)return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const user=await currentUser(true);
  if(!user)return NextResponse.json({error:'Sign in required'},{status:401,headers});
  if(fundingMode()!=='live')return NextResponse.json({status:'not_ready'},{headers});
  const accounts=await db<{id:string}[]>(`icash_accounts?owner_user_id=eq.${user.id}&select=id&limit=2`);
  if(accounts.length!==1)return NextResponse.json({status:'not_ready'},{headers});
  return NextResponse.json(await discoverForAccount(accounts[0].id),{headers});
 }catch{return NextResponse.json({status:'held',message:'Discovery is held. Any pending spend will be reconciled before retrying.'},{status:503,headers});}
}
