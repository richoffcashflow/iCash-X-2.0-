/** Customer product policy. The owner's private demonstration form is separate. */
export const supportLeadImportPolicy='Customer accounts cannot add, upload or import their own leads, including CSV lists. Your bot finds and works eligible seller leads automatically, and they appear in Leads.';

export function supportLeadImportQuestion(text:string){
 const match=text.match(/\b(?:add|adding|upload(?:ing)?|import(?:ing)?|enter(?:ing)?|bring(?:ing)?|put(?:ting)? in|post(?:ing)?|creat(?:e|ing))\b.{0,55}?\b(?:leads?|listings?|propert(?:y|ies)|seller lists?|csv)\b|\b(?:my|our|own) (?:leads?|seller lists?)\b.{0,40}\b(?:add|upload|import|enter|bring|put)\b/i)?.[0];
 return !!match&&!/\b(?:photos?|pictures?|images?|videos?|contracts?|agreements?|receipts?|notes?|phone numbers?|money|credits?|dollars)\b|\$\s*\d/i.test(match);
}

export function supportMissingSellerContactQuestion(text:string){
 if(/\b(?:my|your|checkout|settings|profile|sign[ -]?in) (?:phone|number|contact)\b/i.test(text))return false;
 // Keep the negative attached to the contact noun. "No agreement ... five
 // numbers called" is a contract/call result, not missing phone information.
 const contact='(?:phone(?!\\s+(?:calls?|verification|codes?))(?: numbers?)?|numbers?|contacts|contact (?:info(?:rmation)?|details))';
 const modifiers='(?:(?:any|a|the|usable|saved|listed|available|seller|owner|contact)\\s+){0,4}';
 return new RegExp('\\b(?:no|missing|blank|without|not any|not a single)\\s+'+modifiers+contact+'\\b','i').test(text)
  || new RegExp('\\bnone of (?:(?:these|those|the|my|our) )?(?:leads|properties|sellers|owners) (?:have|show|list) '+modifiers+contact+'\\b','i').test(text)
  || new RegExp('\\b'+contact+'\\s+(?:(?:is|are|was|were|still|all|just)\\s+){0,3}(?:missing|blank|unavailable|not (?:saved|listed|showing|available|there|found))\\b','i').test(text)
  || new RegExp('\\b'+contact+'\\s+(?:isn[’\']t|aren[’\']t|wasn[’\']t|weren[’\']t) (?:saved|listed|showing|available|there|found)\\b','i').test(text);
}
