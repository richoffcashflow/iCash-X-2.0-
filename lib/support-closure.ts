import type {SupportEvidence} from './support-policy.ts';
import {refundDeliverySummary} from './support-refund-evidence.ts';

type Turn={role:string;content:string};
const abuse=/\b(?:fuck(?:ing|er)?|shit|bullshit|damn|asshole|bitch)\b|\bf\*+k(?:ing)?\b|\bs\*+t\b/i;
const normalize=(text:string)=>text.toLowerCase().replace(/\bf\*+k(?:ing)?\b/g,'fuck').replace(/\bs\*+t\b/g,'shit').replace(/[’']/g,'').replace(/[^a-z\s]/g,' ').replace(/\s+/g,' ').trim();
const filler=/\b(?:i|im|me|my|a|an|the|please|pls|just|still|really|want|need|would|like|give|refund|money|back|now|no|yes|but|you|your|can|could|will|do|dont|care|understand|that|it|is|this|all|only|asking|for|to|have|said|again|get|send|fuck|fucking|fucker|shit|bullshit|damn|asshole|bitch|off|are|scam)\b/g;
// Intentionally narrow: extra facts, cancellation requests and payment/access
// problems must not become a refund-only closure just because "refund" appears.
export function refundOnly(text:string){
 if(/[0-9$€£@]/.test(text))return false;
 const normalized=normalize(text);
 if(!/\b(?:refund|money back)\b/.test(normalized)||/\b(?:dont|do not|not|no longer)\b.{0,35}\b(?:refund|money back)\b/.test(normalized))return false;
 const rest=normalized.replace(filler,'').trim();
 return !rest;
}
function abuseOnly(text:string){return abuse.test(text)&&!/[0-9$€£@]/.test(text)&&!normalize(text).replace(filler,'').trim();}
export function refundEvidenceNeeded(messages:Turn[]){
 const latest=messages.at(-1);
 return latest?.role==='user'&&(/\b(?:refund|money back)\b/i.test(latest.content)||abuseOnly(latest.content)&&messages.some(m=>m.role==='user'&&/\b(?:refund|money back)\b/i.test(m.content)));
}

/** Fixed policy, never a model's decision to silence an unresolved complaint. */
export function repeatedRefundReply(messages:Turn[],evidence:SupportEvidence[]=[]){
 const latest=messages.at(-1);
 if(latest?.role!=='user'||!(refundOnly(latest.content)||abuseOnly(latest.content)&&refundEvidenceNeeded(messages)))return null;
 if(evidence.some(e=>e.status!=='ok'&&['membership_payments','payments','subscription','billing'].includes(e.key)))return null;
 // A known unresolved issue stays open even if the latest turn only says refund.
 let start=0;
 for(let i=0;i<messages.length-1;i++)if(messages[i].role==='user'&&/^(?:that worked|it worked|working now|fixed now|problem solved)[.!\s]*$/i.test(messages[i].content.trim()))start=i+1;
 const turns=messages.slice(start);
 if(turns.some(m=>m.role==='user'&&!refundOnly(m.content)&&!abuseOnly(m.content)&&! /^(?:hi|hello|hey|thanks|thank you)[.!\s]*$/i.test(m.content.trim())))return null;
 const explanations=turns.filter(m=>(m.role==='assistant'||m.role==='operator')&&/all sales are final|refund policy|don.t offer refunds|cannot offer a refund|can.t offer a refund/i.test(m.content));
 if(explanations.length<1)return null;
 const warned=explanations.some(m=>/I.ll close this chat|I.m closing this chat/i.test(m.content));
 const abusive=abuse.test(latest.content);
 const accepted=evidence.some(e=>e.key==='refund_case'&&e.refundCase?.policyAcceptanceRecorded===true);
 const final=[abusive?'Please keep messages respectful.':'',accepted?'Your saved purchase record confirms you accepted the all-sales-final policy.':'All sales are final under our refund policy.',refundDeliverySummary(evidence),'This is our final response to this refund request, and I’m closing this chat. If you have a payment error, access or software problem, cancellation request, or new information, reply here to reopen it.'].filter(Boolean).join(' ');
 return warned||abusive
  ?{reply:final,status:'closed' as const,ai:false}
  :{reply:'I understand you want your money back. Our refund policy hasn’t changed. If there’s a payment or software problem, tell me what happened so I can help. Otherwise, I’ll close this chat if the same request continues.',status:'waiting_on_customer' as const,ai:false};
}
