export const outreachHoursPolicyVersion='outreach-hours-2026-10-19' as const;
export type VoiceOutreachContext={timezone:string;startHour:9;endHour:21;activeConversation:boolean;policyVersion:typeof outreachHoursPolicyVersion};

// Only the server RPC may establish a conversation or requested-callback
// exception. Permission records and client flags are not timing evidence.
export function readVoiceOutreachContext(value:unknown):VoiceOutreachContext|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const c=value as Record<string,unknown>;
 if(c.policyVersion!==outreachHoursPolicyVersion||c.startHour!==9||c.endHour!==21||typeof c.activeConversation!=='boolean'||typeof c.timezone!=='string'||!c.timezone.trim())return null;
 try{new Intl.DateTimeFormat('en-US',{timeZone:c.timezone}).format(0);}catch{return null;}
 return {timezone:c.timezone,startHour:9,endHour:21,activeConversation:c.activeConversation,policyVersion:outreachHoursPolicyVersion};
}

export function withinOutreachHours(context:VoiceOutreachContext,now:number):boolean{
 if(context.activeConversation)return true;
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:context.timezone,hour:'2-digit',hourCycle:'h23'}).format(new Date(now)));
 return hour>=context.startHour&&hour<context.endHour;
}
