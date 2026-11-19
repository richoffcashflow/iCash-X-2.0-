import type {SupportContext,SupportReply} from './support-conversation.ts';

/** Explicit setup guidance does not establish actual work or repair. */
export function supportRunControlsReply(context:SupportContext):SupportReply|null{
 const q=(context.messages.findLast(m=>m.role==='user')?.content??'').trim();
 const guidance=(reply:string):SupportReply=>({reply,status:'open',ai:false,routineGuidance:true});
 if(/^(?:(?:what(?:'s| is)|where(?:'s| is)|can i (?:get|have)) (?:the |a )?(?:link|url|website) (?:to|for) i\s?cash\s?x(?:\s*2(?:\.0)?)?)[?.!\s]*$/i.test(q)){
  return guidance('Open https://geticashx.com and sign in with the email attached to your iCash X account.');
 }
 if(/^(?:does|will|can) (?:my |the |this )?(?:bot|ai|software|i\s?cash\s?x) (?:still |keep |continue to )?(?:runs?|running|work|working) (?:even )?(?:if|when|while) (?:my |the )?(?:computer|laptop|phone) (?:is |is turned |is switched )?off[?!.\s]*$/i.test(q)){
  return guidance('Yes. You can turn your computer off. Automatic work runs on the server when your bot is enabled, has available work credits and has eligible work.');
 }
 if(/^(?:(?:will|does) (?:this|it|the bot|my bot) (?:keep calling|call again|retry) (?:ones|sellers?|leads?|numbers?) (?:that|who) (?:have not|haven.t|did not|didn.t) (?:picked? up|pick up|answer(?:ed)?)|(?:yes[, ]+)?can i get (?:a )?f[ao]llow[ -]?up on (?:the|my) calls)[?.!\s]*$/i.test(q)){
  return guidance('Yes. After an unanswered call, the bot can automatically retry an eligible seller and send a follow-up text. A seller who opts out gets no further outreach. Open the property’s call and text history to see which attempts actually happened.');
 }
 if(!/^(?:how (?:do|can) i (?:get (?:my|the) bot to (?:run|start)|turn on (?:my|the) bot)|(?:begin|start) searching for leads)[?!.\s]*$/i.test(q))return null;
 return {reply:'Open your workspace and look at the bot controls. If you see Add money to start, open it to review the work-credit amounts; work credits are separate from the software subscription. If Run bot is displayed, select it when you want to allow new automatic work. Run is a control setting, not proof of activity or a guarantee of leads. Current access, credits and other eligibility checks still apply. This chat has not changed your setting or confirmed recovery of an earlier problem.',status:'open',ai:false};
}
