import type {SupportContext,SupportReply} from './support-conversation.ts';

/** Capability is distinct from current admission, successful contact and repair. */
export function supportSellerCapabilityReply(context:SupportContext):SupportReply|null{
 const last=context.messages.findLastIndex(m=>m.role==='user');
 const q=(context.messages[last]?.content??'').trim();
 const direct=/^(?:so )?can (?:the|my) (?:bot|ai) (?:still )?(?:talk|speak|communicate) (?:to|with) (?:the )?sellers?(?:,? correct)?[?.!\s]*$/i.test(q);
 const short=/^(?:so )?(?:(?:can|does) it (?:still )?|it can (?:still )?)(?:talk|speak|communicate) (?:to|with) (?:the )?sellers?(?:,? correct)?[?.!\s]*$/i.test(q);
 const vip=/^(?:would|will) vip help\?\s*(?:(?:because )?i(?:[’']m| am) (?:still )?able to have my bot call(?: sellers?)?(?:,? correct)?|can my bot (?:still )?call sellers?)[?.!\s]*$/i.test(q);
 let inherited=false;
 if(short){
  const prior=context.messages.slice(0,last),boundary=prior.findLastIndex(m=>m.role==='operator');
  const previous=prior.slice(boundary+1).findLast(m=>m.role==='user')?.content??'';
  inherited=/\b(?:bot|ai)\b/i.test(previous)&&/\b(?:calls?|calling|talk|speak)\b/i.test(previous)&&!/\b(?:credits?|balance|payment|failed|broken|not|cannot|can[’']t|buyers?|title)\b/i.test(previous);
 }
 if(!direct&&!vip&&!(short&&inherited))return null;
 const paused=context.evidence?.some(e=>e.key==='work'&&e.code==='paused')||context.evidence?.some(e=>e.key==='outreach'&&e.outreach?.progress?.status==='paused');
 const state=paused?' Your bot is currently paused, so new automatic work stays paused.':' I cannot confirm a particular seller’s current call eligibility or successful contact from this feature answer. Run is not proof of activity.';
 return {reply:'Standard includes eligible seller calls and seller text conversations handled by the bot. VIP is not required for that, and upgrading does not establish a repair for missing research or seller replies.'+state+' Current access, credits, contact checks and calling hours still apply. This chat has not changed your controls, started work or confirmed a repair.',status:'open',ai:false};
}
