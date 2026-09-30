import {z} from 'zod';
const reference=z.string().trim().min(12).max(1000);
const date=z.string().datetime({offset:true});
const money=z.number().int().positive().max(100000000000);
const base={screeningId:z.string().uuid(),purpose:z.string().trim().min(12).max(500),sourceName:z.string().trim().min(3).max(100),evidenceReference:reference,evidenceObservedAt:date,expiresAt:date,stateCode:z.string().regex(/^[A-Z]{2}$/)};
export const authorityPayloadSchema=z.discriminatedUnion('kind',[
 z.object({...base,kind:z.literal('contact_permission'),channel:z.literal('voice'),party:z.enum(['seller','buyer']),buyerId:z.string().uuid().nullable(),phone:z.string().regex(/^\+1[2-9][0-9]{9}$/),timezone:z.string().min(1).max(100),localStartHour:z.number().int().min(9).max(19),localEndHour:z.number().int().min(10).max(20)}).strict(),
 z.object({...base,kind:z.literal('offer_ceiling'),channel:z.literal('offer'),maxCents:money}).strict(),
 z.object({...base,kind:z.literal('marketing_release'),channel:z.literal('buyer_marketing'),dealId:z.string().uuid(),purchaseEnvelopeId:z.string().uuid(),termsHash:z.string().regex(/^[a-f0-9]{64}$/),maxCents:money,market:z.string().trim().min(2).max(100),propertyType:z.enum(['house','land']),repairsCents:z.number().int().min(0).max(100000000000),marketingScope:z.literal('assignment_interest')}).strict(),
]);
export type AuthorityPayload=z.infer<typeof authorityPayloadSchema>;
export const authoritySubmitSchema=z.object({idempotencyKey:z.string().uuid(),payload:authorityPayloadSchema}).strict();
export const authorityDecisionSchema=z.object({requestId:z.string().uuid(),decision:z.enum(['approved','needs_information','declined','revoked']),note:z.string().trim().min(12).max(1000),verification:z.object({marketReviewId:z.string().uuid(),reviewReference:reference,reviewedAt:date,validUntil:date,consentReference:reference.optional(),consentObservedAt:date.optional(),dncReceiptId:z.string().uuid().optional(),underwritingReference:reference.optional(),underwritingMaxCents:money.optional(),marketingRightsReference:reference.optional()}).strict().optional()}).strict();
export function validateAuthorityTimes(payload:AuthorityPayload,now=Date.now()){
 if(Date.parse(payload.evidenceObservedAt)>now||Date.parse(payload.evidenceObservedAt)<now-365*86400000)throw new Error('Use dated, current evidence.');
 if(Date.parse(payload.expiresAt)<=now||Date.parse(payload.expiresAt)>now+90*86400000)throw new Error('Choose an expiry within 90 days.');
 if(payload.kind==='contact_permission'){
  if(payload.localStartHour>=payload.localEndHour)throw new Error('Choose a valid contact window.');
  try{new Intl.DateTimeFormat('en-US',{timeZone:payload.timezone}).format(now);}catch{throw new Error('Choose a valid time zone.');}
  if((payload.party==='buyer')!==!!payload.buyerId)throw new Error('Select the matching buyer record.');
 }
}
export type AuthorityReviewRow={id:string;kind:AuthorityPayload['kind'];screening_id:string;state:'submitted'|'needs_information'|'approved'|'declined'|'revoked';expires_at:string;created_at:string;decision_note:string|null;payload:AuthorityPayload};
export function authorityReviewPresentation(row:Pick<AuthorityReviewRow,'kind'|'state'|'expires_at'|'decision_note'>,now=Date.now()){
 const expired=Date.parse(row.expires_at)<=now;
 const status=row.state==='revoked'?'revoked':row.state==='declined'?'denied':expired?'expired':row.state==='approved'?'approved':row.state==='needs_information'?'needs_information':'pending';
 const nextStep=status==='approved'?'Review recorded. Current dispatch, budget and suppression checks still apply.':status==='revoked'?'This approval was withdrawn. Contact restrictions remain in place.':status==='denied'?'Read the review note. Submit a new request only with corrected evidence.':status==='expired'?'Submit a new request with current evidence and a new expiry.':status==='needs_information'?'Provide the requested evidence in a new submission. The original request stays unchanged.':row.kind==='contact_permission'?'Waiting for a trusted reviewer, external do-not-call verification and channel-specific consent review.':'Waiting for a trusted reviewer. Submission does not approve an offer or release marketing.';
 return {status,nextStep};
}
export function authorityError(error:unknown){
 if(error instanceof z.ZodError)return {status:400,error:'Check the required review details. No permission was granted.'};
 if(error instanceof Error&&error.message==='SIGN_IN_REQUIRED')return {status:401,error:'Sign in to view reviews.'};
 if(error instanceof Error&&error.message==='OPERATOR_REQUIRED')return {status:403,error:'A separately provisioned trusted reviewer is required.'};
 return {status:503,error:'Review could not be saved or verified. Existing permissions are unchanged; refresh before retrying.'};
}

/** Customer responses omit internal verification receipts and operator identities. */
export function customerAuthorityReview(row:AuthorityReviewRow){
 const {id,kind,screening_id,state,expires_at,created_at,decision_note,payload}=row;
 return {id,kind,screening_id,state,expires_at,created_at,decision_note,payload,...authorityReviewPresentation(row)};
}
