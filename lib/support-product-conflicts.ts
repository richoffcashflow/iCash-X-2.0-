/** Source-backed contradictions observed in support. These are review/rejection
 * signals, never evidence of an account action, entitlement or completed work. */
export function supportProductConflict(reply:string,question=''){
 const sentences=reply.split(/(?<=[.!?])\s+|\n+/);
 return sentences.some(sentence=>{
  if(/\b(?:does not|doesn[’']t|cannot|can[’']t|never)\s+(?:automatically\s+)?(?:use|access|pull from|integrate with)\s+deal\s*machine\b/i.test(sentence))return true;
  if(/\b(?:credits?|usage)\b.{0,25}\bonly\b.{0,50}\b(?:calls?|texts?|contacting|reaching out|outreach)\b|\bonly (?:uses?|spends?|charges?) credits?\b.{0,50}\b(?:calls?|texts?|contacting|reaching out|outreach)\b/i.test(sentence)&&!/\b(?:research|data|property lookup)\b/i.test(sentence))return true;
  if(/\b(?:assignment|wholesale) fee\b.{0,70}\b(?:included|shown|written|listed|added)\b.{0,35}\b(?:seller|purchase) (?:agreement|contract)\b/i.test(sentence)&&!/\b(?:not|isn[’']t|never)\b/i.test(sentence))return true;
  const voiceDenied=/\b(?:bot|ai|iCash\s*x|icashx|software|platform)\b.{0,35}\b(?:does not|doesn[’']t|cannot|can[’']t|never)\s+(?:automatically\s+)?(?:make\s+(?:automatic\s+|automated\s+)?calls?|call|phone)\b/i.test(sentence);
  // Buyer outbound calls are intentionally unsupported. A current failure is
  // different from incorrectly claiming the product has no seller calling.
  if(voiceDenied&&!/\b(?:buyers?|title|currently|right now|until|because|blocked|paused|available credits?|usable number|verified)\b/i.test(sentence)&&(!/\bbuyers?\b/i.test(question)||/\bsellers?\b/i.test(sentence)))return true;
  if(/\b(?:cash offer|offer price)\b.{0,45}\b(?:is|considered)\s+(?:always\s+)?final\b/i.test(sentence)&&!/\b(?:signed|accepted|not|isn[’']t)\b/i.test(sentence))return true;
  if(/\b(?:you (?:must|need to|have to)|only)\b.{0,40}\b(?:manually (?:send|submit)|(?:send|submit) manually)\b.{0,65}\btitle\b/i.test(sentence)&&/\b(?:outside|not supported|doesn[’']t|does not)\b/i.test(reply))return true;
  return false;
 });
}
