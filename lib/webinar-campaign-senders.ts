import {z} from 'zod';
import {db} from '@/lib/stripe-test';
const responseSchema=z.object({data:z.object({numbers:z.array(z.object({number:z.object({e164:z.string().regex(/^\+[1-9]\d{7,14}$/)}),lease_status:z.string(),capabilities:z.object({channels:z.array(z.string())})})).max(1000)})});
export function campaignTextNumbers(value:unknown){return [...new Set(responseSchema.parse(value).data.numbers.filter(n=>n.lease_status==='active'&&n.capabilities.channels.includes('sms')).map(n=>n.number.e164))];}
export async function syncCampaignTextNumbers(database=db,transport=fetch,env=process.env){
 if(!env.CONTIGUITY_API_KEY)throw Error('Contiguity is not connected.');
 const response=await transport('https://api.contiguity.com/numbers/leased',{headers:{Authorization:`Token ${env.CONTIGUITY_API_KEY}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Could not verify Contiguity numbers. Your existing senders are unchanged.');
 const numbers=campaignTextNumbers(await response.json());
 const current=await database<{phone:string;enabled:boolean;preferred:boolean}[]>('icash_webinar_text_senders?select=phone,enabled,preferred');
 for(const phone of numbers){if(current.some(s=>s.phone===phone))await database(`icash_webinar_text_senders?phone=eq.${encodeURIComponent(phone)}`,'PATCH',{verified_at:new Date().toISOString()});else await database('icash_webinar_text_senders','POST',{phone});}
 // No deletion or silent reactivation. Removed leases stop sending until verified again.
 for(const sender of current.filter(s=>s.enabled&&!numbers.includes(s.phone)))await database(`icash_webinar_text_senders?phone=eq.${encodeURIComponent(sender.phone)}`,'PATCH',{enabled:false});
 return {activeNumbers:numbers,senders:await database<{phone:string;enabled:boolean;preferred:boolean}[]>('icash_webinar_text_senders?select=phone,enabled,preferred&order=phone')};
}
