import {z} from 'zod';
export const setupThemes={ink:{name:'Classic',color:'#18181b',soft:'#f2f2f3'},ocean:{name:'Ocean',color:'#2459d3',soft:'#edf3ff'},forest:{name:'Forest',color:'#187251',soft:'#edf7f2'},violet:{name:'Violet',color:'#7143c5',soft:'#f3effb'},rose:{name:'Rose',color:'#b73d64',soft:'#fff0f4'}} as const;
export const setupProfileSchema=z.object({displayName:z.string().trim().min(1).max(64).regex(/^[^\u0000-\u001f<>{}]+$/u),theme:z.enum(['ink','ocean','forest','violet','rose']),logo:z.enum(['monogram','roof','wordmark']),voice:z.enum(['sarah','chris','jessica']),market:z.string().trim().min(2).max(80).regex(/^[a-zA-Z0-9 .,'-]+$/),marketMode:z.enum(['nationwide','city'])}).strict();
export type BotProfile=z.infer<typeof setupProfileSchema>;
export type BotSetup={id:string;profile:Partial<BotProfile>;stage:number;revision:number;variant:'ownership'|'outcome';updated_at:string};
export type SetupVoice={key:BotProfile['voice'];name:string;description:string;previewUrl:string;voiceId:string};
export const defaultBotProfile:BotProfile={displayName:'',theme:'ink',logo:'monogram',voice:'sarah',market:'Nationwide',marketMode:'nationwide'};
export function botInitials(name:string){return name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(w=>Array.from(w)[0]).join('').toUpperCase()||'X';}
export function normalizeBotProfile(value:unknown){return setupProfileSchema.parse(value);}
export const setupEvents=['name_viewed','style_viewed','voice_viewed','market_viewed','funding_viewed','voice_played','checkout_clicked','checkout_opened','checkout_failed','returned'] as const;
