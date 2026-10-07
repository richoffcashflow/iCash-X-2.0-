import {NextResponse} from 'next/server';
import {z} from 'zod';
import {allowedOrigin} from '@/lib/funding-policy';
import {workAccount} from '@/lib/work-account';
import {accountMembership,publicMembership} from '@/lib/membership';
import {changeVipPlan,reconcileVipChanges} from '@/lib/vip-membership';
import {vipTermsVersion} from '@/lib/vip-policy';
import {limitRequest} from '@/lib/funding';
const headers={'Cache-Control':'private, no-store'};
const input=z.object({action:z.enum(['upgrade','downgrade','keep_vip']),accepted:z.literal(true),version:z.literal(vipTermsVersion)}).strict();
export async function GET(){try{const {accountId}=await workAccount();const m=await accountMembership(accountId);if(m)await reconcileVipChanges(m.id);return NextResponse.json({membership:publicMembership(await accountMembership(accountId))},{headers});}catch{return NextResponse.json({error:'Could not confirm your plan. Please retry.'},{status:503,headers});}}
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{const raw=await req.text();if(raw.length>500)throw Error('Invalid request');const i=input.parse(JSON.parse(raw));const {accountId}=await workAccount();await limitRequest(req,'vip-plan',accountId,8,600);const m=await accountMembership(accountId);if(!m)throw Error('Active subscription required');return NextResponse.json(await changeVipPlan(m,i.action,req.headers.get('origin')!),{headers});}
 catch(e){return NextResponse.json({error:e instanceof Error&&e.message!=='Database request failed'?e.message:'Could not confirm your plan change. Refresh before retrying.'},{status:409,headers});}
}
