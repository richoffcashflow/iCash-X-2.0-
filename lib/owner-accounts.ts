import {z} from 'zod';

// Display-only privacy for the owner's account switcher and customer previews.
export function maskOwnerAccountEmail(email:string|null|undefined):string{
 const value=email?.trim();if(!value)return '';
 const at=value.lastIndexOf('@');if(at<1||at===value.length-1)return '***';
 const visible=Math.min(2,at-1);
 return `${value.slice(0,visible)}***${value.slice(at)}`;
}
export function maskOwnerAccountLabel(label:string):string{
 return label.replace(/[^\s<>@]+@[^\s<>@]+/g,email=>maskOwnerAccountEmail(email));
}

const count=z.number().int().nonnegative().safe();
export const ownerAccountSchema=z.object({id:z.guid(),name:z.string(),email:z.string().nullable(),ownAccount:z.boolean(),fundedCents:count,balanceCents:count,reservedCents:count,leadCount:count,paused:z.boolean(),assistantName:z.string().nullable(),createdAt:z.string().datetime({offset:true}),billingModel:z.string(),vip:z.boolean(),membership:z.object({state:z.string(),paidThrough:z.string().nullable()}).nullable()});
export type OwnerAccount=z.infer<typeof ownerAccountSchema>;
export const ownerAccountsSchema=z.object({sort:z.enum(['funded','leads','newest']),query:z.string(),page:count.min(1),pageSize:z.literal(25),total:count,accounts:z.array(ownerAccountSchema).max(25)});
export type OwnerAccounts=z.infer<typeof ownerAccountsSchema>;
export const ownerViewSchema=z.object({id:z.guid(),expiresAt:z.string().datetime({offset:true}),account:ownerAccountSchema});
export type OwnerView=z.infer<typeof ownerViewSchema>;
export const ownerLeadsSchema=z.object({page:count.min(1),pageSize:z.literal(12),query:z.string(),total:count,leads:z.array(z.object({id:z.guid(),address:z.string(),state:z.string(),financialStatus:z.string().nullable(),responded:z.boolean(),interested:z.boolean(),optedOut:z.boolean(),createdAt:z.string().datetime({offset:true}),dealId:z.guid().nullable()})).max(12)});
export type OwnerLeads=z.infer<typeof ownerLeadsSchema>;
export const ownerAccountFilters=z.object({sort:z.enum(['funded','leads','newest']).default('funded'),q:z.string().trim().max(100).default(''),page:z.string().regex(/^[1-9]\d{0,5}$/).transform(Number).refine(n=>n<=100000).prefault('1')}).strict();
