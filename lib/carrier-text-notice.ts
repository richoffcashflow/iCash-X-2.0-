/** A whole, attachment-free carrier notice, not a recipient's consent or reply.
 * Keep the original event/body unchanged. Quotes, mixed prose and unknown notices
 * do not match. Keep this predicate in parity with icash_is_carrier_text_notice. */
export function isCarrierTextNotice(body:unknown,attachments:unknown=[]):boolean{
 if(typeof body!=='string'||!Array.isArray(attachments)||attachments.length!==0)return false;
 const text=body.replace(/[ \t\n\r\f\v]+/g,' ').replace(/^ +| +$/g,'').replace(/[A-Z]/g,c=>c.toLowerCase());
 return /^free msg: receiver \+?[0-9]{10,15} unable to receive message - message blocking is active[.!]?$/.test(text);
}
