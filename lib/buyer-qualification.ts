import {z} from 'zod';
const reference=z.string().trim().min(12).max(1000);
const date=z.string().datetime({offset:true});
const cents=z.number().int().nonnegative().max(100000000000);
export const buyerQualificationPayloadSchema=z.object({
 buyerId:z.string().uuid(),dealId:z.string().uuid(),
 markets:z.array(z.string().trim().min(2).max(100)).min(1).max(10),
 propertyTypes:z.array(z.enum(['house','land'])).min(1).max(2),
 maxPriceCents:cents.refine(n=>n>0),maxRepairCents:cents,
 criteriaObservedAt:date,expiresAt:date,sourceName:z.string().trim().min(3).max(120),
 sourceReference:reference,buyerStatement:z.string().trim().min(12).max(4000),
}).strict();
export const buyerQualificationSubmitSchema=z.object({idempotencyKey:z.string().uuid(),payload:buyerQualificationPayloadSchema}).strict();
export const buyerQualificationDecisionSchema=z.object({
 requestId:z.string().uuid(),decision:z.enum(['approved','needs_information','declined','revoked']),note:reference,
 verification:z.object({criteriaConfirmed:z.literal(true),fundsVerified:z.literal(true),signatoryVerified:z.literal(true),
  reviewReference:reference,validUntil:date,fundsReference:reference,fundsObservedAt:date,fundsAmountCents:cents.refine(n=>n>0),currency:z.literal('USD'),
  signatoryName:z.string().trim().min(2).max(200),authorityReference:reference,authorityObservedAt:date,
 }).strict().optional(),
}).strict();
export type BuyerQualificationPayload=z.infer<typeof buyerQualificationPayloadSchema>;
export type BuyerQualificationRow={id:string;account_id:string;buyer_id:string;deal_id:string;entity_key:string;state:'submitted'|'needs_information'|'approved'|'declined'|'revoked';payload:BuyerQualificationPayload;created_at:string;expires_at:string;decision_note:string|null};
export function validateBuyerQualificationTimes(p:BuyerQualificationPayload,now=Date.now()){
 const observed=Date.parse(p.criteriaObservedAt),expiry=Date.parse(p.expiresAt);
 if(observed>now||observed<now-30*86400000||expiry<=now||expiry>now+30*86400000||expiry>observed+30*86400000)throw Error('BUYER_EVIDENCE_TIMING');
 if(new Set(p.markets.map(x=>x.toLowerCase())).size!==p.markets.length||new Set(p.propertyTypes).size!==p.propertyTypes.length)throw Error('BUYER_EVIDENCE_TIMING');
}
export function buyerQualificationView(row:BuyerQualificationRow,now=Date.now()){
 const status=row.state==='approved'&&Date.parse(row.expires_at)<=now?'expired':row.state;
 return {id:row.id,buyerId:row.buyer_id,dealId:row.deal_id,state:status,payload:row.payload,createdAt:row.created_at,expiresAt:row.expires_at,decisionNote:row.decision_note,
  notice:status==='approved'?'Human review recorded for this buyer and deal. Contact permission, marketing authority and current provider checks still apply.':'Buyer statements are unverified until an authorized reviewer checks the source, funds and signing authority. No outreach permission was granted.'};
}
export function buyerQualificationError(error:unknown){
 if(error instanceof z.ZodError||error instanceof Error&&error.message==='BUYER_EVIDENCE_TIMING')return {status:400,error:'Check the buyer, dated source, criteria and expiry. No verification or permission was granted.'};
 if(error instanceof Error&&error.message==='SIGN_IN_REQUIRED')return {status:401,error:'Sign in to view buyer reviews.'};
 if(error instanceof Error&&error.message==='OPERATOR_REQUIRED')return {status:403,error:'An existing authorized authority reviewer is required.'};
 return {status:409,error:'Buyer review could not be saved or verified. Refresh its status before retrying.'};
}
