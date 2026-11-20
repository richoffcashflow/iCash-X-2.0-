import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/account-auth';
import {db} from '@/lib/stripe-test';
import {allowedOrigin,fundingMode} from '@/lib/funding-policy';
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{
  const mode=fundingMode(),user=await currentUser(true,req.signal);
  if(!user)return NextResponse.json({error:'Sign in to continue.'},{status:401,headers});
  if(!mode)return NextResponse.json({error:'Funding is unavailable.'},{status:503,headers});
  const [account]=await db<{id:string}[]>(`icash_accounts?owner_user_id=eq.${user.id}&select=id&limit=1`,'GET',undefined,req.signal);
  if(!account)return NextResponse.json({error:'Account not found.'},{status:404,headers});
  const [setting]=await db<{enabled:boolean}[]>(`icash_auto_recharges?account_id=eq.${account.id}&mode=eq.${mode}&select=enabled&limit=1`,'GET',undefined,req.signal);
  return NextResponse.json({enabled:setting?.enabled??false},{headers});
 }catch{return NextResponse.json({error:'Could not check auto recharge.'},{status:503,headers});}
}

export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Open iCash X directly.'},{status:403});
 try{
  const raw=await req.text();if(raw.length>100||JSON.parse(raw).enabled!==false)return NextResponse.json({error:'Enable auto recharge through checkout.'},{status:400});
  const user=await currentUser();if(!user)return NextResponse.json({error:'Sign in to continue.'},{status:401});
  const [account]=await db<{id:string}[]>(`icash_accounts?owner_user_id=eq.${user.id}&select=id&limit=1`);if(!account)return NextResponse.json({error:'Account not found.'},{status:404});
  await db(`icash_auto_recharges?account_id=eq.${account.id}&mode=eq.${fundingMode()}`,'PATCH',{enabled:false,pending_order:null,issue:null,updated_at:new Date().toISOString()});
  return NextResponse.json({enabled:false},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Could not turn off auto recharge. Please retry.'},{status:503});}
}
