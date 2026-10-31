/** Customer product policy. The owner's private demonstration form is separate. */
export const supportLeadImportPolicy='Customer accounts cannot add, upload or import their own leads, including CSV lists. Your bot finds and works eligible seller leads automatically, and they appear in Leads.';

export function supportLeadImportQuestion(text:string){
 const match=text.match(/\b(?:add|adding|upload(?:ing)?|import(?:ing)?|enter(?:ing)?|bring(?:ing)?|put(?:ting)? in|post(?:ing)?|creat(?:e|ing))\b.{0,55}?\b(?:leads?|listings?|propert(?:y|ies)|seller lists?|csv)\b|\b(?:my|our|own) (?:leads?|seller lists?)\b.{0,40}\b(?:add|upload|import|enter|bring|put)\b/i)?.[0];
 return !!match&&!/\b(?:photos?|pictures?|images?|videos?|contracts?|agreements?|receipts?|notes?|phone numbers?)\b/i.test(match);
}

export function supportMissingSellerContactQuestion(text:string){
 if(/\b(?:my|your|checkout|settings|profile|sign[ -]?in) (?:phone|number|contact)\b/i.test(text))return false;
 return /\b(?:no|none|missing|blank|without)\b.{0,65}\b(?:phone|numbers?|contacts?|contact info(?:rmation)?)\b|\b(?:numbers?|contacts?|contact info(?:rmation)?)\b.{0,40}\b(?:missing|blank|not (?:saved|listed|showing|available)|unavailable)\b/i.test(text);
}
