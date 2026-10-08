import {z} from 'zod';
export const setupThemes={ink:{name:'Onyx',color:'#181818',soft:'#f5f5f5'},ocean:{name:'Cobalt',color:'#2459d3',soft:'#eff4ff'},forest:{name:'Emerald',color:'#047857',soft:'#edf8f3'},violet:{name:'Violet',color:'#6d28d9',soft:'#f5f0ff'},rose:{name:'Rose',color:'#be185d',soft:'#fff1f5'},teal:{name:'Teal',color:'#0f766e',soft:'#edf8f7'},gold:{name:'Gold',color:'#866018',soft:'#fbf6e9'}} as const;
export const setupProfileSchema=z.object({displayName:z.string().trim().min(1).max(64).regex(/^[^\u0000-\u001f<>{}]+$/u),theme:z.enum(['ink','ocean','forest','violet','rose','teal','gold']),logo:z.enum(['monogram','roof','wordmark']),voice:z.enum(['eric','sarah','chris','jessica']),market:z.string().trim().min(2).max(80).regex(/^[a-zA-Z0-9 .,'-]+$/),marketMode:z.enum(['nationwide','city']),aiLogo:z.number().int().min(0).max(2).nullable().default(null),contracts:z.boolean().default(true),buyers:z.boolean().default(true)}).strict();
export type BotProfile=z.infer<typeof setupProfileSchema>;
export type BotSetup={id:string;profile:Partial<BotProfile>;stage:number;revision:number;variant:'ownership'|'outcome';flow_variant?:'guided'|'quick';flow_experiment?:string|null;updated_at:string};
export type SetupVoice={key:BotProfile['voice'];name:string;description:string;previewUrl:string;voiceId:string};
export const defaultBotProfile:BotProfile={displayName:'',theme:'ink',logo:'monogram',voice:'eric',market:'Nationwide',marketMode:'nationwide',aiLogo:null,contracts:true,buyers:true};
export function botInitials(name:string){return name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(w=>Array.from(w)[0]).join('').toUpperCase()||'X';}
export function normalizeBotProfile(value:unknown){return setupProfileSchema.parse(value);}
export const setupEvents=['name_viewed','style_viewed','voice_viewed','market_viewed','funding_viewed','voice_played','checkout_clicked','checkout_opened','checkout_failed','returned'] as const;

// Every setup now uses presets. Legacy intermediate stages resume on the final page.
export function nextSetupStage(_stage:number,_flow:'guided'|'quick'='quick'){return 4;}
export function resumeSetupStage(setup:Pick<BotSetup,'stage'|'profile'>){return setup.stage>0&&!!setup.profile.displayName?.trim()?4:0;}
