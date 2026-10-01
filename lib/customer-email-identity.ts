import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {titleEmailAddress} from './title-inbound-policy.ts';
import {emailFromName} from './deal-email-policy.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function customerMailDomain(value:unknown){if(typeof value!=='string')return '';const v=value.trim().toLowerCase();return v.length<=190&&/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v)?v:'';}
export function customerEmailDomains(env:NodeJS.ProcessEnv=process.env){const from=customerMailDomain(env.ICASH_CUSTOMER_EMAIL_DOMAIN),reply=customerMailDomain(env.ICASH_CUSTOMER_REPLY_DOMAIN||from);return env.ICASH_CUSTOMER_EMAIL_READY==='true'&&from&&reply&&env.RESEND_RECEIVING_WEBHOOK_SECRET?{from,reply}:null;}
function signature(id:string,secret:string){return createHmac('sha256',secret).update('customer-reply:v1:'+id).digest('hex').slice(0,24);}
export function customerEmailIdentity(accountId:string,principal:string,messageId:string,env:NodeJS.ProcessEnv=process.env){
 const domains=customerEmailDomains(env);if(!domains)return null;
 if(!uuid.test(accountId)||!uuid.test(messageId))throw Error('Invalid mail identity');
 const token=messageId.toLowerCase().replaceAll('-','');
 const account=createHash('sha256').update(accountId.toLowerCase()).digest('hex').slice(0,20);
 return {from:`${emailFromName(principal)} <contact-${account}@${domains.from}>`,replyTo:`r-${token}-${signature(token,env.RESEND_RECEIVING_WEBHOOK_SECRET!)}@${domains.reply}`};
}
/** Only one exact signed destination is accepted. A subject cannot override it. */
export function customerReplyReference(recipients:unknown,env:NodeJS.ProcessEnv=process.env){
 const domains=customerEmailDomains(env);if(!domains||!Array.isArray(recipients))return null;
 const matches=recipients.map(titleEmailAddress).filter(v=>v.endsWith('@'+domains.reply)&&v.startsWith('r-'));
 if(matches.length!==1)return null;
 const local=matches[0].split('@')[0],m=/^r-([0-9a-f]{32})-([0-9a-f]{24})$/.exec(local);if(!m)return null;
 if(!timingSafeEqual(Buffer.from(m[2]),Buffer.from(signature(m[1],env.RESEND_RECEIVING_WEBHOOK_SECRET!))))return null;
 const h=m[1];return {kind:'M' as const,id:`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`};
}
