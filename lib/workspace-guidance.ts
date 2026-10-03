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
 if(['closed','canceled'].includes(input.stage ?? '')) return {label: input.stage === 'closed' ? 'Completed' : 'Stopped', tone: 'gray', detail: 'No new work is expected for this property.'};
 if(input.manual) return {label: 'You’re in control', tone: 'gray', detail: 'New automatic work is paused for this property.'};
 if(input.attention) return {label: 'Needs you', tone: 'amber', detail: 'A saved request needs your attention.'};
 if(input.paused) return {label: 'AI paused', tone: 'gray', detail: 'Your account’s bot is paused.'};
 if(!input.available) return {label: 'AI waiting', tone: 'amber', detail: 'Waiting for setup, credits or the next eligible task.'};
 return {label: 'AI active', tone: 'green', detail: 'Bot-managed. Each next action follows your current setup and budget.'};
}

export function propertyNextMove(property: WorkspaceProperty, work: Context) {
 const deal = work.deals.find(item => item.screening_id === property.id);
 if(deal?.stage === 'closed') return 'Review the closing record and final documents.';
 if(deal?.stage === 'canceled') return 'This deal is stopped. Its history is saved here.';
 if(needsAttention(property.id, work)) return 'Review the request below so this property can move forward.';
 const callback = work.callbacks.find(item => item.screening_id === property.id && ['pending','scheduled','ready','held_for_human'].includes(item.state));
 if(callback) return 'Check the saved callback time before the next conversation.';
 if(deal?.stage === 'closing') return 'Track title, signatures and the closing requirements.';
 if(deal && ['under_contract','assigned','buyer_matched','purchase_signed','assignment_signed','title_open'].includes(deal.stage)) return 'Keep the buyer and title work moving toward closing.';
 if(property.result.financialCheck.status !== 'eligible') return 'Review the property numbers before discussing an offer.';
 return 'Confirm the seller’s interest, price and repair needs.';
}

/** Rank saved evidence, not forecast earnings or inferred seller interest. */
export function mostPromisingProperty(properties: WorkspaceProperty[], work: Context) {
 const candidates = properties.filter(property => {
  const stage = work.deals.find(item => item.screening_id === property.id)?.stage;
  return property.result.financialCheck.status === 'eligible' && !['closed','canceled'].includes(stage ?? '') && !property.result.property.propertyId.startsWith('practice_');
 });
 const score = (property: WorkspaceProperty) => {
  const deal = work.deals.find(item => item.screening_id === property.id);
  return (work.signing.some(item => item.deal_id === deal?.id && item.state === 'completed' && !item.test_mode) ? 100 : 0)
   + (needsAttention(property.id, work) ? 20 : 0)
   + (work.conversations.some(item => item.screening_id === property.id && item.party === 'seller' && item.summary) ? 10 : 0);
 };
 return [...candidates].sort((a,b) => score(b)-score(a))[0]?.id ?? null;
}
