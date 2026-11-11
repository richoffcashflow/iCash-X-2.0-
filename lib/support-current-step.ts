import type {SupportContext,SupportReply} from './support-conversation.ts';
import {currentAccessConversation} from './support-access-topic.ts';
import {supportCodeDelivery} from './support-code-delivery.ts';
import {hasRecordedAccessPaymentCheck,missingAccessCodeReply} from './support-access-reply.ts';
import {currentSupportIssue,supportRoutineGuidanceQuestion} from './support-reply-style.ts';
import {supportCustomVoiceReply} from './support-custom-voice.ts';
import {supportOfferCodeReply} from './support-checkout.ts';
import {supportPurchaseEmailCorrection} from './support-purchase-help.ts';

/** Source-backed answers to the customer's current step. Prior assistant text
 * supplies a topic only, never proof of payment, authority, delivery or a fix. */
export function supportCurrentStepReply(context:SupportContext):SupportReply|null{
 const users=context.messages.filter(turn=>turn.role==='user');
 const q=users.at(-1)?.content??'',prior=users.at(-2)?.content??'';
 const previous=context.messages.findLast(turn=>turn.role==='assistant'||turn.role==='operator')?.content??'';
 const issue=currentSupportIssue(context.messages);
 const answer=(reply:string,status:SupportReply['status']='open'):SupportReply=>({reply,status,ai:false});
 const guidance=(reply:string,status:SupportReply['status']='open'):SupportReply=>({...answer(reply,status),...(supportRoutineGuidanceQuestion(q)?{routineGuidance:true as const}:{})});
 if(/\b(?:refund|cancel|charged twice|duplicate charge|unrecognized charge)\b/i.test(q))return null;
 const pauseQuestion=(text:string)=>/^(?:should|can|could|how (?:do|can)) i pause (?:my |the )?(?:bot|ai|automation)[?!.\s]*$/i.test(text.trim());
 const questionIndex=context.messages.findLastIndex(turn=>turn.role==='user');
 const priorTurn=context.messages[questionIndex-1],priorQuestion=context.messages[questionIndex-2];
 const pauseFollowup=/^pause(?: (?:it|then))?[?!.\s]*$/i.test(q.trim())&&priorQuestion?.role==='user'&&pauseQuestion(priorQuestion.content)&&priorTurn?.role==='assistant';
 if(pauseQuestion(q)||pauseFollowup)return {...answer('If you want to stop new automatic work, choose Pause bot in the workspace. Work already started may still finish and its costs may settle. Pausing is not a repair for missing or delayed activity and does not cancel your software subscription. This chat has not changed your bot setting.'),routineGuidance:true};
 if(/^(?:should|do|must|would) i (?:need to |have to )?(?:upgrade to|buy|get) vip[?!.\s]*$/i.test(q.trim())){
  const active=context.kind==='account'&&context.evidence?.some(e=>e.key==='vip'&&e.source==='icash_vip_features_active'&&e.status==='ok'&&e.code==='vip_active');
  return {...answer((active?'Your current account already has VIP; you do not need to buy it again. ':'')+'Standard includes ordinary automated seller leads, calls, texts and support. VIP adds features such as Ask AI Bot, buyer-network access, custom voice, eligible lead priority and usage savings. Upgrading is not a verified repair for missing or delayed work and does not guarantee a lead, seller reply or closing.'),routineGuidance:true};
 }
 const offerCode=supportOfferCodeReply(context.messages);if(offerCode)return offerCode;

 // Payment details supplied during sign-in troubleshooting are not a question
 // about buying work credits. A missing receipt cannot be used for verification.
 const access=currentAccessConversation(context.messages);
 const missingReceipt=/\b(?:no|missing) (?:purchase |payment |email )?receipt\b|\b(?:didn[’']?t|did not|never|haven[’']?t|have not) (?:get|receive|received) (?:a |an |my |the )?(?:purchase |payment |email )?(?:receipt|email)\b/i.test(q);
 if(context.kind==='access'&&missingReceipt&&/\b(?:paid|purchase|payment|money|receipt)\b/i.test(q)){
  if(hasRecordedAccessPaymentCheck(context.messages))return missingAccessCodeReply(context.messages,context.accessInvestigation);
  const asked=context.messages.some(turn=>turn.role!=='user'&&/payment date and amount|date and amount.*(?:statement|receipt)/i.test(turn.content));
  const supplied=access.some(turn=>turn.role==='user'&&/\$\s*\d|\b\d+(?:\.\d{2})? dollars\b/i.test(turn.content));
  return {...answer('You haven’t received a purchase receipt, so I won’t ask you to check it. Don’t pay again. '+(supplied?'The payment details you shared still need to be matched to a purchase before access can be confirmed.':asked?'If no receipt arrived, the payment date and amount can come from your bank or card statement. Leave out card and account numbers.':'What payment date and amount appear on your bank or card statement? Leave out card and account numbers.'),supplied?'open':'waiting_on_customer'),...(supplied?{managementReview:true}:{})};
 }
 if(access.length&&supportCodeDelivery(access)==='missing'&&!supportPurchaseEmailCorrection(q)&&!/\b(?:name|where|link|address|url)\b.{0,35}\b(?:sign[ -]?in|log[ -]?in)\b/i.test(q)){
  return missingAccessCodeReply(context.messages,context.accessInvestigation);
 }
 if(context.kind==='access')return null;
 const customVoice=supportCustomVoiceReply(context);if(customVoice)return customVoice;

 // The manual composer availability read is not a worker dispatch receipt.
 // Keep a missing seller reply distinct from account-wide call/text totals.
 const sellerTextFailure=(text:string)=>/\b(?:bot|ai|software)\b.{0,55}\b(?:has not|hasn[’']t|did not|didn[’']t|never|not|isn[’']t)\b.{0,35}\b(?:texted|texting|sent|sending|replied|reply|responded|responding)\b/i.test(text)&&/\b(?:seller|text|texted|texting|message|reply)\b/i.test(text)&&!/\b(?:buyer|contract|agreement|sign[ -]?in)\b/i.test(text);
 const textAvailability=(text:string)=>/checking text availability/i.test(text);
 let missingText=false,checkingAvailability=false,propertyProvided=false;
 for(const turn of context.messages){
  if(turn.role==='operator'){missingText=false;checkingAvailability=false;propertyProvided=false;continue;}
  if(turn.role!=='user')continue;
  if(sellerTextFailure(turn.content)){missingText=true;continue;}
  if(textAvailability(turn.content)){checkingAvailability=true;continue;}
  if((missingText||checkingAvailability)&&/^\d{1,6}\s+[\w .'-]+\b(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|way|blvd|boulevard)\b(?:[,\n ]+[A-Za-z .'-]+,? [A-Z]{2}(?: \d{5}(?:-\d{4})?)?)?[.! ]*$/i.test(turn.content.trim())){propertyProvided=true;continue;}
  if(!/^(?:please|yes|ok(?:ay)?|what|why|so what (?:am i supposed to|should i) do|help check what(?:'s| is) happening next|is that why there(?:'s| is) no automatic response)[?!.\s]*$/i.test(turn.content.trim())){missingText=false;checkingAvailability=false;propertyProvided=false;}
 }
 if(missingText||checkingAvailability)return answer([
  missingText?'The missing automatic reply is still unresolved.':'',
  checkingAvailability?'“Checking text availability” describes the text composer’s availability check. It does not establish why an automatic reply is missing or whether a message was sent.':'',
  propertyProvided?'The property details you shared still need to be matched to its saved conversation and sending records. I haven’t confirmed the cause or a successful send.':missingText?'Which property is affected, and approximately when did you expect the reply? The specific property’s conversation and saved sending records need to be checked. A resolution note does not send the reply or fix its cause.':'Which property shows that message, and does it stay there when you open its Texts panel?'
 ].filter(Boolean).join(' '));

 const failure=/\b(?:error|failed|broken|blocked|stuck|missing|not working|not calling|not texting|not sending|cannot|can[’']?t|doesn[’']?t|won[’']?t)\b/i.test(q);
 if(/\bfollow[ -]?up\b/i.test(issue)&&/\bblocked\b/i.test(issue)&&!/\b(?:contact checks?|expired|refund|cancel)\b/i.test(issue))return answer('The follow-up is still blocked. A resolution note only records follow-up you actually completed; it does not restart outreach or clear the underlying contact checks. What reason is shown beside that blocked follow-up?');
 if(/\b(?:needs? you|review)\b/i.test(q)&&/\b(?:nothing|blank|not opening|not working|doesn[’']?t|won[’']?t)\b/i.test(q)&&(/\bneeds? you\b/i.test(q+' '+prior)||/\b(?:press|click|tap)\b/i.test(q))){
  return answer('The Review control should open the matching property or follow-up. If nothing opens, that is still a software issue. You can also open the property directly under Your leads and check its Texts or Calls. Which property is affected?');
 }
 if(!failure&&/\b(?:zip(?: code)?s?|cities|city|markets?|locations?)\b/i.test(q)&&/\b(?:all|same|only|every)\b/i.test(q)&&!/\b(?:phone|sign[ -]?in|verification|contract)\b/i.test(q)){
  return answer('Several leads can come from the same automatically selected market. There is no customer ZIP-code selector. That alone does not confirm why every lead in your list has the same ZIP; the property addresses need to be checked before calling it normal.');
 }
 if(!failure&&/\b(?:change|choose|select|set|switch|target)\b/i.test(q)&&/\blocation\b/i.test(q)&&!/\b(?:contract|agreement|sign[ -]?in|business address)\b/i.test(q))return guidance('The bot selects markets automatically. The current workspace has no city, state or ZIP-code selector.','resolved');
 if(!failure&&/\b(?:weekends?|saturdays?|sundays?)\b/i.test(q)&&/\b(?:bot|software|ai|work|run|research|outreach)\b/i.test(q))return guidance('Yes, the bot can work on weekends. Research can run overnight; new seller calls and first texts use 9 AM–9 PM in the seller’s known time zone, or Central Time if it is unknown.');
 if(!failure&&/\bhow (?:should|can|do) i (?:personally |manually )?(?:contact|reach out to|speak to|talk to) (?:the |a |an |my )?(?:seller|owner)\b/i.test(q)&&!/\b(?:no|without|unavailable|invalid|wrong|disconnected)\b/i.test(q))return guidance('Open the property, choose Take over, then Call or Texts to use the saved seller contact. You speak on the Call and write any manual text yourself. Contact availability and the app’s sending and calling checks still apply. Taking over pauses automatic follow-up on that property until you choose Return to bot; it does not send anything by itself.');
 if(!failure&&/\b(?:when|what time)\b/i.test(q)&&/\b(?:i|me)\b/i.test(q)&&/\b(?:call|contact|reach out|speak|talk)\b/i.test(q)&&/\b(?:sellers?|owners?|leads?)\b/i.test(q))return guidance('You can take over a lead when you want to handle the conversation yourself. Open the property, choose Take over, then Call or Texts. Calls must pass the app’s contact checks and calling window. Choose Return to bot when you want eligible automatic follow-up to resume.');
 const followup=/\b(?:follow[ -]?up|re[ -]?contact|reach out.{0,25}(?:again|same)|(?:contact|call|text).{0,25}(?:again|daily|every day)|how many times.{0,40}(?:reach|contact|call|text))\b/i.test(q);
 const followupContinuation=/^(?:so[, ]+)?(?:tomorrow|every day|daily|again|(?:do|should|can) i leave (?:it|that|this) alone|(?:will|does) (?:it|the bot) (?:do it|try|contact them|call them|text them) (?:again|tomorrow))[?!.\s]*$/i.test(q.trim())&&/\b(?:follow[ -]?up|re[ -]?contact|reach out|contacting|calling|texting)\b/i.test(prior+' '+previous);
 if(!failure&&(followup||followupContinuation)&&!/\b(?:support|management|title|buyers?|sign[ -]?in|code|resolution|contact checks?|expired|blocked|needs? you)\b/i.test(issue))return guidance('The bot can follow up automatically while the lead is under bot control and eligible. It does not contact every seller every day until they reply. Unanswered cold seller texts allow at most one follow-up 3–5 days after the first text; active conversations and requested callbacks have their own timing. If you took over, choose Return to bot to restore automatic control.');
 if(/\b(?:platform )?buyers? network\b/i.test(q)&&/\b(?:where|find|open|access|get into|see|locate)\b/i.test(q))return guidance('For VIP, Buyer network appears in the workspace when there is an active deal or a network response. It can be hidden before then, even with VIP active. Open that panel for network matches and package-email settings; a property’s Buyers section shows that deal’s buyer work.');
 const sellerName=/\bseller(?:[’']s)?(?: one| 1)? (?:full )?legal name\b|\bname\b.{0,25}\b(?:person who owns|property owner)\b/i.test(q);
 const nameFollowup=/^(?:do|can|should) i (?:put|enter|type|fill|add)(?: it| that| the name)?(?: in)?(?: manually| myself)?[?!.\s]*$/i.test(q.trim())&&/\bseller(?:[’']s)?(?: one| 1)? (?:full )?legal name\b/i.test(prior+' '+previous);
 if(!failure&&nameFollowup)return guidance('Yes. Enter or correct it in Send for signatures using the property owner’s legal name. Include every required seller and review the agreement before sending.');
 if(!failure&&sellerName)return guidance('Seller 1 legal name is the property owner’s legal name, not your name as the buyer. Enter or correct it in Send for signatures, add every required seller, and review the agreement before sending. Research may fill some details, but you still need to confirm they are correct.');
 const signing=/\b(?:how|when)\b.{0,50}\b(?:know|sign|signature)\b/i.test(q)&&/\b(?:contract|agreement)\b/i.test(q)&&/\b(?:i|myself|my signature)\b/i.test(q);
 const signingFollowup=/^(?:so[, ]+)?(?:i (?:have to|need to|should) wait(?: until they (?:do it|sign)(?: first)?)?|do i (?:have to )?wait(?: until they (?:do it|sign)(?: first)?)?|(?:they|the sellers?) sign first|they do it first)[?!.\s]*$/i.test(q.trim())&&/\b(?:sign|signature)\b/i.test(prior)&&/\b(?:contract|agreement)\b/i.test(prior)&&!failure;
 if(signingFollowup&&!/\b(?:assignment|cash buyer|buyer(?:’s|'s)? agreement)\b/i.test(q+' '+prior))return guidance('Yes, every required seller signs first. Then open Agreements → Review & sign and review the exact document before you sign.');
 if(!failure&&signing&&!/\b(?:assignment|cash buyer|buyer(?:’s|'s)? agreement)\b/i.test(q+' '+(signingFollowup?prior:'')))return guidance('For a purchase agreement, every required seller signs first. Your property’s Agreements section then shows Review & sign for you. Review the exact document before signing. Auto-sign applies only if you separately authorized that exact agreement; a seller’s verbal yes is not a signature.');
 if(!failure&&/\b(?:confirm|set|choose)\b/i.test(q)&&/\bseller(?:[’']s)? date\b/i.test(q))return answer('Do you mean the closing date for the agreement, or a date to call or visit the seller?');
 if(!failure&&/\b(?:tell|let|give|add|update)\b/i.test(q)&&/\b(?:ai|bot)\b/i.test(q)&&/\b(?:details|information|learned|my call)\b/i.test(q))return answer('Which details do you need to update: seller contact information, agreement terms, or something you learned on your call? A support message or resolution note does not automatically update the agreement or send a message to the seller.');
 if(!failure&&/\b(?:adjust|edit|change|put|set)\b/i.test(q)&&/\b(?:price|offer)\b/i.test(q)&&!/\b(?:subscription|vip|credits?|buyer|assignment)\b/i.test(q))return guidance('The bot calculates a supported offer. To edit an unsigned purchase agreement yourself, open the property, choose Take over, then Agreements → Edit agreement and update Purchase price. Use the seller-agreed terms. Editing a draft does not change an already-signed agreement.');
 if(/\b(?:leads?|properties)\b/i.test(q)&&/\b(?:disappear|disappeared|go after|gone|vanish)\b/i.test(q))return answer('Start with All activity under Your leads; a filtered view can hide older properties. The Today activity counters also reset at your local day boundary. Neither means a saved lead was deleted. If the property is missing from All activity too, that still needs review.');
 if(!failure&&/\b(?:how often|when|how long)\b/i.test(q)&&/\b(?:generate|find|arrive|appear|new)\b/i.test(q)&&/\b(?:leads?|listings|properties)\b/i.test(q))return guidance('New properties do not arrive on a fixed schedule. The bot searches automatically for eligible opportunities, but I can’t predict the next lead or guarantee a daily count.','resolved');
 return null;
}
