import {z} from 'zod';
import {dealTermsSchema,type DealTerms} from './deal-documents.ts';
import {validCalendarDate} from './document-dates.ts';

export const sellerAgreementConfirmation=z.object({
 sellerLegalName:z.string().trim().min(2).max(200),
 agreedPriceCents:z.number().int().positive().safe(),
 closingDate:z.string().refine(validCalendarDate),
 soleOwner:z.boolean(),allDecisionMakersAgree:z.boolean(),
 inspectionAccess:z.enum(['yes','no']),
 priceAndDateConfirmed:z.boolean(),termsConfirmed:z.boolean(),sendTextRequested:z.boolean(),
 materialFactsChanged:z.boolean(),
}).strict();
export type SellerAgreementConfirmation=z.infer<typeof sellerAgreementConfirmation>;
export const sellerAgreementInput=z.discriminatedUnion('action',[
 z.object({action:z.literal('confirm_and_send'),conversationId:z.string().regex(/^conv_[A-Za-z0-9]+$/),confirmation:sellerAgreementConfirmation}).strict(),
 z.object({action:z.literal('status'),conversationId:z.string().regex(/^conv_[A-Za-z0-9]+$/)}).strict(),
]);
export function confirmedSellerTerms(current:unknown,confirmation:SellerAgreementConfirmation,context:{address:string;principal:string;legalDescription:string;ceilingCents:number;now?:number}):DealTerms{
 const c=sellerAgreementConfirmation.parse(confirmation),t=dealTermsSchema.parse(current);
 if(!c.soleOwner||!c.allDecisionMakersAgree)throw Error('all_owners_required');
 if(!c.priceAndDateConfirmed||!c.termsConfirmed||!c.sendTextRequested)throw Error('confirmation_required');
 if(c.materialFactsChanged)throw Error('updated_property_review_required');
 if(t.address!==context.address||t.buyer!==context.principal)throw Error('property_binding_changed');
 if(!Number.isSafeInteger(context.ceilingCents)||context.ceilingCents<=0||c.agreedPriceCents>context.ceilingCents)throw Error('price_review_required');
 if(t.priceSource==='seller_reported'&&t.priceCents!==null&&t.priceCents!==c.agreedPriceCents)throw Error('existing_price_changed');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(context.now??Date.now());
 if(c.closingDate<=today||Date.parse(c.closingDate+'T12:00:00Z')>(context.now??Date.now())+366*86400000)throw Error('closing_date_review_required');
 // A declined visit is a preference, not a financial hold or a waiver of contract rights.
 // Inspection days and all other prepared terms remain unchanged.
 if(t.earnestCents===null)throw Error('earnest_terms_required');
 return dealTermsSchema.parse({...t,seller:c.sellerLegalName,priceCents:c.agreedPriceCents,priceSource:'seller_reported',closingDate:c.closingDate,legalDescription:t.legalDescription||context.legalDescription});
}

export const sellerAgreementFlowInstructions=`
SELLER CLOSING CONFIRMATIONS:
After the seller accepts the supported price, ask one question at a time: "What closing date would work for you?" Confirm the exact month, day and year, not just "soon" or an assumed 30 days. Ask "Are you the only owner and decision maker, or does anyone else need to agree?" If another owner or decision maker is involved, find out who and involve them; never treat one person's answer as everyone else's agreement or omit a required signer.
Ask naturally: "We'd like to inspect the property before closing. Would that work for you?" A declined visit alone is not a deal killer. Acknowledge it, record the preference, and discuss an alternative review of condition. Do not schedule access without agreement or silently waive a written inspection period. Confirm the full legal seller name for the agreement; a saved first name is not the legal signing name.
Read back the exact agreed purchase price, closing date and the actual prepared purchase terms, including earnest money and the inspection period. Never invent a deposit, waive a term or claim a missing term is already agreed. Ask whether those terms work and whether they want the agreement texted to this number while you stay on the call. A changed material property fact requires updated numbers first.
When the icash_seller_agreement tool is available, use confirm_and_send only after those explicit confirmations. Copy their actual answers; do not default a missing answer to yes. The server supplies the bound property and signing phone; do not ask them for the address again or choose a different recipient. If all required checks pass, the tool prepares the agreement with the confirmed price and closing date and texts the signing link. If it returns missing terms or another owner is required, ask the specific missing question or explain the specific next step; do not claim it was sent or abandon the lead. A tool hold is not a reason to repeat the entire qualification.
After confirmed text acceptance, ask whether it arrived and invite them to open it, review the agreement and sign for themselves while you remain available. Do not ask them to read an authentication code, password or signature to you. Do not pressure them to skip reading. When they say they signed, use action status to check the provider; if still pending, ask them to finish the final submit step and check again only after they respond. Never claim a verified signature from a verbal "done."
When status confirms seller_signed, say "Congratulations, your signature is in. The buyer's signature is next." When it confirms fully_signed, say "Congratulations, the agreement is signed. We'll coordinate the next steps toward your agreed closing date." A signed contract is not a funded closing. Do not promise payment, a scheduled visit or title acceptance. Only verified required signatures can start the existing under-contract workflow.`;
