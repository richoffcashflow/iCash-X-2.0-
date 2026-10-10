import {db} from './stripe-test';
import {cancellationEvidence,type CancellationEnvelope,type CancellationView} from './agreement-cancellation-policy.ts';
import type {Submission} from './docuseal-policy.ts';

async function providerRequest(id:string,testMode:boolean,expire=false):Promise<Submission> {
 if(!/^[1-9]\d{0,15}$/.test(id))throw Error('Signing request needs review.');
 const key=testMode?process.env.DOCUSEAL_TEST_API_KEY:process.env.DOCUSEAL_API_KEY;
 if(!key)throw Error('Signing connection unavailable.');
 const response=await fetch(`https://api.docuseal.com/submissions/${id}`,{
  method:expire?'PUT':'GET',headers:{'X-Auth-Token':key,'Content-Type':'application/json'},
  ...(expire?{body:JSON.stringify({expire_at:new Date(Date.now()-60000).toISOString()})}:{}),
  cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)
 });
 if(!response.ok)throw Error('Could not verify signing status.');
 return response.json();
}

export function cancellationView(accountId:string,userId:string,dealId:string) {
 return db<CancellationView>('rpc/icash_cancellation_preview','POST',{p_account:accountId,p_actor:userId,p_deal:dealId});
}

/** Called only after the database hold commits. All retries use the same document IDs. */
export async function reconcileCancellation(accountId:string,userId:string,id:string,deps={db,providerRequest}) {
 const [record]=await deps.db<{id:string;deal_id:string;state:string;snapshot:{id:string}[]}[]>(`icash_agreement_cancellations?id=eq.${id}&account_id=eq.${accountId}&select=id,deal_id,state,snapshot`);
 if(!record)throw Error('Cancellation unavailable.');
 if(record.state==='completed')return record.deal_id;
 for(const item of record.snapshot){
  const [envelope]=await deps.db<CancellationEnvelope[]>(`icash_signing_envelopes?id=eq.${item.id}&account_id=eq.${accountId}&deal_id=eq.${record.deal_id}&select=id,account_id,deal_id,kind,provider_id,state,test_mode,terms_hash,recipients`);
  if(!envelope)throw Error('Agreement history needs review.');
  let outcome:'expired'|'completed'|'error'='error',signed=false;
  try{
   // A creating request without its provider ID is ambiguous, never "unsent".
   if(!envelope.provider_id)throw Error('Signing request is still being located.');
   let evidence=cancellationEvidence(await deps.providerRequest(envelope.provider_id,envelope.test_mode),envelope);
   signed=evidence.signed;
   if(evidence.outcome==='active'){
    await deps.providerRequest(envelope.provider_id,envelope.test_mode,true);
    evidence=cancellationEvidence(await deps.providerRequest(envelope.provider_id,envelope.test_mode),envelope);
    signed=signed||evidence.signed;
   }
   if(evidence.outcome!=='active')outcome=evidence.outcome;
  }catch{/* The durable hold survives missing keys, timeouts, mismatched evidence and provider errors. */}
  await deps.db('rpc/icash_record_cancellation_check','POST',{p_account:accountId,p_actor:userId,p_id:id,p_envelope:envelope.id,p_provider:envelope.provider_id,p_outcome:outcome,p_signed:signed});
 }
 return record.deal_id;
}
