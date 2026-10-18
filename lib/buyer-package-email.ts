import {db} from '@/lib/stripe-test';
import {dealEmailConfigured,dispatchDealEmail} from './deal-email-service';
import {dealTermsSchema} from './deal-documents';
/** Only fulfill an explicit buyer request; no scraped email blast or repeated package sends. */
export async function sendRequestedBuyerPackages(accountId:string,dealId:string){
 if(process.env.ICASH_LIVE_WORK_READY!=='true')return {status:'live_work_not_ready',accepted:0};
 if(!dealEmailConfigured())return {status:'buyer_email_configuration_required',accepted:0};
 const [[account],[deal],[authority],[rate]]=await Promise.all([
  db<{owner_user_id:string;bot_paused:boolean}[]>(`icash_accounts?id=eq.${accountId}&select=owner_user_id,bot_paused`),
  db<{terms:unknown;stage:string;screening_id:string}[]>(`icash_deal_files?id=eq.${dealId}&account_id=eq.${accountId}&select=terms,stage,screening_id`),
  db<{purchase_envelope_id:string;asking_price_cents:number;expires_at:string}[]>(`icash_disposition_authorities?deal_id=eq.${dealId}&account_id=eq.${accountId}&select=purchase_envelope_id,asking_price_cents,expires_at`),
  db<{id:string}[]>(`icash_operation_rates?operation=eq.manual_email&enabled=eq.true&expires_at=gt.${new Date().toISOString()}&select=id&order=verified_at.desc&limit=1`),
 ]);
 if(!account||account.bot_paused||!deal||!['under_contract','buyer_selected','title_open','closing'].includes(deal.stage)||!authority||Date.parse(authority.expires_at)<=Date.now()||!rate)return {status:'buyer_package_held',accepted:0};
 const t=dealTermsSchema.parse(deal.terms);
 if(t.priceCents===null||t.assignmentFeeCents===null||authority.asking_price_cents!==t.priceCents+t.assignmentFeeCents)return {status:'buyer_package_terms_required',accepted:0};
 const [signed]=await db<{id:string}[]>(`icash_signing_envelopes?id=eq.${authority.purchase_envelope_id}&account_id=eq.${accountId}&deal_id=eq.${dealId}&kind=eq.purchase&state=eq.completed&test_mode=eq.false&select=id`);
 const [screen]=await db<{snapshot:{propertyId:string}}[]>(`icash_screening_jobs?id=eq.${deal.screening_id}&account_id=eq.${accountId}&select=snapshot`);
 if(!signed||!screen)return {status:'buyer_package_held',accepted:0};
 const manual=await db<unknown[]>(`icash_property_controls?account_id=eq.${accountId}&property_id=eq.${screen.snapshot.propertyId}&manual=eq.true&select=property_id`);
 if(manual.length)return {status:'buyer_package_held',accepted:0};
 const link=await db<{url:string}|null>('rpc/icash_ensure_buyer_package','POST',{p_account:accountId,p_deal:dealId});
 if(!link)return {status:'buyer_package_unavailable',accepted:0};
 const content=await db<{subject:string;email:string}|null>('rpc/icash_buyer_outreach_content','POST',{p_account:accountId,p_deal:dealId});
 if(!content)return {status:'buyer_package_unavailable',accepted:0};
 const subject=content.subject,body=content.email;
 // SQL removes completed/uncertain sends and duplicate email requests before
 // applying the batch limit, retaining the original deterministic request key.
 const targets=await db<{contact_key:string;email:string;request_key:string;message_id:string|null}[]>('rpc/icash_buyer_package_email_targets','POST',{p_account:accountId,p_deal:dealId});
 let accepted=0,held=0;
 for(const c of targets){
  try{
   const id=c.message_id??await db<string>('rpc/icash_queue_deal_email','POST',{p_account:accountId,p_actor:account.owner_user_id,p_deal:dealId,p_contact:c.contact_key,p_key:c.request_key,p_subject:subject,p_body:body,p_rate:rate.id});
   if((await dispatchDealEmail(accountId,id)).status==='email_accepted')accepted++;else held++;
  }catch{held++;} // Keep other requested packages moving; never rearm a send.
 }
 return {status:targets.length?'buyer_packages_processed':'buyer_packages_idle',accepted,held,canContinue:targets.length===3};
}
