export type ChatModeration='private'|'pending'|'approved'|'hidden';
export type SharedChatRow={id:string;session_id:string;role:'user';text:string;display_name:string|null;playback_seconds:number|null;public_status:ChatModeration};
type ChatSession={webinar_id:string;revision:number;is_preview:boolean;config:{recordingVersion?:string}};

export function webinarChatScope(s:ChatSession){
 return `webinar_id=eq.${s.webinar_id}&webinar_revision=eq.${s.revision}&recording_version=eq.${s.config.recordingVersion==='night'?'night':'day'}&is_preview=eq.${s.is_preview}`;
}
export const sharedChatFields='id,session_id,role,text,display_name,playback_seconds,public_status';
export function publicChatMessage(row:SharedChatRow){
 return {id:row.id,role:row.role,text:row.text,display_name:row.display_name||'Viewer',playback_seconds:row.playback_seconds,public_status:row.public_status,shared:true as const};
}
