import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {propertyCallHistory} from '@/lib/property-call-history';
import {uuid,privateHeaders} from '@/lib/required-call-recording';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const {accountId}=await workAccount(),params=new URL(request.url).searchParams,id=params.get('screeningId'),page=params.get('page')??'0';
 if(!uuid(id)||!/^\d{1,5}$/.test(page)||Number(page)>10000||[...params.keys()].some(k=>!['screeningId','page'].includes(k))||params.getAll('screeningId').length!==1||params.getAll('page').length>1)return new Response(null,{status:400,headers:privateHeaders});
 if(process.env.ICASH_RECORDING_RECEIPTS_READY!=='true')return Response.json({recordings:[],next:null},{headers:privateHeaders});
 const result=await propertyCallHistory(db,accountId,id,Number(page));
 return result?Response.json(result,{headers:privateHeaders}):new Response(null,{status:404,headers:privateHeaders});
 }catch{return Response.json({error:'Call recordings unavailable.'},{status:503,headers:privateHeaders});}}
