import {z} from 'zod';
export const campaignSettingsSchema=z.object({
 enabled:z.boolean(),smsEnabled:z.boolean(),smartFollowups:z.boolean(),
 fromEmail:z.string().trim().email().or(z.literal('')),postalAddress:z.string().trim().max(500),
 subjects:z.array(z.string().min(1).max(150)).length(3),messages:z.array(z.string().min(1).max(2000)).length(3),
}).strict();
export type CampaignSettings=z.infer<typeof campaignSettingsSchema>;
export type MessagingDatabase=<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
export async function readCampaignSettings(database:MessagingDatabase,signal?:AbortSignal){
 const [row]=await database<{config:unknown;revision:number}[]>('icash_messaging_settings?id=eq.1&select=config,revision','GET',undefined,signal);
 if(!row)throw Error('Messaging settings unavailable');
 return {settings:campaignSettingsSchema.parse(row.config),revision:row.revision};
}
