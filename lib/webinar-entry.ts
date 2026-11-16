import {webinarPost} from './webinar-client.ts';

/** Keep entry parameters identical before and after the room bundle arrives. */
export function webinarEntryBody(code:string|undefined,search:string){
 const params=new URLSearchParams(search);
 const attribution=Object.fromEntries(['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ad_id','adset_id','campaign_id','fbclid'].flatMap(k=>params.has(k)?[[k,params.get(k)!]]:[]));
 return {...(code?{code}:{}),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Chicago',...(params.get('r')?{resume:params.get('r')}:{}),...(params.get('watch')==='1'?{returnToWebinar:true}:{}),...(params.get('preview')?{preview:params.get('preview'),variant:params.get('variant')==='night'?'night':'day'}:{}),attribution};
}
type EntryResult={data:unknown;receivedAt:number;error?:never}|{error:unknown;data?:never;receivedAt?:never};
export type WebinarEntryStart=()=>Promise<EntryResult>;
/** One request per mounted entry, shared with the room. Failure is consumed by
 * the existing retry UI, never an unhandled rejection or an automatic write retry. */
export function prepareWebinarEntry(code?:string):WebinarEntryStart{
 let request:Promise<EntryResult>|undefined;
 return ()=>request??=webinarPost('/api/webinar/start',webinarEntryBody(code,location.search)).then(data=>({data,receivedAt:Date.now()}),error=>({error}));
}
