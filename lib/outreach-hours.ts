export const outreachHoursPolicyVersion='outreach-hours-2026-10-19' as const;
export type VoiceOutreachContext={timezone:string;startHour:9;endHour:21;activeConversation:boolean;policyVersion:typeof outreachHoursPolicyVersion};

// Recipient timing comes from the server. A conversation or callback does not
// authorize starting an outbound call outside the calling window.
export function readVoiceOutreachContext(value:unknown):VoiceOutreachContext|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const c=value as Record<string,unknown>;
 if(c.policyVersion!==outreachHoursPolicyVersion||c.startHour!==9||c.endHour!==21||typeof c.activeConversation!=='boolean'||typeof c.timezone!=='string'||!c.timezone.trim())return null;
 try{new Intl.DateTimeFormat('en-US',{timeZone:c.timezone}).format(0);}catch{return null;}
 return {timezone:c.timezone,startHour:9,endHour:21,activeConversation:c.activeConversation,policyVersion:outreachHoursPolicyVersion};
}

export function withinOutreachHours(context:VoiceOutreachContext,now:number):boolean{
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:context.timezone,hour:'2-digit',hourCycle:'h23'}).format(new Date(now)));
 return hour>=context.startHour&&hour<context.endHour;
}
