import {confirmedCallAddress,hashLeadToken} from './meta-instant-leads.ts';
import {getInstantLead,instantLeadsEnabled,queueInstantAddressLink,researchInstantAddress} from './meta-instant-lead-service.ts';
import type {SellerDb} from './seller-pipeline.ts';
type Context={leadId:string;accountId:string;screeningId:string;state:string;address:string|null;complete:boolean};
type Deps={db:SellerDb;sms:(account:string,id:string)=>Promise<{status:string}>;voice:(account:string,id:string)=>Promise<{status:string}>;bind:(token:string,conversationId:string)=>Promise<void>;history:()=>Promise<unknown>;env:NodeJS.ProcessEnv;fetch?:typeof fetch};
/** Return null only when this is an ordinary, already researched property call.
 * All new-address actions remain bound to the authenticated live call. */
export async function instantCallAddress(token:string,input:Record<string,unknown>,d:Deps){
 if(!instantLeadsEnabled(d.env))return null;
 if(typeof input.conversationId!=='string'||!/^conv_[A-Za-z0-9]+$/.test(input.conversationId))return null;
 const context=()=>d.db<Context|null>('rpc/icash_meta_call_context','POST',{p_hash:hashLeadToken(token),p_conversation:input.conversationId});
 let scope=await context();
 if(!scope){
  // Avoid any extra provider request for an ordinary property call. A saved
  // recording capability, not the model's lead ID, identifies the intake.
  const recordings=await d.db<{screening_id:string}[]>(`icash_call_recordings?stop_token_hash=eq.${hashLeadToken(token)}&select=screening_id&limit=1`);
  const inbound=!recordings.length?await d.db<boolean>('rpc/icash_meta_inbound_call_pending','POST',{p_hash:hashLeadToken(token)}):false;
  if(!recordings.length&&!inbound)return null;
  const leads=recordings.length?await d.db<{lead_id:string}[]>(`icash_meta_leads?screening_id=eq.${recordings[0].screening_id}&select=lead_id&limit=1`):[];
  if(!leads.length&&!inbound)return null;
  await d.bind(token,input.conversationId);scope=await context();
 }
 if(!scope||scope.complete)return null;
 const fallback=async(reason:string,instruction:string)=>{
  const lead=await getInstantLead(d.db,scope!.leadId);
  const text=lead?await queueInstantAddressLink(d,lead,'address_link','call-fallback'):null;
  return {quoteAllowed:false,priceCents:null,status:reason,addressRequired:true,textAccepted:text?.status==='message_accepted',instruction:instruction+' '+(text?.status==='message_accepted'?'The address link was accepted for sending to the same phone. Ask them to open it and confirm the full address.':'Do not claim a text was sent. Ask them to check the earlier address link or try the form from their ad completion screen.')};
 };
 if(input.action==='report_change'){
  const address=confirmedCallAddress(input.sellerStatement,await d.history());
  if(!address)return {quoteAllowed:false,priceCents:null,status:'address_confirmation_required',instruction:'Ask for the full street, city and two-letter state. Read the complete address back once and wait for explicit confirmation. Then report_change with that exact address. If speech cannot establish the address, get_offer returns the form-link fallback.'};
  const saved=await d.db<{status:string}>('rpc/icash_meta_save_address','POST',{p_lead:scope.leadId,p_address:address,p_channel:'call',p_evidence:'conversation:'+input.conversationId});
  if(saved.status==='unavailable'||saved.status==='review_required')return fallback('lookup_review','The saved lookup needs review. Do not repeat the paid request or invent an offer.');
  await researchInstantAddress(d,scope.leadId,{liveCall:true});
  const fresh=await context();
  if(fresh?.complete)return {quoteAllowed:false,status:'property_found',instruction:'The property was matched and saved to this same lead. Now use get_offer. Follow its outstanding qualification questions, then present only the exact server-authorized price.'};
  return fallback('lookup_pending_or_unmatched','The address is saved, but a cash offer is not ready. Explain the lookup could not be completed on this call.');
 }
 if(scope.state==='received'){
  await researchInstantAddress(d,scope.leadId,{liveCall:true});
  const fresh=await context();if(fresh?.complete)return {quoteAllowed:false,status:'property_found',instruction:'The property is now matched. Use get_offer once, then follow its qualification and price instructions.'};
 }
 return fallback('address_or_research_required','No researched property is available yet. Do not quote a price, negotiate or prepare an agreement.');
}
