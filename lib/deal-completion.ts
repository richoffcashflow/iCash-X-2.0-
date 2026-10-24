import {z} from 'zod';

export const blockerKinds=['access','timing','price','repairs','funding','human'] as const;
export type BlockerKind=typeof blockerKinds[number];
export const blockerLabels:Record<BlockerKind,string>={access:'I need another viewing time',timing:'I need a different closing date',price:'I have a price question',repairs:'I have a condition or repair question',funding:'I need help with funds or the deposit',human:'I want to speak with a person'};
export const blockerNext:Record<BlockerKind,{title:string;detail:string}>={
 access:{title:'Get a viewing time that works',detail:'The seller is being asked for new availability. A visit needs both parties to confirm.'},
 timing:{title:'Review the buyer’s timing request',detail:'Confirm the requested date with the seller and closer before changing any signed deadline.'},
 price:{title:'Review the buyer’s price question',detail:'Read the buyer’s request and the agreed buyer price. Any new terms need approval before sending an agreement.'},
 repairs:{title:'Answer the buyer’s property question',detail:'Check the seller’s information and photos. Ask for missing facts before quoting a repair amount.'},
 funding:{title:'Check the buyer’s funds or deposit question',detail:'Verify funds and receiving instructions with the appropriate contact. A payment claim does not confirm cleared receipt.'},
 human:{title:'Speak with the buyer',detail:'The buyer requested a person. Automatic work on this property is held until you speak with them and resolve this request.'},
};
export type JourneyBlocker={kind:BlockerKind;note:string;revision:number;updatedAt:string};
export const blockerInput=z.object({kind:z.enum(blockerKinds),note:z.string().trim().max(1000).refine(v=>!/(?:\b(?:routing|account|ssn|social security)\s*(?:number|#|:)|\b\d{9,}\b)/i.test(v),'Share bank details directly with your verified closing contact.')}).strict();
export const recoveryInput=z.object({journeyId:z.guid(),revision:z.number().int().positive(),resolution:z.string().trim().min(5).max(1000),confirmed:z.literal(true)}).strict();
export const proceedsInput=z.object({dealId:z.guid(),updateId:z.guid(),receivedDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),confirmed:z.literal(true)}).strict();
export type ProceedsReceipt={id:string;amount_cents:number;received_date:string;created_at:string};
export type SavedCloser={dealId:string;company:string;closer:string;email:string;phone:string;lastProperty:string;verifiedUntil:string};
export type BuyerDemand={markets:{zip:string;buyers:number;houseBuyers:number;landBuyers:number;matchingHouses?:number;capacityBuyers?:number;budgetCents?:number;repairBudgetCents?:number}[];checkedAt:string};
export type ClosingOperations={signedContracts:number;closedDeals:number;deposits:number;receivedCents:number;receivedDeals:number;stages:{key:string;count:number;averageDays:number}[];issues:{dealId:string;accountId:string;address:string;reason:string;since:string}[];issueCount:number};
const count=z.number().int().nonnegative().safe();
export const closingOperationsSchema=z.object({signedContracts:count,closedDeals:count,deposits:count,receivedCents:count,receivedDeals:count,issueCount:count,
 stages:z.array(z.object({key:z.enum(['buyer','deposit','title','payment']),count,averageDays:z.number().finite().nonnegative()}).strict()).max(4),
 issues:z.array(z.object({dealId:z.guid(),accountId:z.guid(),address:z.string(),reason:z.string(),since:z.string().datetime({offset:true})}).strict()).max(20),
}).strict();
