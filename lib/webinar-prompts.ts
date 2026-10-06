export type PromptHistory={nameDismissedAt:number|null;contactDismissedAt:number|null;nameAttempts:number;contactAttempts:number;nameSavedAt:number|null};
export const emptyPromptHistory:PromptHistory={nameDismissedAt:null,contactDismissedAt:null,nameAttempts:0,contactAttempts:0,nameSavedAt:null};
/** Video time avoids showing reminders while a paused or hidden tab waits. */
export function webinarPrompt(input:{name:string;contactSaved:boolean;seconds:number;nameAt:number;contactAt:number;history:PromptHistory}):'name'|'contact'|null{
 const {name,contactSaved,seconds,nameAt,contactAt,history:h}=input;
 if(!name)return h.nameAttempts<2&&seconds>=nameAt&&(h.nameDismissedAt===null||seconds>=h.nameDismissedAt+300)?'name':null;
 if(contactSaved||h.contactAttempts>=2)return null;
 const due=Math.max(contactAt,h.nameSavedAt===null?contactAt:h.nameSavedAt+30);
 return seconds>=due&&(h.contactDismissedAt===null||seconds>=h.contactDismissedAt+300)?'contact':null;
}
export function readPromptHistory(sessionId:string):PromptHistory{
 try{
  const h=JSON.parse(sessionStorage.getItem('icash-webinar-prompts:'+sessionId)||'null');
  if(h&&['nameDismissedAt','contactDismissedAt','nameSavedAt'].every(k=>h[k]===null||(Number.isFinite(h[k])&&h[k]>=0&&h[k]<=14400))&&['nameAttempts','contactAttempts'].every(k=>Number.isInteger(h[k])&&h[k]>=0&&h[k]<=2))return h;
 }catch{/* Prompts also work without browser storage. */}
 return {...emptyPromptHistory};
}
export function savePromptHistory(sessionId:string,history:PromptHistory){try{sessionStorage.setItem('icash-webinar-prompts:'+sessionId,JSON.stringify(history));}catch{/* Optional local state. */}}
