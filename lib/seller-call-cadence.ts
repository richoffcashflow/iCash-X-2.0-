/** Runtime delivery guidance only. Never change frozen provider policy inputs. */
export const sellerCallCadenceInstructions=`SELLER SPEAKING TURNS: Speak calmly; acknowledgments are optional. Answer first; ask one needed question, then wait. Let names, amounts and dates finish. If interrupted, yield, address the question/correction, then resume only the unfinished point. Clarify cut-off details; never restart the pitch. Silence or "uh-huh" alone is not consent or acceptance. Keep required disclosures and exact terms complete. Stop requests override resuming.`;

export function sellerCallCadencePrompt(prompt:string):string{
 return prompt.includes(sellerCallCadenceInstructions)?prompt:prompt+'\n'+sellerCallCadenceInstructions;
}

/** Intake and full seller calls only; retain limited/cancellation and buyer scope. */
export function outboundSellerCadencePrompt(prompt:string,context:{party:string;intake:boolean;limited:boolean;cancellation:boolean}):string{
 return context.party==='seller'&&!context.cancellation&&(context.intake||!context.limited)?sellerCallCadencePrompt(prompt):prompt;
}
