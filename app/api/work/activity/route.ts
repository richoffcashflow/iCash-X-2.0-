import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {workspaceActivity} from '@/lib/workspace-activity-read';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 try{const {accountId}=await workAccount();return await workspaceActivity(req,accountId,{refreshOutcomes:true});}
 catch{return NextResponse.json({error:'Could not load your work. Sign in and retry.'},{status:503,headers:{'Cache-Control':'private, no-store'}});}
}
