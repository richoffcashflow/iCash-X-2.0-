import {db} from '@/lib/stripe-test';
import {pendingCounterpartySigningLink} from '@/lib/signing-service';
import {dispatchTextMessage} from '@/lib/text-message-service';
/** Only a provider-verified pending signer can receive the exact approved agreement. */
export async function textPendingContract(accountId:string,envelopeId:string,phone:string){
 const link=await pendingCounterpartySigningLink(accountId,envelopeId,phone);
 const id=await db<string>('rpc/icash_queue_contract_text','POST',{p_account:accountId,p_envelope:envelopeId,p_signer:link.signerId,p_phone:phone,p_body:`Review your contract: ${link.url}`});
 const [message]=await db<{state:string;provider_id:string|null}[]>(`icash_text_messages?id=eq.${id}&account_id=eq.${accountId}&select=state,provider_id`);
 if(message?.provider_id&&['accepted','delivered'].includes(message.state))return {sent:true,status:message.state,instruction:message.state==='delivered'?'The text delivery was confirmed. Invite them to review the contract.':'The text was accepted by the provider. Ask whether it arrived; do not claim delivery is confirmed.'};
 const result=await dispatchTextMessage(accountId,id);
 return result.status==='message_accepted'?{sent:true,status:'accepted',instruction:'The contract text was accepted by the provider. Ask whether it arrived; the seller must review and sign for themselves.'}:{sent:false,status:'held',instruction:'The contract text is not confirmed. Explain that it needs follow-up; do not retry or claim it was sent.'};
}
