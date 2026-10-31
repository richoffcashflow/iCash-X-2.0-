export const outreachHoursPolicyVersion='outreach-hours-2026-10-19' as const;
export type VoiceOutreachContext={timezone:string;startHour:9;endHour:21;activeConversation:boolean;policyVersion:typeof outreachHoursPolicyVersion;ownerDemoRequestedUntil?:string};

// Recipient timing comes from the server. A conversation or callback does not
// authorize starting an outbound call outside the calling window. Only a fresh
// server-verified owner self-demo receipt supplies the separate expiry below.
export function readVoiceOutreachContext(value:unknown):VoiceOutreachContext|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const c=value as Record<string,unknown>;
 if(c.policyVersion!==outreachHoursPolicyVersion||c.startHour!==9||c.endHour!==21||typeof c.activeConversation!=='boolean'||typeof c.timezone!=='string'||!c.timezone.trim())return null;
 try{new Intl.DateTimeFormat('en-US',{timeZone:c.timezone}).format(0);}catch{return null;}
 const ownerDemoRequestedUntil=typeof c.ownerDemoRequestedUntil==='string'&&Number.isFinite(Date.parse(c.ownerDemoRequestedUntil))?c.ownerDemoRequestedUntil:undefined;
 return {timezone:c.timezone,startHour:9,endHour:21,activeConversation:c.activeConversation,policyVersion:outreachHoursPolicyVersion,...(ownerDemoRequestedUntil?{ownerDemoRequestedUntil}:{})};
}

export function withinOutreachHours(context:VoiceOutreachContext,now:number):boolean{
 const expires=Date.parse(context.ownerDemoRequestedUntil??'');
 if(Number.isFinite(now)&&expires>now&&expires<=now+5*60_000)return true;
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:context.timezone,hour:'2-digit',hourCycle:'h23'}).format(new Date(now)));
 return hour>=context.startHour&&hour<context.endHour;
}
