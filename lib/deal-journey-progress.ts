import type {DealSection} from './workspace-guidance.ts';
import {blockerNext,type JourneyBlocker} from './deal-completion.ts';
export type JourneyProgress={requestId?:string;blocker?:JourneyBlocker|null;id:string;deal_id:string;screening_id:string;state:string;wants_assignment:boolean;wants_viewing:boolean;review_reason:string|null;deposit_due_at:string|null;last_progress_at:string;envelopeState:string|null;messageReview:boolean;hasSlots:boolean;showingState:string|null;titleState:string|null;titleSelected:boolean;closingKind:string|null};
export function journeyNextAction(j:JourneyProgress,now=Date.now()):{waitingOn:string;detail:string;label:string;target:DealSection}{
 const step=(waitingOn:string,detail:string,label:string,target:DealSection)=>({waitingOn,detail,label,target});
 if(j.messageReview)return step('You','A deal message was not confirmed. Review delivery before sending again.','Review messages','coordination');
 if(j.blocker){const next=blockerNext[j.blocker.kind];return step(j.blocker.kind==='access'?'Seller':'You',next.detail,next.title,'coordination');}
 if(j.state==='needs_review')return step('You',j.review_reason??'Review this buyer request to keep the deal moving.','Review buyer progress','coordination');
 if(j.envelopeState==='customer_signature_needed')return step('You','The buyer signed. Review and sign the assignment.','Review & sign','contracts');
 if(j.state==='deposit_due')return step('Buyer',`The assignment is signed. ${j.deposit_due_at&&Date.parse(j.deposit_due_at)<now?'The deposit is due. ':''}Give the buyer verified receiving instructions and confirm cleared receipt.`,'Confirm deposit receipt','coordination');
 if(j.state==='reserved'){
  if(j.closingKind==='funds_disbursed')return step('You','Title reported proceeds sent. Confirm the money arrived.','Review payment','fulfillment');
  if(!j.titleSelected)return step('You','The buyer’s deposit is verified. Choose and verify the closing office.','Set up title','fulfillment');
  if(j.titleState==='needs_review')return step('You','The title opening request needs delivery review.','Review title request','fulfillment');
  return step('Title',j.closingKind==='closed'?'Closing is recorded. Waiting for title to confirm disbursement.':j.closingKind==='closing_scheduled'?'Title confirmed the closing date. Check for any documents still needed.':'The property is reserved. Follow title’s file, document and closing updates.','Open closing progress','fulfillment');
 }
 if(j.state==='signing')return step('Buyer','The assignment is prepared. Waiting for the buyer’s verified signature.','View assignment','contracts');
 if(['ready','sending'].includes(j.state))return step('Bot','Buyer details are saved. The assignment is being prepared from the agreed terms.','View buyer progress','coordination');
 if(Date.parse(j.last_progress_at)<now-3*86400000)return step('You','The buyer has not progressed after the scheduled follow-ups. Contact them to decide the next step.','Review buyer progress','coordination');
 if(j.wants_assignment)return step('Buyer','Waiting for the buyer’s legal name and signing details. Follow-ups are automatic.','View buyer progress','coordination');
 if(j.showingState==='confirmed')return step('Buyer & seller','The visit is confirmed. Reminders and changes are tracked automatically.','View visit','coordination');
 if(j.showingState==='proposed')return step('Buyer & seller','A specific visit is proposed. Waiting for both parties to confirm.','View visit','coordination');
 if(j.wants_viewing&&!j.hasSlots)return step('Seller','Waiting for seller viewing availability. The buyer will receive the available options.','View availability','coordination');
 return step('Buyer','Seller viewing options are available. Waiting for the buyer to choose a time.','View visit','coordination');
}
