import type {SupportContext,SupportReply} from './support-conversation.ts';
import {supportVipUpgradeUrl} from './support-coaching.ts';

/** Explain existing customer controls. Chat never changes identity or buys VIP.
 * Match only a direct current request, so an old identity issue cannot override
 * an operator finding, successful result or a later topic. */
export function supportAccountDetailsReply(context:SupportContext):SupportReply|null{
 const raw=context.messages.findLast(turn=>turn.role==='user')?.content??'';
 const q=raw.replace(/\bv\.i\.p\.?/gi,'VIP');
 if(/\b(?:refund|cancel|duplicate charge|charged twice|seller|buyer|caller.?id|outbound|business number|bot.{0,20}number)\b/i.test(q))return null;
 if(/\b(?:don[’']?t|do not|no longer|already|successfully)\b.{0,25}\b(?:change|changed|update|updated)\b/i.test(q))return null;
 const phone=/\b(?:change|update|correct)\b.{0,25}\bmy (?:own |personal |account )?(?:phone(?: number)?|number)\b/i.test(q);
 const vip=/\bvip\b/i.test(q)&&/\blink\b/i.test(q);
 if(!phone&&!vip)return null;
 // Existing purchase/access routes retain ownership of a claimed VIP payment.
 if(!phone&&/\b(?:paid|purchased|bought|charged|missing|locked|not active)\b/i.test(q))return null;
 if(/\b(?:cannot|can[’']?t|unable|failed|error|won[’']?t|doesn[’']?t|not working)\b/i.test(q))return null;
 const parts:string[]=[];
 if(phone)parts.push('To change your own phone number, sign in with your account email, open the account menu → Settings → Account details, edit Phone, and select Save details. This chat has not changed your number.');
 if(vip){
  const check=context.kind==='account'?context.evidence?.find(e=>e.key==='vip'&&e.source==='icash_vip_features_active'&&e.status==='ok'):undefined;
  parts.push(check?.code==='vip_active'?'The current account check shows VIP is active, so you do not need to buy it again. Open your workspace to use its VIP features.':`To review VIP, sign in and open ${supportVipUpgradeUrl}. Opening the link does not purchase or activate VIP. If you already paid specifically for VIP, do not pay again; that purchase needs to be checked first.`);
 }
 return {reply:parts.join('\n\n'),status:'open',ai:false};
}
