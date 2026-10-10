import {z} from 'zod';

const clean=(minimum=0)=>z.string().trim().min(minimum).max(200).refine(v=>!/[\r\n]/.test(v),'Use one line.');
const noBankData=(v:string)=>!/(?:\b(?:routing|account|ssn|social security|tax id)\s*(?:number|#|:)|\b\d{9,}\b)/i.test(v);
export const payoutPreferenceSchema=z.object({
 payeeName:clean(2).refine(noBankData,'Enter only the legal payee name.'),
 payeeType:z.enum(['individual','company']),
 method:z.enum(['check_pickup','check_mail','wire']),
 mailingAddress:z.string().trim().max(500).refine(noBankData,'Give banking and tax details directly to your closer.'),
 detailsSharedWithTitle:z.boolean(),
}).strict().superRefine((v,c)=>{
 if(v.method==='check_mail'&&v.mailingAddress.length<10)c.addIssue({code:z.ZodIssueCode.custom,message:'Enter the check delivery address.'});
 if(v.method!=='check_mail'&&v.mailingAddress)c.addIssue({code:z.ZodIssueCode.custom,message:'A mailing address is only needed for a mailed check.'});
});
export const titleProposalSchema=z.object({
 company:clean(2),closer:clean(),
 email:z.union([z.literal(''),z.string().trim().email().max(254)]),
 phone:z.union([z.literal(''),z.string().regex(/^\+[1-9]\d{7,14}$/,'Use the country code, for example +12145551234.')]),
}).strict();
export const closingSetupInput=z.discriminatedUnion('action',[
 z.object({action:z.literal('payout'),dealId:z.string().uuid(),data:payoutPreferenceSchema}).strict(),
 z.object({action:z.literal('title_preference'),dealId:z.string().uuid(),data:titleProposalSchema}).strict(),
 z.object({action:z.literal('confirm_title'),dealId:z.string().uuid(),data:z.object({revision:z.string().min(1),independentContact:z.literal(true),assignmentsAndCoverage:z.literal(true),agreedByParties:z.literal(true)}).strict()}).strict(),
 z.object({action:z.literal('takeover'),dealId:z.string().uuid(),data:z.object({reason:z.enum(['human_requested','title_declined','payment_change','title_issue'])}).strict()}).strict(),
]);
export type PayoutPreference=z.infer<typeof payoutPreferenceSchema>;
export type TitleProposal=z.infer<typeof titleProposalSchema>;
export type ClosingSetupRecord={id:string;deal_id:string;screening_id:string;state:'needs_review'|'acknowledged'|'ready';review_reason:string;payout:PayoutPreference|null;title_proposal:TitleProposal|null;updated_at:string};
export type ClosingDirectoryOption={id:string;name:string;source_url:string;public_phone:string|null;public_email:string|null;status:string};
export type ClosingSetupView={setup:ClosingSetupRecord|null;verifiedContact:{email:string}|null;directory:ClosingDirectoryOption[];buyerSuggestions:{id:string;title_quote:string}[];titleEmailInAgreement:string|null};

export const closingReviewLabels:Record<string,string>={setup:'Prepare title and your payment',human_requested:'Closing needs a person',title_declined:'Title cannot handle this file',payment_change:'Payment instructions need verification',title_issue:'Title or contract issue needs review'};
export function closingSetupNext(view:ClosingSetupView){
 if(view.setup?.review_reason&&view.setup.review_reason!=='setup')return {code:'human_review',text:'A person needs to resolve this with the closer. Property automation stays paused until you return control.'};
 if(!view.verifiedContact){
  if(view.setup?.title_proposal||view.buyerSuggestions.length)return {code:'verify_preference',text:'Confirm the suggested company handles assignments in this county. Verify the closer using the company’s official phone number before selecting them.'};
  if(view.directory.length)return {code:'review_directory',text:'Review a local title candidate below. A directory listing is not confirmation that the office accepts this deal.'};
  return {code:'research_required',text:'No current title candidate covers this property. Find a local title or closing attorney through their official website, then confirm assignment handling and county coverage. No paid search runs here.'};
 }
 if(!view.setup?.payout)return {code:'payout_preference',text:'Choose the legal payee and how you want title to send your proceeds.'};
 if(!view.setup.payout.detailsSharedWithTitle)return {code:'secure_details',text:view.setup.payout.method==='wire'?'Give the verified closer your bank name, account holder, routing and account numbers through their secure process. Confirm by calling their independently verified number.':'Confirm the check payee and pickup or mailing arrangements directly with your closer.'};
 return {code:'title_confirmation_pending',text:'Your payment preference is saved and you reported sharing the details. Title still needs to approve the payee, final settlement amount and disbursement timing.'};
}

/** Title receives preferences, never bank credentials, tax IDs or an implied payment authorization. */
export function closingPayoutNote(raw:unknown){
 const p=payoutPreferenceSchema.safeParse(raw);if(!p.success)return '';
 const v=p.data,method={check_pickup:'check for pickup',check_mail:'mailed check',wire:'wire through your secure process'}[v.method];
 return `Customer payment preference: legal payee ${v.payeeName} (${v.payeeType}); ${method}.${v.method==='check_mail'?' Requested mailing address: '+v.mailingAddress+'.':''} Please verify the payee against the executed agreements and confirm any identity, tax or entity/signing-authority documents you require through your secure process. This is a preference, not verified disbursement instructions or a change to any signed agreement.`;
}
