import {webinarSite} from './webinar-site.ts';
import {localHour,isNight,eligibleVariants} from '../packages/webinar-engine/src/index.ts';
import {selectOffer,splitDuration} from '../packages/webinar-engine/src/index.ts';
export {localHour,isNight,visitorTimezone,sameLocalDay} from '../packages/webinar-engine/src/index.ts';
import {z} from 'zod';
import {webinarTimerSchema} from './webinar-timers.ts';

export const webinarConsentVersion='webinar-email-2026-10-04';
export const webinarSmsConsent=`Text me session reminders and ${webinarSite.brandName} offers (up to 2 texts). Message and data rates may apply. Reply STOP to opt out. Optional; not required to buy.`;
export const webinarSmsConsentVersion='webinar-sms-2026-10-07';
export const webinarConsent=`Email me this session, follow-up lessons and ${webinarSite.brandName} offers. I can unsubscribe at any time.`;
const httpsUrl=z.string().max(2000).refine(v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return v==='';}},'Use a direct HTTPS video URL.');
export const defaultChatStyle='Short, conversational CashFlowKey energy. Welcome the viewer, use brief ready/check-in prompts at the right video moments, invite questions during the demo, and point to the current offer at the pitch. Keep it clear and natural, with occasional emphasis. Speak as the session assistant; never invent attendees, payments, results, or limited spots.';
export const chatCueSchema=z.object({id:z.string().min(1).max(80),at:z.number().int().min(0).max(14400),name:z.string().trim().min(1).max(60),text:z.string().trim().min(1).max(1500),kind:z.enum(['host','replay','ai']),variations:z.array(z.string().trim().min(1).max(1500)).max(5).optional()}).strict();
export function validOfferUrl(value:string){
 if(!value||/[\s\\\u0000-\u001f]/.test(value))return false;
 if(value.startsWith('/'))return !value.startsWith('//');
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}
}
export const webinarOfferSchema=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),title:z.string().trim().min(1).max(150),description:z.string().max(600).default(''),ctaLabel:z.string().trim().min(1).max(60),at:z.number().int().min(0).max(14400),expiresAt:z.string().datetime().nullable(),action:z.enum(['checkout','link']),url:z.string().max(2000).default('')}).strict().superRefine((o,c)=>{if(o.action==='link'&&!validOfferUrl(o.url))c.addIssue({code:z.ZodIssueCode.custom,path:['url'],message:'Use an HTTPS link or a path on this site, such as /join.'});});
export type WebinarOffer=z.infer<typeof webinarOfferSchema>;
export const audienceDisplaySchema=z.object({mode:z.enum(['actual','fixed','simulated']).default('actual'),fixedCount:z.number().int().min(0).max(100000).default(125),minimum:z.number().int().min(0).max(100000).default(80),maximum:z.number().int().min(0).max(100000).default(160)}).strict().refine(v=>v.minimum<=v.maximum,'The maximum must be at least the minimum.');
export const purchaseNotificationsSchema=z.object({enabled:z.boolean().default(true),includeRegion:z.boolean().default(true),startAt:z.number().int().min(0).max(14400).nullable().default(null),intervalSeconds:z.number().int().min(15).max(120).default(30)}).strict();
const webinarBaseSchema=z.object({
 publicCode:z.string().regex(/^\d{6,12}$/).nullable().default(null),id:z.string().uuid(),revision:z.number().int().positive(),title:z.string().trim().min(1).max(150),description:z.string().max(600),
 intelligenceEnabled:z.boolean().default(true),status:z.enum(['draft','published']),audience:z.enum(['all','day','night','returning']),priority:z.number().int().min(0).max(100),
 videoUrl:httpsUrl,posterUrl:httpsUrl,durationSeconds:z.number().int().min(10).max(14400),
 nameAt:z.number().int().min(0).max(14400),contactAt:z.number().int().min(0).max(14400),pitchAt:z.number().int().min(0).max(14400),
 offerTitle:z.string().trim().min(1).max(150),ctaLabel:z.string().trim().min(1).max(60),offerEndsAt:z.string().datetime().nullable(),
 checkoutMode:z.enum(['daily','membership']),redirectAtEnd:z.boolean(),chat:z.array(chatCueSchema).max(500),faq:z.string().max(24000),aiEnabled:z.boolean(),
 variationEnabled:z.boolean().default(false),chatStyle:z.string().max(2500).default(defaultChatStyle),
 timers:z.array(webinarTimerSchema).max(8).default([]),offers:z.array(webinarOfferSchema).max(12).default([]),endOfferId:z.string().max(80).nullable().default(null),showAudienceCount:z.boolean().default(true),
 audienceDisplay:audienceDisplaySchema.default({}),purchaseNotifications:purchaseNotificationsSchema.default({}),
}).strict();
function validateRecording(w:z.infer<typeof webinarBaseSchema>,c:z.RefinementCtx){
 if(w.status==='published'&&!w.videoUrl)c.addIssue({code:z.ZodIssueCode.custom,path:['videoUrl'],message:'Add a video before publishing.'});
 for(const k of ['nameAt','contactAt','pitchAt'] as const)if(w[k]>w.durationSeconds)c.addIssue({code:z.ZodIssueCode.custom,path:[k],message:'Must be within the video duration.'});
 if(w.timers.some(t=>t.at>w.durationSeconds))c.addIssue({code:z.ZodIssueCode.custom,path:['timers'],message:'Timer times must be within the video.'});
 if(new Set(w.timers.map(t=>t.id)).size!==w.timers.length)c.addIssue({code:z.ZodIssueCode.custom,path:['timers'],message:'Timer IDs must be unique.'});
 if(new Set(w.chat.map(c=>c.id)).size!==w.chat.length)c.addIssue({code:z.ZodIssueCode.custom,path:['chat'],message:'Chat IDs must be unique.'});
 if(w.chat.some(c=>c.at>w.durationSeconds))c.addIssue({code:z.ZodIssueCode.custom,path:['chat'],message:'Chat timestamps must be within the video.'});
 if(w.offers.some(o=>o.at>w.durationSeconds))c.addIssue({code:z.ZodIssueCode.custom,path:['offers'],message:'Offer times must be within the video.'});
 if(new Set(w.offers.map(o=>o.id)).size!==w.offers.length)c.addIssue({code:z.ZodIssueCode.custom,path:['offers'],message:'Offer IDs must be unique.'});
 if(w.endOfferId&&!w.offers.some(o=>o.id===w.endOfferId))c.addIssue({code:z.ZodIssueCode.custom,path:['endOfferId'],message:'Choose an existing offer for the ending.'});
 if(w.purchaseNotifications.startAt!==null&&w.purchaseNotifications.startAt>w.durationSeconds)c.addIssue({code:z.ZodIssueCode.custom,path:['purchaseNotifications','startAt'],message:'Must be within the video duration.'});
}
export const webinarRecordingSchema=webinarBaseSchema.pick({videoUrl:true,posterUrl:true,durationSeconds:true,nameAt:true,contactAt:true,pitchAt:true,offerTitle:true,ctaLabel:true,offerEndsAt:true,checkoutMode:true,redirectAtEnd:true,chat:true,faq:true,aiEnabled:true,variationEnabled:true,chatStyle:true,offers:true,endOfferId:true,timers:true}).strip();
export type WebinarRecording=z.infer<typeof webinarRecordingSchema>;
export const webinarSchema=webinarBaseSchema.extend({nightVersion:webinarRecordingSchema.nullable().default(null),nightEnabled:z.boolean().default(false),recordingVersion:z.enum(['day','night']).default('day')}).superRefine((w,c)=>{
 validateRecording(w,c);
 if(w.nightEnabled&&!w.nightVersion)c.addIssue({code:z.ZodIssueCode.custom,path:['nightVersion'],message:'Add a night recording first.'});
 if(w.nightVersion)validateRecording({...w,...w.nightVersion,status:w.nightEnabled?w.status:'draft'}, {...c,path:[...c.path,'nightVersion'],addIssue:issue=>c.addIssue({...issue,path:['nightVersion',...(issue.path??[])]})});
});
export type Webinar=z.infer<typeof webinarSchema>;
export type ChatCue=z.infer<typeof chatCueSchema>;
export type WatchHistory={webinar_id:string;revision:number;progress_seconds:number;completed_at:string|null;updated_at:string};
export function newWebinar(id:string):Webinar{return {intelligenceEnabled:true,publicCode:null,nightVersion:null,nightEnabled:false,recordingVersion:'day',id,revision:1,title:`Your ${webinarSite.brandName} session`,description:`A walkthrough with ${webinarSite.hostName}.`,status:'draft',audience:'all',priority:0,videoUrl:'',posterUrl:'',durationSeconds:1800,nameAt:30,contactAt:30,pitchAt:1200,offerTitle:'Put your AI bot to work',ctaLabel:'See my options',offerEndsAt:null,checkoutMode:'membership',redirectAtEnd:true,timers:[],offers:[],endOfferId:null,showAudienceCount:true,audienceDisplay:audienceDisplaySchema.parse({}),purchaseNotifications:purchaseNotificationsSchema.parse({}),chat:[{id:'welcome',at:5,name:webinarSite.brandName,text:'Welcome! Ask a question here while you watch. The AI assistant can help with this session.',kind:'host'}],faq:'iCash X is an AI real estate workspace. Paid activity uses a budget. Results, deals and earnings are not guaranteed. Current prices and terms are shown in checkout.',aiEnabled:true,variationEnabled:false,chatStyle:defaultChatStyle};}
export function chooseWebinar(webinars:Webinar[],history:WatchHistory[],timezone:string,now=new Date(),routing={nightStartsAt:18,nightEndsAt:6}):Webinar|null{
 const eligible=webinars.filter(w=>w.status==='published'&&w.videoUrl);
 const recent=[...history].sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
 // Resume takes priority over changing the day/night version mid-session.
 for(const h of recent){const w=eligible.find(w=>w.id===h.webinar_id&&w.revision===h.revision);if(w&&!h.completed_at&&h.progress_seconds>0)return w;}
 const night=isNight(timezone,now,routing);
 const seen=new Set(history.filter(h=>h.completed_at).map(h=>h.webinar_id));
 const lastSeen=new Map<string,string>();for(const h of history)if(h.completed_at&&h.updated_at>(lastSeen.get(h.webinar_id)??''))lastSeen.set(h.webinar_id,h.updated_at);
 const options=eligibleVariants(eligible,history,timezone,now,routing);
 return options.sort((a,b)=>Number(seen.has(a.id))-Number(seen.has(b.id))||(seen.has(a.id)&&seen.has(b.id)?(lastSeen.get(a.id)??'').localeCompare(lastSeen.get(b.id)??''):0)||Number(b.audience===(night?'night':'day'))-Number(a.audience===(night?'night':'day'))||b.priority-a.priority||a.id.localeCompare(b.id))[0]??null;
}
export function formatWatchTime(seconds:number){const p=splitDuration(seconds);return p.hours?`${p.hours}:${String(p.minutes).padStart(2,'0')}:${String(p.seconds).padStart(2,'0')}`:`${p.minutes}:${String(p.seconds).padStart(2,'0')}`;}
type OfferConfig=Pick<Webinar,'pitchAt'|'offerTitle'|'ctaLabel'|'offerEndsAt'>&Partial<Pick<Webinar,'offers'|'endOfferId'|'durationSeconds'>>;
export function webinarOffers(w:OfferConfig):WebinarOffer[]{return w.offers?.length?w.offers:[{id:'primary',title:w.offerTitle,description:'',ctaLabel:w.ctaLabel,at:w.pitchAt,expiresAt:w.offerEndsAt,action:'checkout',url:''}];}
export function webinarPitchAt(w:OfferConfig){return Math.min(...webinarOffers(w).map(o=>o.at));}
export function offerDestination(o:WebinarOffer){return o.action==='link'&&validOfferUrl(o.url)?o.url:webinarSite.checkoutPath;}
export function webinarEndOffer(w:OfferConfig,now=Date.now()){return selectOffer(webinarOffers(w),w.durationSeconds??14400,now,w.endOfferId);}
export function publicWebinar(w:Webinar){const {faq,chatStyle,nightVersion,nightEnabled,...rest}=w;void faq;void chatStyle;void nightVersion;void nightEnabled;return {...rest,chat:w.chat.map(({variations,...cue})=>{void variations;return cue;})};}
export function offerOpen(w:Pick<Webinar,'offerEndsAt'>,now=Date.now()){return !w.offerEndsAt||Date.parse(w.offerEndsAt)>now;}
export const eventNames=['started','progress','name_saved','contact_saved','pitch_shown','add_to_cart','checkout_opened','completed','chat_question','returning_customer'] as const;
export type WebinarEvent=typeof eventNames[number];
export const optimizerSchema=z.object({enabled:z.boolean().default(false),explorationPercent:z.number().int().min(10).max(50).default(20),minVisitors:z.number().int().min(20).max(5000).default(100)}).strict();
export const metaSchema=z.object({enabled:z.boolean().default(false),pixelId:z.string().regex(/^\d{5,30}$/).or(z.literal('')).default('')}).strict();
export const routingSchema=z.object({nightStartsAt:z.number().int().min(0).max(23),nightEndsAt:z.number().int().min(0).max(23),checkoutWindowHours:z.number().min(0).max(72).default(8)}).strict().refine(r=>r.nightStartsAt!==r.nightEndsAt,'Day and night need different start times.');
export const settingsSchema=z.object({enabled:z.boolean(),smsEnabled:z.boolean().default(false),smartFollowups:z.boolean().default(true),fromEmail:z.string().email().or(z.literal('')),postalAddress:z.string().max(500),subjects:z.array(z.string().min(1).max(150)).length(3),messages:z.array(z.string().min(1).max(2000)).length(3),optimizer:optimizerSchema.default({enabled:false,explorationPercent:20,minVisitors:100}),meta:metaSchema.default({enabled:false,pixelId:''}),routing:routingSchema.default({nightStartsAt:18,nightEndsAt:6})}).strict();
export type WebinarSettings=z.infer<typeof settingsSchema>;
