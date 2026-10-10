import type {WorkspaceProperty, WorkspaceEvidence} from '../components/workspace-view.ts';
import {needsAttention} from '../components/workspace-view.ts';

type Context = WorkspaceEvidence & {
 callbacks: {screening_id: string; due_at: string; timezone: string; state: string}[];
 conversations: {screening_id: string; party: string; summary?: string; completed_at?: string}[];
};
export type BotState = {label: string; tone: 'green' | 'amber' | 'gray'; detail: string};
/** A green dot means this property can be bot-managed, never that a call is happening. */
export function propertyBotStatus(input: {manual: boolean; paused: boolean; available: boolean; stale: boolean; attention: boolean; stage?: string; practice: boolean}): BotState {
 if(input.practice) return {label: 'Practice', tone: 'gray', detail: 'Example only. No live work.'};
 if(input.stale) return {label: 'Checking status', tone: 'amber', detail: 'Refresh to confirm the latest bot status.'};
 if(['closed','canceled','cancelled'].includes(input.stage ?? '')) return {label: input.stage === 'closed' ? 'Completed' : 'Stopped', tone: 'gray', detail: 'No new work is expected for this property.'};
 if(input.stage==='cancellation_pending') return {label:'Cancellation pending',tone:'gray',detail:'Automatic work is paused until cancellation is resolved.'};
 if(input.manual) return {label: 'You’re in control', tone: 'gray', detail: 'New automatic work is paused for this property.'};
 if(input.attention) return {label: 'Needs you', tone: 'amber', detail: 'A saved request needs your attention.'};
 if(input.paused) return {label: 'AI paused', tone: 'gray', detail: 'Your account’s bot is paused.'};
 if(!input.available) return {label: 'AI waiting', tone: 'amber', detail: 'Waiting for setup, credits or the next eligible task.'};
 return {label: 'AI active', tone: 'green', detail: 'Bot-managed. Each next action follows your current setup and budget.'};
}

export type DealSection='contracts'|'fulfillment'|'coordination'|'cancellation'|'attention';
export function propertyNextAction(property: WorkspaceProperty, work: Context):{detail:string;label:string|null;target:DealSection|null} {
 const deal = work.deals.find(item => item.screening_id === property.id);
 const action=(detail:string,label:string|null=null,target:DealSection|null=null)=>({detail,label,target});
 if(deal?.stage === 'cancellation_pending') return action('Complete the cancellation review. Automatic work is paused.','Review cancellation','cancellation');
 if(deal?.stage === 'closed') return action('Review the closing record and confirm your payment arrived.','Review closing record','fulfillment');
 if(['canceled','cancelled'].includes(deal?.stage??'')) return action('This deal is stopped. Review its saved agreements and any remaining obligations.','Review agreements','contracts');
 if(work.signing.some(s=>s.deal_id===deal?.id&&s.state==='customer_signature_needed'))return action('The other party signed. Read the agreement and complete your signature.','Review & sign','contracts');
 if(work.handoffs.some(h=>h.screening_id===property.id&&h.state==='open'))return action('A seller or buyer asked for a person. Read the request and follow up.','Review request','attention');
 const closing=work.closingReview?.find(c=>c.screening_id===property.id);
 if(closing?.review_reason&&closing.review_reason!=='setup')return action('Resolve the closing issue with the title office. Property automation is paused.','Review closing issue','fulfillment');
 if(work.viewingRequests?.some(v=>v.screening_id===property.id))return action('A buyer needs a response. Review their request, follow up and record the outcome.','Review buyer request','attention');
 if(work.closingTasks?.some(t=>t.screening_id===property.id))return action('Review the closing tasks. Confirm dates from the signed agreement or respond to the title office.','Review closing tasks','fulfillment');
 if(closing)return action('Choose your title company and save how you want to receive your proceeds.','Set up closing','fulfillment');
 if(needsAttention(property.id, work)) return action('Read the saved request and complete the action it asks for.','Review request','attention');
 const callback = work.callbacks.find(item => item.screening_id === property.id && ['pending','scheduled','ready','held_for_human'].includes(item.state));
 if(callback) return action('Check the saved callback time below before the next conversation.');
 if(deal && ['closing','under_contract','buyer_selected','assigned','buyer_matched','purchase_signed','assignment_signed','title_open'].includes(deal.stage)) return action('Open buyer and closing progress to see what needs your attention and what is waiting on title.','Open buyers & closing','fulfillment');
 if(property.result.financialCheck.status !== 'eligible') return action('Review the property numbers before discussing an offer.');
 return action('Check the seller conversation for their interest, price and repair needs. Requests needing your decision appear in Needs your review.');
}
export function propertyNextMove(property:WorkspaceProperty,work:Context){return propertyNextAction(property,work).detail;}

/** Rank saved evidence, not forecast earnings or inferred seller interest. */
export function mostPromisingProperty(properties: WorkspaceProperty[], work: Context) {
 const candidates = properties.filter(property => {
  const stage = work.deals.find(item => item.screening_id === property.id)?.stage;
  return property.result.financialCheck.status === 'eligible' && !['closed','canceled','cancelled','cancellation_pending'].includes(stage ?? '') && !property.result.property.propertyId.startsWith('practice_');
 });
 const score = (property: WorkspaceProperty) => {
  const deal = work.deals.find(item => item.screening_id === property.id);
  return (work.signing.some(item => item.deal_id === deal?.id && item.state === 'completed' && !item.test_mode) ? 100 : 0)
   + (needsAttention(property.id, work) ? 20 : 0)
   + (work.conversations.some(item => item.screening_id === property.id && item.party === 'seller' && item.summary) ? 10 : 0);
 };
 return [...candidates].sort((a,b) => score(b)-score(a))[0]?.id ?? null;
}
