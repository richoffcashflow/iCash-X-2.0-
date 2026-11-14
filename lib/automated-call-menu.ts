/** A complete prerecorded three-option menu, not a caller's request. Anchors
 * deliberately reject any added live speech, especially an explicit opt-out.
 * Mirrored by icash_call_is_automated_menu; never apply this to SMS. */
export const automatedCallMenuPattern=String.raw`^\s*if you would like to speak with a representative,\s*press (?:one|1)[.!]\s*if you would like to hang up,\s*press (?:two|2)[.!]\s*if you would like to be placed on [a-z0-9 &'’\-]{1,80}do not call list,\s*press (?:three|3)[.! ]*\s*$`;
const automatedMenu=new RegExp(automatedCallMenuPattern,'i');
export function isAutomatedCallMenu(message:string){return automatedMenu.test(message);}
