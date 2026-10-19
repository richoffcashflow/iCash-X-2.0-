import type {CampaignSettings,MessagingDatabase} from './messaging-settings.ts';

// Retired by the owner on October 18, 2026. Keep these compatibility entry
// points for deployed workers; saved settings cannot re-enable reminder sends.
export function webinarFollowupReadiness(_settings:CampaignSettings,_env:Record<string,string|undefined>=process.env){
 return {emailConnection:false,smsConnection:false,senderCount:0,email:false,sms:false};
}
export async function processWebinarFollowups(_options?:{database?:MessagingDatabase;transport?:typeof fetch;env?:Record<string,string|undefined>;clock?:()=>Date}){
 return {status:'removed',emailReady:false,textReady:false,setupRequired:false,sent:0};
}
