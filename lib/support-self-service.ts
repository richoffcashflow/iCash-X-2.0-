import type {SupportEvidence} from './support-policy';

export type SupportNextStep = {action:'workspace'|'cancel'|'team'|'refresh';label:string;text:string};
export const supportCheckLabels:Record<string,string>={work:'Bot activity',credits:'Available credit',billing:'Earlier daily plans',subscription:'Software subscription',payments:'Credit purchases',readiness:'Service readiness',screening:'Property checks',voice:'Call results'};
export const supportPrompts=[
 {label:'My bot stopped',message:'Why did my bot stop working? What needs my attention?'},
 {label:'Account or charges',message:'Help me understand my payment records, available credit, and subscription renewals.'},
 {label:'Pause or cancel',message:'How do I pause my bot and stop future subscription renewals? What happens to my existing credit?'},
 {label:'Something else',message:'What I expected: \nWhat happened instead: \nWhat I already tried: '},
];
/** Fixed local controls only. No model text, stored detail or provider URL can create an action. */
export function supportNextStep(e:SupportEvidence):SupportNextStep|null{
 if(e.status==='unknown')return {action:'refresh',label:'Retry account checks',text:'Refresh status to try this check again. If it stays unavailable, ask the team; an unavailable check does not mean everything is working.'};
 switch(e.code){
  case 'paused':return {action:'workspace',label:'Review bot controls',text:'Open your workspace to review the pause. Resume only when you want new authorized work to run. If you did not pause it, ask the team before resuming.'};
  case 'no_available_credit':return {action:'workspace',label:'Review credit balance',text:'Review credit and held reservations in your workspace. Adding credit does not fix a service-readiness blocker or guarantee work will start.'};
  case 'renewal_active':return {action:'cancel',label:'Review cancellation',text:'Review cancellation if you want to pause new bot work and stop future subscription renewals. Nothing stops until you confirm and the result is verified.'};
  case 'renewal_stop_unconfirmed':return {action:'team',label:'Ask the team',text:'Ask the team to check the pending stop. Do not assume future renewals have stopped or start another checkout.'};
  case 'renewal_payment_failed':return {action:'team',label:'Ask the team',text:'Ask the team to review the failed payment before trying another checkout. A failure alone does not prove whether your bank has a pending charge.'};
  case 'checkout_pending':return {action:'refresh',label:'Refresh status',text:'Return from checkout and refresh status. Do not pay again just because a receipt is pending. Ask the team if it does not update.'};
  case 'payment_uncredited':return {action:'team',label:'Ask the team',text:'Ask the team to reconcile this recorded payment. Do not make another payment to replace missing credit.'};
  case 'no_payment_records':return {action:'team',label:'Ask the team',text:'If your bank shows a charge, describe the date and amount to the team. Never share a full card number. An absent account record is not proof that no charge occurred.'};
  case 'readiness_blocked':return {action:'team',label:'Ask the team',text:'The team needs to review the service checks. You do not need to configure provider accounts or add credit to clear these checks.'};
  case 'screening_review':return {action:'team',label:'Ask the team',text:'Ask the team to review the recorded property result. This help desk does not restart jobs or repeat provider actions.'};
  case 'voice_review':return {action:'team',label:'Ask the team',text:'Ask the team to review the recorded result. Repeating a paid check or call can create duplicate costs; this help desk will not retry it.'};
  default:return null;
 }
}
export function supportCheckTime(value:string){const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('en-US',{hour12:true}):'Time unavailable';}
