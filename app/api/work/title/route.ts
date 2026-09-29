import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {dispatchTitleRequest} from '@/lib/title-service';
export const maxDuration=60;
export async function POST(req:Request){
 try{
 const {accountId}=await workAccount();const b=await req.json();
 if(b.confirmed!==true||typeof b.dealId!=='string'||!/^[a-f0-9-]{36}$/i.test(b.dealId))return NextResponse.json({error:'Confirm the title request.'},{status:400});
 const job=await db<{id:string}>('rpc/icash_prepare_title_request','POST',{p_account:accountId,p_deal:b.dealId});
 return NextResponse.json(await dispatchTitleRequest(accountId,job.id));
 }catch{return NextResponse.json({error:'Title request held. Verify the closing contact, signed agreement, credits and provider setup.'},{status:409});}
}
