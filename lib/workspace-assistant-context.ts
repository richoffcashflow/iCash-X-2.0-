import {db} from '@/lib/stripe-test';
import {validActivityReport,type ActivityDays} from './activity-report';
import {currentBotActivity} from './bot-activity';
import {analysisMoney,propertyAnalysisView} from './property-analysis-view';
import {dealCardSummary} from './deal-card-summary';
import type {AssistantContext} from './workspace-assistant-policy';
type Property={id:string;result:{property:{address:string;propertyId:string};financialCheck?:{status:string}}};
type Deal={id:string;screening_id:string;stage:string;terms:{priceCents:number|null;practice?:boolean}};
export async function workspaceAssistantContext(accountId:string,timezone:string,question:string,screeningId?:string):Promise<AssistantContext>{
 const days:ActivityDays=/30\s*days|month/i.test(question)?30:/7\s*days|week/i.test(question)?7:1;
 const address=question.match(/\b(\d{1,6}\s+[a-z][a-z'-]{2,40})\b/i)?.[1];
 const propertyQuery=screeningId?`icash_screening_jobs?account_id=eq.${accountId}&id=eq.${screeningId}&state=eq.complete&select=id,result&limit=1`:address?`icash_screening_jobs?${new URLSearchParams({account_id:'eq.'+accountId,state:'eq.complete',select:'id,result','result->property->>address':`ilike.*${address}*`,limit:'7'})}`:null;
 const [accounts,wallets,report,allProperties,tickets,screening,...attention]=await Promise.all([
  db<{bot_paused:boolean}[]>(`icash_accounts?id=eq.${accountId}&select=bot_paused&limit=1`),
  db<{balance_cents:number;reserved_cents:number}[]>(`icash_wallets?account_id=eq.${accountId}&select=balance_cents,reserved_cents&limit=1`),
  db<unknown>('rpc/icash_activity_report','POST',{p_account:accountId,p_days:days,p_timezone:timezone}),
  propertyQuery?db<Property[]>(propertyQuery):db<Property[]>('rpc/icash_prioritized_work','POST',{p_account:accountId,p_page:0}),
  db<{kind:string;state:string;expires_at:string}[]>(`icash_automation_tickets?account_id=eq.${accountId}&state=eq.consumed&expires_at=gt.${new Date().toISOString()}&select=kind,state,expires_at&order=created_at.desc&limit=10`),
  db<{state:string;lease_until:string|null}[]>(`icash_screening_jobs?account_id=eq.${accountId}&state=eq.running&select=state,lease_until&limit=10`),
  db<{message_id:string}[]>(`icash_sms_route_reviews?account_id=eq.${accountId}&resolved_at=is.null&select=message_id&limit=1`),
  ...[['icash_buyer_viewing_requests','needs_confirmation'],['icash_text_attention','open'],['icash_seller_gaps','needs_review'],['icash_closing_setup','needs_review'],['icash_handoffs','open'],['icash_sms_call_requests','needs_review'],['icash_signing_envelopes','customer_signature_needed']].map(([table,state])=>db<{id:string}[]>(`${table}?account_id=eq.${accountId}&state=eq.${state}&select=id&limit=1`))
 ]);
 if(!accounts[0]||!wallets[0]||!validActivityReport(report,days))throw Error('CONTEXT_UNAVAILABLE');
 if(screeningId&&!allProperties.length)throw Error('PROPERTY_NOT_FOUND');
 const properties=allProperties.slice(0,6),ids=properties.map(p=>p.id).join(',');
 const [deals,conversations]=ids?await Promise.all([
  db<Deal[]>(`icash_deal_files?account_id=eq.${accountId}&screening_id=in.(${ids})&select=id,screening_id,stage,terms`),
  db<{screening_id:string;summary:string|null}[]>(`icash_live_conversations?account_id=eq.${accountId}&screening_id=in.(${ids})&state=eq.complete&party=eq.seller&select=screening_id,summary:result->>summary&order=completed_at.desc&limit=12`)
 ]):[[],[]];
 const envelopes=deals.length?await db<{deal_id:string;kind:string;state:string;test_mode:boolean}[]>(`icash_signing_envelopes?account_id=eq.${accountId}&deal_id=in.(${deals.map(d=>d.id).join(',')})&select=deal_id,kind,state,test_mode`):[];
 const activity=currentBotActivity({paused:accounts[0].bot_paused,tickets,screening});
 return {checkedAt:activity.checkedAt,report,paused:accounts[0].bot_paused,balanceCents:Math.max(0,wallets[0].balance_cents-wallets[0].reserved_cents),task:activity.label,active:activity.active,needsYou:attention.some(rows=>rows.length>0),selectedId:screeningId??(address&&properties.length===1?properties[0].id:null),hasMore:allProperties.length>6,properties:properties.map(p=>{
  const view=propertyAnalysisView(p.result),deal=deals.find(d=>d.screening_id===p.id),summary=dealCardSummary(deal,envelopes);
  return {id:p.id,address:p.result.property.address,offer:analysisMoney(view.cashOfferCeilingCents),arv:analysisMoney(view.arvCents),repairs:analysisMoney(view.repairs.baselineCents),fee:analysisMoney(view.calculation?.feeCents??null),currentCalculation:!!view.calculation,stage:summary?.status??'Property researched',next:summary?.nextAction??'Review the numbers and confirm the seller’s interest, price, and repair needs.',summary:conversations.find(c=>c.screening_id===p.id&&c.summary)?.summary?.slice(0,700)??null,practice:p.result.property.propertyId.startsWith('practice_')||deal?.terms.practice===true};
 })};
}
