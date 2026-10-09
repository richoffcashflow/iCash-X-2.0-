import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{const {accountId}=await workAccount();const params=new URL(req.url).searchParams;const id=z.string().uuid().parse(params.get('id'));const before=params.get('before')===null?null:z.coerce.number().int().min(0).max(100000).parse(params.get('before'));
 const source=z.enum(['outbound','reception']).parse(params.get('source')??'outbound');
 if(source==='reception'){const call=await db<unknown>('rpc/icash_reception_conversation','POST',{p_account:accountId,p_session:id,p_before:before});if(!call)throw Error();return NextResponse.json(call,{headers});}
 const [call]=await db<{party:string;result:{summary?:string;transcript?:{role:string;message:string}[]}}[]>(`icash_live_conversations?account_id=eq.${accountId}&id=eq.${id}&state=eq.complete&select=party,result`);if(!call)throw Error();
 const turns=call.result.transcript??[],end=Math.min(before??turns.length,turns.length),start=Math.max(0,end-60);
 return NextResponse.json({party:call.party,summary:call.result.summary,transcript:turns.slice(start,end),next:start>0?start:null},{headers});
 }catch{return NextResponse.json({error:'Conversation unavailable.'},{status:404,headers});}
}
