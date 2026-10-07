import {returnVisit,type ReturnSession} from '../packages/webinar-engine/src/index.ts';
export type FollowupPhase='resume'|'checkout'|'next';
const plain=(value:string,max:number)=>value.replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
export function followupPhase(history:ReturnSession[],timezone:string,hours=8,now=new Date()):FollowupPhase{
 const journey=returnVisit(history,timezone,hours,now);return journey.kind==='checkout'?'checkout':journey.kind==='resume'?'resume':'next';
}
export function followupCopy({name,title,seconds,phase,step,brand,host,smart=true,subject='',message=''}:{name:string;title:string;seconds:number;phase:FollowupPhase;step:number;brand:string;host:string;smart?:boolean;subject?:string;message?:string}){
 const first=plain(name,80).split(/\s+/)[0]||'there',session=plain(title,160)||`${brand} walkthrough`;
 const watch=`${Math.floor(Math.max(0,seconds)/60)}:${String(Math.floor(Math.max(0,seconds)%60)).padStart(2,'0')}`;
 const next=phase==='checkout'?'Review your next step':phase==='resume'?'Continue your session':'Open your next session';
 const subjects={resume:`${first==='there'?'Your':first+', your'} place is saved`,checkout:'Your next step with '+brand,next:step>=4?'One last reminder from '+brand:'Take another look at '+brand};
 const messages={resume:`Your place in “${session}” is saved at ${watch}. You can pick up from there whenever you’re ready.`,checkout:`You can review the current price and terms for ${brand} below and decide if it fits your goals.`,next:`Want to take another look at ${brand}? This link will choose the right session for you based on what you’ve already watched.`};
 const variables:Record<string,string>={first_name:first,name:first,webinar:session,watch_time:watch,next_step:next};
 const fill=(text:string)=>text.replace(/\{\{(first_name|name|webinar|watch_time|next_step)\}\}/g,(_,key:string)=>variables[key]);
 return {subject:plain(smart?subjects[phase]:fill(subject),150),body:`Hey ${first},\n\n${smart?messages[phase]:fill(message)}\n\n${next}:`,signature:`— ${host}`,sms:`Hey ${first}, ${brand} here. ${phase==='resume'?'Your place is saved.':phase==='checkout'?'Your next step is ready.':'Ready for another look?'} ${next.toLowerCase()}:`};
}
