import {z} from 'zod';
import type {BuyerAssignmentPricing} from './buyer-assignment-pricing.ts';
export type DealRecovery={editable:boolean;termsHash:string;minimumFeeCents:number;proposal:BuyerAssignmentPricing;feedback:{id:string;reason:string;counterofferCents:number|null;buyerPriceCents:number|null;gapCents:number|null;createdAt:string}[]};
export const dealRecoveryInput=z.object({dealId:z.guid(),key:z.guid(),termsHash:z.string().regex(/^[a-f0-9]{32}$/),minimumFeeCents:z.number().int().min(500000).max(1000000).multipleOf(100000),confirmed:z.literal(true)}).strict();
