import {createHash} from 'node:crypto';
import {db} from '@/lib/stripe-test';
import {resendContractText,inspectContractTextResend} from '@/lib/contract-text-resend';
export const runtime='nodejs';
export const maxDuration=60;

export async function GET(request:Request){
 const headers={'Cache-Control':'private, no-store'};
 const token=request.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!token||!/^[a-f0-9]{64}$/.test(token))return new Response(null,{status:401,headers});
 if(!process.env.DOCUSEAL_API_KEY)return new Response(null,{status:503,headers});
 try{
  const result=await inspectContractTextResend(createHash('sha256').update(token).digest('hex'),{db,key:process.env.DOCUSEAL_API_KEY});
  return Response.json(result,{status:result.status==='inspected'?200:result.status==='not_authorized'?409:503,headers});
 }catch{return Response.json({status:'inspection_unavailable'},{status:503,headers});}
}

export async function POST(request:Request){
 const headers={'Cache-Control':'private, no-store'};
 const token=request.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!token||!/^[a-f0-9]{64}$/.test(token))return new Response(null,{status:401,headers});
 if(process.env.DOCUSEAL_MODE!=='live'||!process.env.DOCUSEAL_API_KEY||process.env.ICASH_LIVE_WORK_READY!=='true')return new Response(null,{status:503,headers});
 try{
  const result=await resendContractText(createHash('sha256').update(token).digest('hex'),{db,key:process.env.DOCUSEAL_API_KEY});
  return Response.json(result,{status:result.status==='accepted'?200:result.status==='not_authorized'?409:503,headers});
 }catch{return Response.json({status:'needs_review_do_not_retry'},{status:503,headers});}
}
