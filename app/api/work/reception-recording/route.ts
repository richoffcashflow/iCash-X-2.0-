import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {uuid,privateHeaders} from '@/lib/required-call-recording';
import {recordedReceptionPresentation} from '@/lib/recorded-reception-presentation';
import type {RecordedReceptionRow} from '@/lib/recorded-reception';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const {accountId}=await workAccount(),u=new URL(request.url),id=u.searchParams.get('id');
 if(u.searchParams.size>(id===null?0:1)||id!==null&&!uuid(id))return new Response(null,{status:400,headers:privateHeaders});
 if(process.env.ICASH_RECORDED_RECEPTION_SCHEMA_READY!=='true')return Response.json({recordings:[]},{headers:privateHeaders});
 if(id){const row=await db<RecordedReceptionRow|null>('rpc/icash_get_recorded_reception_session','POST',{p_id:id,p_account:accountId,p_operation:null});if(!row||row.account_id!==accountId)return new Response(null,{status:404,headers:privateHeaders});return Response.json(recordedReceptionPresentation(row),{headers:privateHeaders});}
 const rows=await db<RecordedReceptionRow[]>('rpc/icash_list_recorded_reception_sessions','POST',{p_account:accountId,p_limit:20});
 if(!Array.isArray(rows)||rows.length>20||rows.some(r=>r.account_id!==accountId))throw Error('OWNED_RECEIPTS_REQUIRED');
 return Response.json({recordings:rows.map(r=>recordedReceptionPresentation(r))},{headers:privateHeaders});
 }catch{return Response.json({error:'Reception recordings unavailable.'},{status:503,headers:privateHeaders});}}
