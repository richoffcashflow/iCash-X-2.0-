import type {SupportContext,SupportReply} from './support-conversation.ts';

/** Explicit setup guidance does not establish actual work or repair. */
export function supportRunControlsReply(context:SupportContext):SupportReply|null{
 const q=(context.messages.findLast(m=>m.role==='user')?.content??'').trim();
 if(!/^(?:how (?:do|can) i (?:get (?:my|the) bot to (?:run|start)|turn on (?:my|the) bot))[?!.\s]*$/i.test(q))return null;
 return {reply:'Open your workspace and look at the bot controls. If you see Add money to start, open it to review the work-credit amounts; work credits are separate from the software subscription. If Run bot is displayed, select it when you want to allow new automatic work. Run is a control setting, not proof of activity or a guarantee of leads. Current access, credits and other eligibility checks still apply. This chat has not changed your setting or confirmed recovery of an earlier problem.',status:'open',ai:false};
}
