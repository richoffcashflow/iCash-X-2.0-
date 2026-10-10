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
export function closingSetupNext(view:ClosingSetupView):{code:string;title:string;text:string;action:'title'|'payout'|'verify'|null;label:string|null}{
 if(view.setup?.review_reason&&view.setup.review_reason!=='setup')return {code:'human_review',title:'Resolve the closing issue',text:'Read the title reply and contact the closing office. Record the resolution before returning this property to the bot.',action:null,label:null};
 if(!view.verifiedContact){
  const p=view.setup?.title_proposal,complete=!!(p?.closer&&p.email&&p.phone);
  if(p||view.buyerSuggestions.length)return {code:'verify_preference',title:complete?'Verify your title company':'Add the title contact',text:'Call the company using its official number. Confirm the closer’s name and email, assignment handling and coverage for this property. You can use the buyer’s suggested company.',action:complete?'verify':'title',label:complete?'Review title verification':'Add title contact'};
  if(view.directory.length)return {code:'review_directory',title:'Choose a title company',text:'Review the local candidates below or add a company suggested by the buyer. Call the office to confirm it can handle this assignment.',action:'title',label:'Add a title company'};
  return {code:'research_required',title:'Choose a title company',text:'No current title candidate covers this property. Ask the buyer for a company they have used, or find a local title office through its official website. Confirm it handles assignments here.',action:'title',label:'Add a title company'};
 }
 if(!view.setup?.payout)return {code:'payout_preference',title:'Tell title how to pay you',text:'Save the legal name that should receive the proceeds. Choose check pickup, a mailed check or wire. Add a mailing address only for a mailed check.',action:'payout',label:'Set up my payment'};
 if(!view.setup.payout.detailsSharedWithTitle)return {code:'secure_details',title:'Share payment details with title',text:view.setup.payout.method==='wire'?'Contact your verified closer for its secure bank-details process. After you share the details, mark that step complete below.':'Confirm the check payee and pickup or mailing arrangements directly with your closer. Then mark that step complete below.',action:'payout',label:'Review payment details'};
 return {code:'title_confirmation_pending',title:'Your closing setup is saved',text:'Title still needs to approve the payee, final settlement amount and payment timing. Review any requests or documents from the office below.',action:null,label:null};
}

/** Title receives preferences, never bank credentials, tax IDs or an implied payment authorization. */
export function closingPayoutNote(raw:unknown){
 const p=payoutPreferenceSchema.safeParse(raw);if(!p.success)return '';
 const v=p.data,method={check_pickup:'check for pickup',check_mail:'mailed check',wire:'wire through your secure process'}[v.method];
 return `Customer payment preference: legal payee ${v.payeeName} (${v.payeeType}); ${method}.${v.method==='check_mail'?' Requested mailing address: '+v.mailingAddress+'.':''} Please verify the payee against the executed agreements and confirm any identity, tax or entity/signing-authority documents you require through your secure process. This is a preference, not verified disbursement instructions or a change to any signed agreement.`;
}
