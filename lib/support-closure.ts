import type {SupportEvidence} from './support-policy.ts';

type Turn={role:string;content:string};
// Intentionally narrow: extra facts, cancellation requests and payment/access
// problems must not become a refund-only closure just because "refund" appears.
export function refundOnly(text:string){
 if(/[0-9$€£@]/.test(text))return false;
 const normalized=text.toLowerCase().replace(/[’']/g,'').replace(/[^a-z\s]/g,' ').replace(/\s+/g,' ').trim();
 if(!/\b(?:refund|money back)\b/.test(normalized)||/\b(?:dont|do not|not|no longer)\b.{0,35}\b(?:refund|money back)\b/.test(normalized))return false;
 const rest=normalized.replace(/\b(?:i|im|me|my|a|an|the|please|pls|just|still|really|want|need|would|like|give|refund|money|back|now|no|yes|but|you|your|can|could|will|do|dont|care|understand|that|it|is|this|all|only|asking|for|to|have|said|again|get|send)\b/g,'').trim();
 return !rest;
}

/** Fixed policy, never a model's decision to silence an unresolved complaint. */
export function repeatedRefundReply(messages:Turn[],evidence:SupportEvidence[]=[]){
 const latest=messages.at(-1);
 if(latest?.role!=='user'||!refundOnly(latest.content))return null;
 if(evidence.some(e=>e.status!=='ok'&&['membership_payments','payments','subscription','billing'].includes(e.key)))return null;
 // A known unresolved issue stays open even if the latest turn only says refund.
 let start=0;
 for(let i=0;i<messages.length-1;i++)if(messages[i].role==='user'&&/^(?:that worked|it worked|working now|fixed now|problem solved)[.!\s]*$/i.test(messages[i].content.trim()))start=i+1;
 const turns=messages.slice(start);
 if(turns.some(m=>m.role==='user'&&!refundOnly(m.content)&&! /^(?:hi|hello|hey|thanks|thank you)[.!\s]*$/i.test(m.content.trim())))return null;
 const explanations=turns.filter(m=>(m.role==='assistant'||m.role==='operator')&&/all sales are final|refund policy|don.t offer refunds|cannot offer a refund|can.t offer a refund/i.test(m.content));
 if(explanations.length<1)return null;
 const warned=explanations.some(m=>/I.ll close this chat|I.m closing this chat/i.test(m.content));
 return warned
  ?{reply:'I’ve explained the refund policy, so I’m closing this chat for now. If you have a payment error, trouble using the software, or new details, reply here to reopen it.',status:'closed' as const,ai:false}
  :{reply:'I understand you want your money back. Our refund policy hasn’t changed. If there’s a payment or software problem, tell me what happened so I can help. Otherwise, I’ll close this chat if the same request continues.',status:'waiting_on_customer' as const,ai:false};
}
