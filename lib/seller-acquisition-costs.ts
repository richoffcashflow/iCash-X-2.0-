import {z} from 'zod';

export const acquisitionSources=['meta','google','youtube','tiktok','direct','other'] as const;
export const acquisitionSourceLabels:Record<string,string>={meta:'Meta',google:'Google',youtube:'YouTube',tiktok:'TikTok',direct:'Direct',other:'Other'};
const costFields={requestId:z.string().uuid(),costCents:z.number().int().min(0).max(1000000),note:z.string().trim().min(5).max(500)};
export const acquisitionCostInput=z.discriminatedUnion('action',[
 z.object({...costFields,action:z.literal('lead'),leadId:z.string().uuid()}).strict(),
 z.object({...costFields,action:z.literal('estimate'),source:z.enum(acquisitionSources),campaign:z.string().max(100).regex(/^[a-zA-Z0-9_-]*$/)}).strict(),
 z.object({action:z.literal('meta'),requestId:z.string().uuid(),campaign:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),accountId:z.string().regex(/^act_\d{5,30}$/),metaCampaignId:z.string().regex(/^\d{5,30}$/),enabled:z.boolean()}).strict(),
]);
const micros=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const acquisitionCostReport=z.object({
 estimates:z.array(z.object({source:z.enum(acquisitionSources),campaign:z.string(),costMicros:micros,note:z.string(),updatedAt:z.string()})),
 leads:z.array(z.object({id:z.string().uuid(),address:z.string(),state:z.string(),createdAt:z.string(),source:z.string(),campaign:z.string(),
  acquisition:z.object({costMicros:micros,kind:z.enum(['reported','campaign_report','estimate','organic','demo','meta_report','meta_estimate']),note:z.string()}).passthrough().nullable(),
  processingMicros:micros.nullable(),collectedCents:micros,recipients:z.number().int().nonnegative(),holdReason:z.string().nullable(),
 })),
 automation:z.array(z.object({id:z.string().uuid(),campaign:z.string(),accountId:z.string(),metaCampaignId:z.string(),enabled:z.boolean(),status:z.string(),checkedAt:z.string().nullable(),syncedAt:z.string().nullable(),spendMicros:micros,leadCount:micros,unallocatedMicros:micros,averageMicros:micros.nullable()})),
});
export type AcquisitionCostReport=z.infer<typeof acquisitionCostReport>;
export function acquisitionDollarsToCents(value:string){
 if(!/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(value.trim()))throw Error('Enter a dollar amount with up to two decimal places.');
 const [dollars,fraction='']=value.trim().split('.');const cents=Number(dollars)*100+Number(fraction.padEnd(2,'0'));
 if(cents>1000000)throw Error('Enter an amount up to $10,000.');return cents;
}
