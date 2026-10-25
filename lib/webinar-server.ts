import {cookies} from 'next/headers';
import {randomUUID} from 'node:crypto';
import {webinarOwnerIdentity} from '@/lib/webinar-account-adapter';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
import {readWebinarToken,signWebinarToken} from '@/lib/webinar-token';
import type {Webinar} from '@/lib/webinar-policy';
export const webinarHeaders={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export class WebinarError extends Error{constructor(public status:number,message:string){super(message);}}
export async function webinarOwner(){const u=await webinarOwnerIdentity();if(!u)throw new WebinarError(403,'Sign in with the platform owner account.');return u;}
export function webinarOrigin(req:Request){if(process.env.NODE_ENV==='development'&&new URL(req.url).origin===req.headers.get('origin'))return;if(!allowedOrigin(req))throw new WebinarError(403,'Open this page directly and try again.');}
export async function webinarBody(req:Request,limit=50000){if(Number(req.headers.get('content-length')||0)>limit)throw new WebinarError(413,'This upload is too large.');const body=await req.text();if(body.length>limit)throw new WebinarError(413,'This request is too large.');return JSON.parse(body);}
export function webinarKey(){const key=process.env.ICASH_WEBINAR_SECRET||process.env.SUPABASE_SECRET_KEY;if(!key)throw new WebinarError(503,'Webinar storage is unavailable.');return key;}
export function webinarToken(id:string,purpose:'visitor'|'resume'|'unsubscribe',seconds:number){return signWebinarToken(id,purpose,seconds,webinarKey());}
export type Visitor={attribution?:Record<string,string>;marketing_consent_at?:string|null;measurement?:Record<string,string>;id:string;name:string|null;email:string|null;phone:string|null;timezone:string;email_consent_at:string|null;sms_consent_at?:string|null;sms_opted_out_at?:string|null;sms_replied_at?:string|null;opted_out_at:string|null;funded_at:string|null;account_id:string|null;funding_guest_hash:string|null};
export type WebinarSession={id:string;visitor_id:string;webinar_id:string;revision:number;progress_seconds:number;max_seconds:number;watched_seconds?:number;completed_at:string|null;superseded_at:string|null;created_at:string;updated_at:string;config:Webinar;is_preview:boolean};
export async function webinarVisitor(create=false,resume?:string,signal?:AbortSignal){
 const jar=await cookies();let id=readWebinarToken(jar.get('icash_webinar')?.value,'visitor',webinarKey());
 const resumed=readWebinarToken(resume,'resume',webinarKey());if(resumed)id=resumed;
 let v=id?(await db<Visitor[]>(`icash_webinar_visitors?id=eq.${id}&select=*&limit=1`,'GET',undefined,signal))[0]:undefined;
 if(!v&&create){[v]=await db<Visitor[]>('icash_webinar_visitors','POST',{id:randomUUID()},signal);}
 signal?.throwIfAborted();
 if(v&&create)jar.set('icash_webinar',webinarToken(v.id,'visitor',86400*180),{httpOnly:true,secure:process.env.NODE_ENV!=='development',sameSite:'lax',path:'/',maxAge:86400*180});
 if(!v)throw new WebinarError(401,'Reload the webinar to restore your session.');return v;
}
export type WebinarSessionSummary=Pick<WebinarSession,'id'|'visitor_id'|'webinar_id'|'revision'|'is_preview'|'superseded_at'>&{config:Pick<Webinar,'recordingVersion'>};
export async function webinarSession(id:string,summary:true):Promise<{v:Visitor;s:WebinarSessionSummary}>;
export async function webinarSession(id:string,summary?:false):Promise<{v:Visitor;s:WebinarSession}>;
export async function webinarSession(id:string,summary=false):Promise<{v:Visitor;s:WebinarSession|WebinarSessionSummary}>{
 const v=await webinarVisitor();
 // Polling needs current ownership/supersession and chat scope, not the saved
 // video, transcript, offers and chat cues. Never cache authorization or state.
 const fields=summary?'id,visitor_id,webinar_id,revision,is_preview,superseded_at,recording_version:config->>recordingVersion':'*';
 const [row]=await db<(WebinarSession&{recording_version?:Webinar['recordingVersion']})[]>(`icash_webinar_sessions?id=eq.${id}&visitor_id=eq.${v.id}&select=${fields}&limit=1`);
 if(!row)throw new WebinarError(404,'Session not found.');
 if(summary){const {recording_version,...s}=row;return {v,s:{...s,config:{recordingVersion:recording_version==='night'?'night':'day'}}};}
 return {v,s:row};
}
export async function webinarLimit(req:Request,id:string,kind:string,limit=20,seconds=60){await limitRequest(req,`webinar-${kind}`,id,limit,seconds);}
export async function webinarPaid(v:Visitor){
 if(v.funded_at||v.account_id)return true;
 if(v.funding_guest_hash){for(const table of ['icash_funding_orders','icash_memberships']){const rows=await db<unknown[]>(`${table}?guest_hash=eq.${v.funding_guest_hash}&mode=eq.live&${table==='icash_funding_orders'?'state=eq.paid':'paid_through=not.is.null'}&select=id&limit=1`);if(rows.length)return true;}}
 if(!v.email)return false;
 const [funded]=await db<{id:string}[]>(`icash_funding_orders?payer_email=eq.${encodeURIComponent(v.email.toLowerCase())}&mode=eq.live&state=eq.paid&select=id&limit=1`);
 if(funded)return true;
 const [member]=await db<{id:string}[]>(`icash_memberships?payer_email=eq.${encodeURIComponent(v.email)}&mode=eq.live&paid_through=not.is.null&select=id&limit=1`);
 return !!member;
}
export function webinarError(e:unknown){return Response.json({error:e instanceof WebinarError?e.message:'Could not complete that request. Please try again.'},{status:e instanceof WebinarError?e.status:503,headers:webinarHeaders});}
