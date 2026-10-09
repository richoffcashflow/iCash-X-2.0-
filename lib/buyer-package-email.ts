import {createHash} from 'node:crypto';
import {db} from '@/lib/stripe-test';
import {dealEmailConfigured,dispatchDealEmail} from './deal-email-service';
import {dealTermsSchema} from './deal-documents';
/** Only fulfill an explicit buyer request; no scraped email blast or repeated package sends. */
export async function sendRequestedBuyerPackages(accountId:string,dealId:string){
 if(process.env.ICASH_LIVE_WORK_READY!=='true')return {status:'live_work_not_ready',accepted:0};
 if(!dealEmailConfigured())return {status:'buyer_email_configuration_required',accepted:0};
 const [[account],[deal],[authority],contacts,[rate]]=await Promise.all([
  db<{owner_user_id:string;bot_paused:boolean}[]>(`icash_accounts?id=eq.${accountId}&select=owner_user_id,bot_paused`),
  db<{terms:unknown;stage:string;screening_id:string}[]>(`icash_deal_files?id=eq.${dealId}&account_id=eq.${accountId}&select=terms,stage,screening_id`),
  db<{purchase_envelope_id:string;asking_price_cents:number;expires_at:string}[]>(`icash_disposition_authorities?deal_id=eq.${dealId}&account_id=eq.${accountId}&select=purchase_envelope_id,asking_price_cents,expires_at`),
  db<{contact_key:string;email:string;party:string}[]>('rpc/icash_deal_email_contacts','POST',{p_account:accountId,p_deal:dealId}),
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
 const money=(v:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v/100);
 const subject=`Requested buyer package: ${t.address}`.replace(/[\r\n]/g,' ').slice(0,180);
 const body=`Here are the property details you requested.\n\nBuyer package: ${link.url}\n\nProperty: ${t.address}\nContract interest offered for assignment.\nBuyer asking price, including our fee and before closing costs: ${money(authority.asking_price_cents)}\nBuyer deposit: ${t.assignmentDepositCents===null?'To be agreed in writing':money(t.assignmentDepositCents)}\nClosing: ${t.closingDate||'Date to be confirmed'}\n\nBuyer pays legally allocable closing and title-company fees under the signed agreements. Any non-refundable deposit provisions and exceptions must be agreed in writing. Verify property condition, value and title independently.\n\nReply with your questions or a preferred showing time. Access must be confirmed before visiting. Reply if you no longer want updates about this deal.`;
 let accepted=0;
 for(const c of contacts.filter(c=>c.party==='buyer'&&c.contact_key.startsWith('buyer-request:')).slice(0,3)){
  // One package per buyer email and purchase agreement, even if they request it twice.
  const hex=createHash('sha256').update(`${accountId}:${dealId}:${signed.id}:${c.email.toLowerCase()}`).digest('hex');
  const key=`${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
  const prior=await db<{id:string;state:string;subject:string;body_text:string}[]>(`icash_deal_emails?account_id=eq.${accountId}&request_key=eq.${key}&select=id,state,subject,body_text`);
  if(prior.length){if(prior[0].state==='ready'&&prior[0].subject===subject&&prior[0].body_text===body&&(await dispatchDealEmail(accountId,prior[0].id)).status==='email_accepted')accepted++;continue;}
  const id=await db<string>('rpc/icash_queue_deal_email','POST',{p_account:accountId,p_actor:account.owner_user_id,p_deal:dealId,p_contact:c.contact_key,p_key:key,p_subject:subject,p_body:body,p_rate:rate.id});
  if((await dispatchDealEmail(accountId,id)).status==='email_accepted')accepted++;
 }
 return {status:'buyer_packages_processed',accepted};
}
