import type {SupportEvidence} from './support-policy.ts';

export const supportWorkspaceUrl='https://www.geticashx.com/';
export const supportVipUpgradeUrl='https://www.geticashx.com/?upgrade=vip';

// Deliberately narrow: product instructions and failures are support, not coaching.
const coaching=/\b(?:analy[sz]e|evaluat(?:e|ing)|underwrite|review)\b.{0,35}\b(?:deal|investment|offer)\b|\b(?:deal|investment)\s+(?:analysis|strategy|advice)\b|\b(?:strategy|advice)\b.{0,40}\b(?:deal|investment|wholesale)\b|\b(?:is|would)\b.{0,35}\b(?:good|profitable|worthwhile)\s+(?:deal|investment)\b|\b(?:what|how much)\b.{0,25}\b(?:should|would|can)\s+(?:i|you)\s+(?:offer|bid)\b|\b(?:what|how much)\b.{0,25}\b(?:should|would|can)\s+(?:i|you)\s+pay\b.{0,35}\b(?:house|property|deal|seller|investment)\b|\b(?:what offer should|maximum allowable offer|calculate (?:the |my )?(?:arv|mao))\b|\b(?:how|help me)\b.{0,25}\b(?:wholesale|wholesaling|negotiate|flip)\b|\b(?:wholesaling|negotiation|real estate)\s+(?:strategy|advice|coaching)\b|\b(?:help|advice|guidance)\b.{0,15}\b(?:with|on|about)\s+(?:this|my|a|the|these)\s+deals?\b|\bwhat do you think\b.{0,25}\bdeal\b|\b(?:should i|help me decide whether to)\s+(?:buy|sell|accept|counter|invest)\b/i;
const technical=/\b(?:bug|error|broken|blocked|stuck|blank|spinning|unavailable|unresponsive|not loading|not opening|not responding|never (?:loads?|opens?|responds?|works?)|fails?|failed|missing|not (?:working|loading|calling|texting|sending|opening|responding)|(?:will|does|did|can) not|isn[’']?t working|doesn[’']?t work|doesn[’']?t|isn[’']?t|didn[’']?t|won[’']?t|can[’']?t|cannot|sign.?in|log.?in|billing|upgrade|credits?|balance|funding|funds|payments?|paid|billed|charged|charges|refund|cancel|subscription|human|agent|escalat\w*|no calls|no texts|no leads)\b|\b(?:where|how)\b.{0,35}\b(?:open|click|view|download|upload|use|find the|access)\b|\b(?:button|screen|page|feature|in the app|in (?:my|the) workspace)\b|\b(?:offer|deal|analysis)\b.{0,35}\b(?:shown|displayed|recorded|sent|send|status)\b/i;
export function classifySupportCoaching(question:string){
 // Splitting keeps a coaching side-question out of technical diagnostics/model input.
 const parts=question.split(/(?<=[.!?;])\s+|\n+|,\s*(?=(?:what|how|where|why|my|i |the |can |help |please |analy[sz]e|review))|\s+(?:and|also|but)\s+(?=(?:what|how|where|why|my|i |the |can |help |please |analy[sz]e|review))/i).map(p=>p.trim()).filter(Boolean);
 const coachingParts=parts.filter(p=>coaching.test(p));
 if(!coachingParts.length)return {kind:'support' as const,technicalQuestion:question};
 const supportParts=parts.filter(p=>!coaching.test(p)||technical.test(p));
 // A failed deal-analysis feature is never itself a reason to upsell.
 if(coachingParts.every(p=>technical.test(p))&&!parts.some(p=>coaching.test(p)&&!technical.test(p)))return {kind:'support' as const,technicalQuestion:question};
 return {kind:supportParts.length?'mixed' as const:'coaching' as const,technicalQuestion:supportParts.join(' ')};
}

export function supportCoachingReferral(evidence:SupportEvidence[],question:string,authenticated:boolean){
 const vip=authenticated?evidence.find(e=>e.key==='vip'&&e.source==='icash_vip_features_active'):undefined;
 const intro='Support handles technical app help, not deal analysis or coaching.';
 if(vip?.status==='ok'&&vip.code==='vip_active')return `${intro} For your deal question, open ${supportWorkspaceUrl} and choose Ask AI Bot beside Your leads.`;
 // A reported entitlement problem needs help, not another purchase recommendation.
 if(/\b(?:already (?:have|paid for|bought)|i (?:have|paid for|bought)|i(?:[’']m| am)(?: already)?|my)\s+(?:a )?vip\b|\bvip\s+(?:is|was)\s+(?:active|enabled|paid)\b/i.test(question))return `${intro} Open ${supportWorkspaceUrl} and choose Ask AI Bot beside Your leads. If your VIP access is not recognized, tell us what appears so we can troubleshoot it here.`;
 if(vip?.status==='ok'&&vip.code==='vip_inactive')return `${intro} Ask AI Bot is a VIP feature. Review the VIP upgrade here: ${supportVipUpgradeUrl}. After VIP is active, choose Ask AI Bot beside Your leads.`;
 return `${intro} If you already have VIP, open ${supportWorkspaceUrl} and choose Ask AI Bot beside Your leads. Otherwise, you can review the VIP upgrade here: ${supportVipUpgradeUrl}. We can still help with technical or access problems here.`;
}

export const supportCoachingInstructions='Support provides technical app-use, access, billing and bug help, not deal analysis, offer-price recommendations, negotiation strategy or how-to-wholesale coaching. Do not provide business coaching. For coaching only, direct to Ask AI Bot in the workspace; VIP is required, but never assert membership from conversation or recommend an existing VIP member upgrade again. Do not paywall technical help or broken VIP features. For mixed requests answer the technical part and refer only the coaching part. Do not invent pricing, links, outcomes, repairs or handoffs. A coaching referral does not resolve or close an earlier issue.';
