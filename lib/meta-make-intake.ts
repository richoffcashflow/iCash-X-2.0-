import {createHash,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {hashLeadToken,instantLeadToken,metaId,parseMetaLead,type MetaLeadSource} from './meta-instant-leads.ts';
import type {SellerDb} from './seller-pipeline.ts';

const configSchema=z.object({pageId:metaId,formId:metaId,tokenSha256:z.string().regex(/^[a-f0-9]{64}$/),testLeadIds:z.array(metaId).max(100).default([])}).strict();
export function makeLeadConfig(env:NodeJS.ProcessEnv){
 try{return configSchema.parse(JSON.parse(env.META_MAKE_RECEIVER_JSON??''));}catch{return null;}
}
export function makeLeadAuthorized(header:string|null,config:NonNullable<ReturnType<typeof makeLeadConfig>>){
 if(!header||!/^Bearer [A-Za-z0-9_-]{43,100}$/.test(header))return false;
 const digest=createHash('sha256').update(header.slice(7)).digest();
 return timingSafeEqual(digest,Buffer.from(config.tokenSha256,'hex'));
}
const optionalId=z.preprocess(value=>value===''||value===null?undefined:value,metaId.optional());
const responses=z.array(z.object({checkbox_key:z.string().min(1).max(200),is_checked:z.boolean()}).strict()).max(20);
const makePayload=z.object({
 lead_id:metaId,page_id:metaId,form_id:metaId,
 created_time:z.union([z.string().max(80),z.number().int().positive()]),
 full_name:z.string().trim().min(1).max(100),phone_number:z.string().trim().min(1).max(160),
 ad_id:optionalId,adset_id:optionalId,campaign_id:optionalId,
 custom_disclaimer_responses:z.preprocess(value=>{
  if(value===''||value===null||value===undefined)return [];
  if(typeof value==='string'){try{return JSON.parse(value);}catch{return value;}}
  return value;
 },responses),
}).strict();
export function parseMakeLead(raw:unknown,config:NonNullable<ReturnType<typeof makeLeadConfig>>,now=Date.now()){
 const data=makePayload.parse(raw);
 if(data.page_id!==config.pageId||data.form_id!==config.formId)throw Error('MAKE_SOURCE_MISMATCH');
 const value=data.created_time;
 // Preserve the actual submission time. Locale-formatted clock strings have
 // no trustworthy timezone and must never silently become a call-now receipt.
 const submitted=typeof value==='number'?value*1000:/^\d{10}$/.test(value)?Number(value)*1000:
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:?\d\d)$/.test(value)?Date.parse(value):NaN;
 if(!Number.isFinite(submitted)||submitted>now+60000||submitted<now-30*86400000)throw Error('MAKE_SUBMISSION_TIME_REQUIRED');
 const test=config.testLeadIds.includes(data.lead_id)||[data.full_name,data.phone_number].some(value=>/^<test lead:\s*dummy data for [^>]+>$/i.test(value));
 return {test,payload:{id:data.lead_id,page_id:data.page_id,form_id:data.form_id,
  ...(data.ad_id?{ad_id:data.ad_id}:{}),...(data.adset_id?{adset_id:data.adset_id}:{}),...(data.campaign_id?{campaign_id:data.campaign_id}:{}),
  created_time:new Date(submitted).toISOString(),
  field_data:[{name:'full_name',values:[data.full_name]},{name:'phone_number',values:[data.phone_number]}],
  custom_disclaimer_responses:data.custom_disclaimer_responses,
 }};
}
export async function readMakeLeadBody(req:Request){
 const limit=16384;
 if(Number(req.headers.get('content-length')??0)>limit)throw Error('MAKE_BODY_TOO_LARGE');
 const type=req.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
 if(type!=='application/json'&&type!=='application/x-www-form-urlencoded')throw Error('MAKE_CONTENT_TYPE_REQUIRED');
 const reader=req.body?.getReader();if(!reader)throw Error('MAKE_BODY_REQUIRED');
 const chunks:Uint8Array[]=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw Error('MAKE_BODY_TOO_LARGE');}chunks.push(value);}}finally{reader.releaseLock();}
 const text=Buffer.concat(chunks).toString('utf8');
 if(type==='application/json')return JSON.parse(text);
 const pairs=new URLSearchParams(text),result:Record<string,string>={};
 for(const [key,value] of pairs){if(Object.hasOwn(result,key))throw Error('MAKE_DUPLICATE_FIELD');result[key]=value;}
 return result;
}
type Claim={metaId:string;sourceId:string;token:string;payload:ReturnType<typeof parseMakeLead>['payload'];isTest:boolean};
export async function processMakeLead(d:{db:SellerDb;env:NodeJS.ProcessEnv;onAccepted:(id:string)=>Promise<unknown>},metaId?:string){
 if(d.env.META_INSTANT_LEADS_ENABLED!=='true'||d.env.VERCEL_ENV&&d.env.VERCEL_ENV!=='production'||!d.env.META_LEAD_LINK_SECRET)return {status:'disabled'};
 const claim=await d.db<Claim|null>('rpc/icash_make_claim_lead','POST',{p_meta:metaId??null});
 if(!claim)return {status:'idle'};
 const path=`icash_make_lead_inbox?meta_id=eq.${claim.metaId}&claim_token=eq.${claim.token}`;
 let stage='validate',acceptedId:string;
 try{
  if(claim.isTest)throw Error('META_TEST_LEAD');
  const [source]=await d.db<MetaLeadSource[]>(`icash_meta_lead_sources?id=eq.${claim.sourceId}&select=*`);
  if(!source?.enabled)throw Error('META_SOURCE_DISABLED');
  const raw=claim.payload;
  const notice={leadgen_id:raw.id,page_id:raw.page_id,form_id:raw.form_id,...(raw.ad_id?{ad_id:raw.ad_id}:{}),created_time:Math.floor(Date.parse(raw.created_time)/1000)};
  // Use the source's configured contact basis, with the original submission
  // retained in the inbox and the same atomic cross-transport lead dedupe.
  const lead=parseMetaLead(raw,notice,source);
  const token=instantLeadToken(lead.metaId,lead.submittedAt,d.env.META_LEAD_LINK_SECRET);
  stage='save';
  const saved=await d.db<{leadId:string}>('rpc/icash_meta_accept_lead','POST',{p_source:source.id,p_payload:lead,p_link_hash:hashLeadToken(token)});
  acceptedId=saved.leadId;
  await d.db(path,'PATCH',{state:'accepted',lead_id:saved.leadId,reason:null});
 }catch(error){
  const reason=error instanceof Error&&/^[A-Z_]{5,70}$/.test(error.message)?error.message:'META_RECEIPT_REVIEW_REQUIRED';
  await d.db(path,'PATCH',{state:claim.isTest||reason==='META_TEST_LEAD'?'test':stage==='validate'?'review':'pending',reason,next_attempt_at:new Date(Date.now()+120000).toISOString()});
  return {status:stage==='validate'?'review':'retry_pending'};
 }
 // A dispatch failure must not undo durable acceptance. The normal lead worker
 // recovers pending contact work using provider receipts and the existing IDs.
 try{await d.onAccepted(acceptedId);}catch{console.warn('make_lead_outreach_pending');}
 return {status:'accepted'};
}
