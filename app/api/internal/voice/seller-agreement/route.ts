import {NextResponse} from 'next/server';
import {db} from '@/lib/stripe-test';
import {bindSellerAgreementCall} from '@/lib/seller-agreement-binding';
import {sellerAgreementAction,sellerAgreementFailure} from '@/lib/seller-agreement-service';
import {sendForSignatures,refreshSigning} from '@/lib/signing-service';
import {textPendingContract} from '@/lib/contract-text-service';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){
 const headers={'Cache-Control':'private, no-store'},token=request.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!token||!/^[a-f0-9]{64}$/.test(token))return NextResponse.json({sent:false},{status:401,headers});
 if(process.env.ICASH_LIVE_WORK_READY!=='true'||process.env.ICASH_RECORDING_RECEIPTS_READY!=='true'||process.env.DOCUSEAL_MODE!=='live')return NextResponse.json({sent:false,status:'unavailable',instruction:'Live agreement delivery is not ready. Arrange follow-up.'},{status:409,headers});
 try{
  const body=await request.text();if(body.length>2400)throw Error('invalid_input');
  return NextResponse.json(await sellerAgreementAction(token,JSON.parse(body),{db,bind:bindSellerAgreementCall,send:sendForSignatures,text:textPendingContract,refresh:refreshSigning}),{headers});
 }catch(error){const failure=sellerAgreementFailure(error);console.warn('seller_agreement_held',{reason:failure.reason});return NextResponse.json(failure,{status:409,headers});}
}
