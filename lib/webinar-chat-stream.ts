import type {ChatModeration} from './webinar-shared-chat';
import type {ChatCue} from './webinar-policy';

export type WebinarMessage={id:string;role:'user'|'assistant';text:string;playback_seconds?:number|null;display_name?:string|null;public_status?:ChatModeration;shared?:boolean};
export type PendingWebinarMessage={text:string;playback_seconds:number};
type StreamEntry=
 | {key:string;at:number;kind:'cue';cue:ChatCue}
 | {key:string;at:number;kind:'message';message:WebinarMessage;pending:boolean};

/** Keep a viewer's submissions in the discussion at the point they were sent. */
export function webinarChatStream(cues:ChatCue[],messages:WebinarMessage[],seconds:number,pending:PendingWebinarMessage|null=null):StreamEntry[]{
 const entries:StreamEntry[]=cues.filter(c=>c.at<=seconds&&(c.kind==='replay'||c.kind==='purchase')).map(c=>({key:`cue:${c.id}`,at:c.at,kind:'cue',cue:c}));
 for(const message of messages){
  if(message.role!=='user')continue;
  entries.push({key:`message:${message.id}`,at:message.playback_seconds??0,kind:'message',message,pending:false});
 }
 if(pending)entries.push({key:'sending',at:pending.playback_seconds,kind:'message',message:{...pending,id:'sending',role:'user'},pending:true});
 return entries.sort((a,b)=>a.at-b.at);
}
