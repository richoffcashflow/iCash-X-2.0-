import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {launchReadiness} from '@/lib/launch-readiness';
export const dynamic='force-dynamic';
export async function GET(){
 try{const {accountId}=await workAccount();return NextResponse.json(await launchReadiness(accountId),{headers:{'Cache-Control':'private, no-store'}});}
 catch{return NextResponse.json({error:'Sign in to check your bot.'},{status:401});}
}
