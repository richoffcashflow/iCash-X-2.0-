import {createHash} from 'node:crypto';

/** The authenticated receiving API's timestamp is the original message time.
 * Webhook retry/delivery time never substitutes for it. Missing source evidence
 * preserves ordinary inbox review but cannot authorize document delivery. */
export function titleReplyOriginalSource(email:{created_at?:unknown;text?:unknown},eventId:string|null){
 const text=typeof email.text==='string'?email.text:null;
 const stamp=typeof email.created_at==='string'?email.created_at:'';
 const parsed=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(stamp)?Date.parse(stamp):NaN;
 const normalized=Number.isFinite(parsed)?new Date(parsed).toISOString():null;
 const providerReceivedAt=normalized?.slice(0,19)===stamp.slice(0,19)?normalized:null;
 const bodyComplete=text!==null&&text.length<=20000;
 return {
  providerReceivedAt,
  webhookEventId:typeof eventId==='string'&&eventId.length>0&&eventId.length<=200?eventId:null,
  bodyComplete,
  bodySha256:bodyComplete?createHash('sha256').update(text).digest('hex'):null,
 };
}
