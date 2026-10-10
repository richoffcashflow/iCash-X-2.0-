import {db} from '@/lib/stripe-test';
import {dealEmailConfigured,dispatchDealEmail} from './deal-email-service';

/** Reuses durable email records, current spend admission, receipt billing and suppressions. */
export async function processBuyerNetwork(accountId:string,dealId:string){
 if(process.env.ICASH_LIVE_WORK_READY!=='true')return {status:'live_work_not_ready',accepted:0,canContinue:false};
 if(!await db<boolean>('rpc/icash_vip_active','POST',{p_account:accountId}))return {status:'vip_required',accepted:0,canContinue:false};
 const added=await db<number>('rpc/icash_network_match_deal','POST',{p_account:accountId,p_deal:dealId});
 if(!dealEmailConfigured())return {status:'email_configuration_required',added,accepted:0,canContinue:false};
 const candidates=await db<{id:string}[]>('rpc/icash_network_email_targets','POST',{p_account:accountId,p_deal:dealId});
 let accepted=0,attempted=0;
 for(const match of candidates){
  if(attempted>=3)break;
  try{
   const id=await db<string|null>('rpc/icash_network_queue_email','POST',{p_account:accountId,p_match:match.id});
   if(!id)continue;
   attempted++;
   if((await dispatchDealEmail(accountId,id)).status==='email_accepted')accepted++;
  }catch{attempted++;} // One held buyer must not stop the other eligible packages.
 }
 return {status:accepted?'network_packages_processed':'network_matches_saved',added,accepted,canContinue:accepted===3};
}
