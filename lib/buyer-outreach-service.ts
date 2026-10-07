import {db} from '@/lib/stripe-test';
import {buyerPackageText} from './buyer-disposition.ts';
import {dispatchTextMessage} from './text-message-service';
/** Uses current recipient/channel checks; discovery alone never fabricates consent. */
export async function sendBuyerPackageTexts(accountId:string,dealId:string){
 if(process.env.ICASH_LIVE_WORK_READY!=='true')return {status:'live_work_not_ready',accepted:0};
 const link=await db<{url:string;askingPriceCents:number}|null>('rpc/icash_ensure_buyer_package','POST',{p_account:accountId,p_deal:dealId});
 if(!link)return {status:'buyer_package_unavailable',accepted:0};
 const threads=await db<{id:string}[]>('rpc/icash_buyer_package_text_targets','POST',{p_account:accountId,p_deal:dealId});
 let accepted=0,held=0;
 for(const thread of threads){
  const id=await db<string|null>('rpc/icash_queue_buyer_package_text','POST',{p_account:accountId,p_thread:thread.id,p_body:buyerPackageText(link.askingPriceCents,link.url)});
  if(!id){held++;continue;}
  const result=await dispatchTextMessage(accountId,id);
  if(result.status==='message_accepted')accepted++;
 }
 return {status:threads.length?'buyer_texts_processed':'buyer_texts_idle',accepted,held,canContinue:threads.length>0};
}
