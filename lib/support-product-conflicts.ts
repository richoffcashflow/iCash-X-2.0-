/** Source-backed contradictions observed in support. These are review/rejection
 * signals, never evidence of an account action, entitlement or completed work. */
export function supportProductConflict(reply:string,question=''){
 const sentences=reply.split(/(?<=[.!?])\s+|\n+/);
 return sentences.some(sentence=>{
  if(/\bSettings\b/i.test(sentence)&&/\b(?:enter|set|change|update|select)\b.{0,45}\b(?:phone|number)\b/i.test(sentence)&&/\b(?:bot|ai)\b.{0,30}\b(?:use|calling|texting|calls|texts)|\bfor (?:calling|texting|outbound)/i.test(sentence)&&!/\b(?:not|doesn[’']?t|cannot|can[’']?t)\b/i.test(sentence))return true;
  if(/\b(?:contact (?:info(?:rmation)?|details)|phone number)\b/i.test(sentence)&&/\b(?:will (?:appear|be found|show)|appears? later)\b/i.test(sentence)&&!/\b(?:not|no guarantee|cannot|can[’']?t)\b/i.test(sentence))return true;
  if(/\b(?:custom|cloned?) voice|voice preview/i.test(sentence)&&/\b(?:not supported|unsupported|no playback|(?:cannot|can[’']?t|won[’']?t be able to) play)\b/i.test(sentence)&&!/\b(?:currently|right now|until|because|failed|error|not ready|not active|standard accounts?|standard plan|without vip)\b/i.test(sentence))return true;
  if(/\b(?:voice|sound)\b/i.test(question+' '+sentence)&&/\b(?:no|not received|haven[’']?t received)\b.{0,35}\bfeedback\b/i.test(reply)&&/\b(?:likely not|is not|isn[’']?t|does not|doesn[’']?t)\b.{0,20}\b(?:scaring|scare|affect|affecting)\b/i.test(sentence))return true;
  if(/\b(?:bot|ai)\b/i.test(sentence)&&/\b(?:every (?:outreach )?day|daily|multiple times.{0,20}each day|keeps? (?:reaching out|contacting))\b/i.test(sentence)&&/\b(?:until|each lead|every seller)\b/i.test(sentence)&&!/\b(?:not|doesn[’']t|never)\b/i.test(sentence))return true;
  if(/\b(?:seller|legal name)\b/i.test(question)&&/\b(?:do not|don[’']t|cannot|can[’']t)\b.{0,35}\b(?:enter|edit|type|put)\b.{0,50}\b(?:name|manually)\b/i.test(sentence)&&!/\b(?:signed|already sent)\b/i.test(sentence))return true;
  if(/\b(?:bot|automation|outreach)\b.{0,50}\b(?:will|automatically)\b.{0,40}\b(?:resume|restart|start again)\b|\b(?:resume|restart|start again)\b.{0,40}\b(?:automatically|tomorrow|morning)\b/i.test(sentence)&&/\b(?:take ?over|took over|pauses?|paused|sending messages)\b/i.test(question)&&!/\b(?:does not|doesn[’']t|will not|won[’']t|until|Return to bot)\b/i.test(sentence))return true;
  if(/\b(?:assignment|wholesale) fee\b/i.test(sentence)&&/\b(?:cannot|can[’']t)\b.{0,25}\b(?:higher|more than|above)\b/i.test(sentence)&&/\b(?:default|target|those amounts)\b|\$(?:10|20),?000\b/i.test(sentence))return true;
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
