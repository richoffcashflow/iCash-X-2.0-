type Database=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Dependencies={db:Database;dispatch:(account:string,message:string)=>Promise<{status:string}>};
/** Only the ordinary text dispatcher can spend or contact a buyer. A failed or
 * uncertain dispatch is never retried here; the next claim reads its original. */
export async function processBuyerCallPackages({db,dispatch}:Dependencies,env:NodeJS.ProcessEnv=process.env){
 if(env.VERCEL_ENV!=='production'||!smsWorkEnabled(env))return {status:'buyer_call_packages_disabled',checked:0,accepted:0,held:0,errors:0};
 let checked=0,accepted=0,held=0,errors=0;const seen=new Set<string>();
 for(let n=0;n<2;n++){
  let claim:{accountId:string;messageId:string}|null;
  try{claim=await db('rpc/icash_claim_buyer_call_package','POST',{});}catch{errors++;break;}
  if(!claim)continue;
  const key=claim.accountId+':'+claim.messageId;
  if(seen.has(key)){errors++;break;}seen.add(key);checked++;
  try{
   const result=await dispatch(claim.accountId,claim.messageId);
   if(['message_accepted','message_delivered'].includes(result.status))accepted++;
   else{held++;if(['message_delivery_needs_review','messaging_configuration_required','business_number_verification_required','inbound_invitation_not_ready'].includes(result.status))errors++;}
  }catch{errors++;}
 }
 return {status:errors?'buyer_call_packages_needs_review':'buyer_call_packages_checked',checked,accepted,held,errors};
}
import {smsWorkEnabled} from './live-work-admission.ts';
