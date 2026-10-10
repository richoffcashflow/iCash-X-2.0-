import {NextResponse} from 'next/server';
import {db} from '@/lib/stripe-test';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {currentUser} from '@/lib/account-auth';
import {allowedOrigin} from '@/lib/funding-policy';
import {sendForSignatures,refreshSigning,completedSigningPdf,customerSigningLink} from '@/lib/signing-service';
import {signerSchema} from '@/lib/signing-policy';
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('send'),dealId:z.string().uuid(),kind:z.enum(['purchase','assignment']),signers:z.array(signerSchema).min(1).max(8),confirmed:z.literal(true),autoSignature:z.string().trim().min(2).max(200).optional()}).strict(),
 z.object({action:z.enum(['refresh','link','revoke_auto']),id:z.string().uuid()}).strict(),
]);
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 try{const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>6000)throw new Error('Request too large');const i=input.parse(JSON.parse(raw));
  const user=await currentUser();if(!user?.email)throw new Error('Verified customer email required.');
  if(i.action==='revoke_auto'){const changed=await db<unknown[]>(`icash_signature_authorizations?envelope_id=eq.${i.id}&account_id=eq.${accountId}&state=eq.authorized`,'PATCH',{state:'revoked'});return NextResponse.json({message:changed.length?'Auto-sign turned off for this agreement.':'No pending authorization changed. A signature already in progress cannot be recalled here.'});}
  const result=i.action==='send'?await sendForSignatures({...i,accountId,userId,customerEmail:user.email}):i.action==='link'?await customerSigningLink(accountId,i.id,user.email):await refreshSigning(accountId,i.id);
  return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){const message=e instanceof Error?e.message:'';return NextResponse.json({error:message.startsWith('[')||message==='Database request failed'?'Could not prepare signing. An existing request may need review before another can be sent.':message||'Signing unavailable.'},{status:409});}
}
export async function GET(req:Request){
 try{const {accountId}=await workAccount({allowInactiveMembership:true});const id=z.string().uuid().parse(new URL(req.url).searchParams.get('id'));const bytes=await completedSigningPdf(accountId,id,new URL(req.url).searchParams.get('audit')==='true');return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="icash-signed-contract.pdf"','Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'Signed PDF unavailable.'},{status:409});}
}
