import {NextResponse} from 'next/server';
import {z} from 'zod';
import {allowedOrigin} from '@/lib/funding-policy';
import {workAccount} from '@/lib/work-account';
import {accountMembership,publicMembership} from '@/lib/membership';
import {changePrivateVip,reconcilePrivateVip,privateVipView} from '@/lib/private-vip';
import {privateVipVersion} from '@/lib/private-vip-policy';
import {limitRequest} from '@/lib/funding';
const headers={'Cache-Control':'private, no-store'};
const input=z.object({action:z.enum(['upgrade','downgrade','keep_vip','manage']),accepted:z.literal(true),version:z.literal(privateVipVersion)}).strict();
export async function GET(){try{const {accountId}=await workAccount({allowUnacknowledged:true});const m=await accountMembership(accountId);if(!m?.private_invite_id)throw Error('Free Standard access required');await reconcilePrivateVip(m);const saved=await accountMembership(accountId);return NextResponse.json({membership:publicMembership(saved),privateVip:await privateVipView(saved)},{headers});}catch{return NextResponse.json({error:'Could not confirm VIP. Refresh before retrying payment.'},{status:409,headers});}}
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{const raw=await req.text();if(raw.length>500)throw Error('Invalid request');const i=input.parse(JSON.parse(raw));const {accountId}=await workAccount({allowUnacknowledged:true});await limitRequest(req,'private-vip',accountId,8,600);const m=await accountMembership(accountId);if(!m)throw Error('Free Standard access required');return NextResponse.json(await changePrivateVip(m,i.action,req.headers.get('origin')!,req),{headers});}
 catch(e){return NextResponse.json({error:e instanceof z.ZodError?'Review and accept the $50/month VIP terms.':e instanceof Error&&e.message!=='Database request failed'?e.message:'Could not confirm VIP. Refresh before retrying payment.'},{status:409,headers});}
}
