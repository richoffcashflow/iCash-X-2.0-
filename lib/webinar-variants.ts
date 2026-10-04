import {freezeTimeline} from '../packages/webinar-engine/src/index.ts';
import {webinarSite} from './webinar-site.ts';
import {z} from 'zod';
import type {ChatCue,Webinar} from './webinar-policy.ts';

const bankSchema=z.array(z.object({id:z.string(),variations:z.array(z.string().trim().min(1).max(1500)).min(2).max(3)}).strict()).max(40);
export function applyChatVariations(chat:ChatCue[],raw:unknown):ChatCue[]{
 const bank=bankSchema.parse(raw),eligible=chat.filter(c=>c.kind!=='replay');
 if(bank.length!==eligible.length||new Set(bank.map(c=>c.id)).size!==bank.length||bank.some(c=>!eligible.some(e=>e.id===c.id)))throw Error('AI changed the cue list. Retry without changing your saved script.');
 return chat.map(c=>c.kind==='replay'?c:{...c,variations:bank.find(b=>b.id===c.id)!.variations});
}
/** The shared engine freezes alternatives; this adapter supplies the company identity. */
export function snapshotChat(w:Webinar,sessionId:string):Webinar{return {...w,chat:freezeTimeline(w.chat,sessionId,w.variationEnabled,webinarSite.assistantName)};}
export const chatPresets={
 'Webinar 7':[[5,'Welcome, {{name}}. Get comfortable—your place is saved.'],[33,'Questions about getting started? Drop one here.'],[90,'Ready to follow along? Keep your questions coming.'],[235,'Quick check-in: does the process make sense so far?'],[408,'Watch how the call demo works. What would you ask the seller?'],[678,'Questions about finding sellers? Ask the assistant here.'],[817,'The next step is coming up. Think about what you want to try first.'],[984,'Check the current offer and costs before choosing.'],[1099,'Questions about billing? Review the terms shown in checkout.'],[1190,'You can keep watching while you review your options.']],
 'Webinar 10':[[5,'Let’s get into it, {{name}}. Your session is saved.'],[40,'Ready? Follow along and ask anything about the walkthrough.'],[188,'Have a question about the software? Put it here.'],[240,'Here comes the call demo. Listen to how the conversation flows.'],[385,'Questions about leads? Ask here while you watch.'],[580,'Quick check-in: what part should we explain more?'],[724,'Ready for the next step? Keep watching for the options.'],[864,'Review the offer when it appears beside your video.'],[960,'Check the payment schedule and current terms in checkout.'],[1130,'Take your time reviewing. Your video keeps playing.']],
 'Webinar 12 v2':[[4,'Let’s get started, {{name}}. Ask questions as you watch.'],[44,'Wondering what you need to get started? Ask here.'],[55,'Staying for the walkthrough? Your place is saved.'],[155,'Results vary. Use the walkthrough to decide whether this fits your goals.'],[190,'Watch the AI call example. What stands out to you?'],[268,'Questions about buyers or the process? Drop one here.'],[318,'Quick check-in: is the process clear so far?'],[380,'Ask about the steps you would handle in your workspace.'],[600,'Ready to look at the next step? The offer is coming up.'],[680,'Your options will appear beside the video.'],[760,'Check the current price and terms before continuing.'],[840,'Keep watching while you review your options.'],[930,'If something is unclear, ask the assistant or contact support.']],
} as const;
export function presetChat(key:keyof typeof chatPresets):ChatCue[]{return chatPresets[key].map(([at,text],n)=>({id:`preset-${n}`,at,text,name:'iCash X assistant',kind:'ai'}));}
