import {instantAddress} from './meta-instant-leads.ts';
import {getInstantLead,instantLeadsEnabled,queueInstantAddressLink,researchInstantAddress,processInstantLead} from './meta-instant-lead-service.ts';
import type {SellerDb} from './seller-pipeline.ts';
import {sellerResponseDisposition} from './seller-response-policy.ts';
type Deps={db:SellerDb;sms:(account:string,id:string)=>Promise<{status:string}>;voice:(account:string,id:string)=>Promise<{status:string}>;env:NodeJS.ProcessEnv;fetch?:typeof fetch};
export async function replyToInstantLeadText(d:Deps,eventId:string){
 if(!instantLeadsEnabled(d.env))return false;
 const scope=await d.db<{leadId:string;accountId:string;messageId:string;body:string;paused:boolean;declined:boolean;complete:boolean}|null>('rpc/icash_meta_text_context','POST',{p_event:eventId});
 if(!scope||scope.complete)return false;
 if(scope.paused||scope.declined||sellerResponseDisposition(scope.body))return true;
 const lead=await getInstantLead(d.db,scope.leadId);if(!lead)return true;
 const address=instantAddress.safeParse(scope.body);
 if(address.success){
  const saved=await d.db<{status:string}>('rpc/icash_meta_save_address','POST',{p_lead:scope.leadId,p_address:address.data,p_channel:'sms',p_evidence:'sms:'+scope.messageId});
  if(saved.status==='received'){
   await researchInstantAddress(d,scope.leadId);
   await processInstantLead(d,scope.leadId);
   return true;
  }
 }
 const reply=/\b(who|what company|real|robot|ai)\b/i.test(scope.body)?'HomeOffer AI: Your requested cash offer starts here: ':'HomeOffer AI: Street, city and state? Enter it here: ';
 await queueInstantAddressLink(d,lead,'reply',scope.messageId,reply);
 return true;
}
