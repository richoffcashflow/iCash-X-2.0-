import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 try{
 const {accountId}=await workAccount();const raw=await req.text();if(raw.length>1024)throw Error();const b=JSON.parse(raw);
 if(typeof b.taskId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.taskId)||!['confirm','done','dismissed'].includes(b.action))throw Error();
 if(b.action==='confirm'&&(typeof b.dueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)))throw Error();
 const ok=await db<boolean>('rpc/icash_update_title_task','POST',{p_account:accountId,p_task:b.taskId,p_action:b.action,p_due:b.action==='confirm'?b.dueDate:null});
 if(!ok)return NextResponse.json({error:'Task changed. Reopen the deal to refresh.'},{status:409});
 return NextResponse.json({saved:true});
 }catch{return NextResponse.json({error:'Could not update this task.'},{status:400});}
}
