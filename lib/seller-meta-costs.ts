import type {SellerDb} from './seller-pipeline.ts';
export type MetaCostStatus='connection_required'|'invalid_report'|'unavailable';
export class MetaCostError extends Error {status:MetaCostStatus;constructor(status:MetaCostStatus){super(status==='connection_required'?'Meta needs read access. Paste a token with ads_read access to your advertising account below.':status==='invalid_report'?'Meta returned an incomplete or unsupported spend report. Saved costs are unchanged.':'Meta spend is temporarily unavailable. Saved costs are unchanged.');this.status=status;}}
type Env=NodeJS.ProcessEnv;
const id=/^\d{5,30}$/;
// Server-only usage: neither this credential nor the environment is returned by an API.
export async function sellerMetaCostEnvironment(db:SellerDb,env:Env){
 const token=await db<string|null>('rpc/icash_seller_meta_access','POST',{});
 if(token!==null&&(typeof token!=='string'||token.length<20||token.length>4096))throw new MetaCostError('unavailable');
 return token?{...env,META_ADS_READ_ACCESS_TOKEN:token}:env;
}
export function metaCostConfigured(env:Env){return !!(env.META_ADS_READ_ACCESS_TOKEN||env.META_SELLER_ACCESS_TOKEN||env.META_CAPI_ACCESS_TOKEN)&&/^v\d{1,3}\.0$/.test(env.META_GRAPH_VERSION||'');}
async function graph(path:string,params:Record<string,string>,env:Env,transport:typeof fetch){
 if(!metaCostConfigured(env))throw new MetaCostError('connection_required');
 const url=new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${path}`);for(const [key,value]of Object.entries(params))url.searchParams.set(key,value);
 let response:Response;try{response=await transport(url,{method:'GET',headers:{Authorization:`Bearer ${env.META_ADS_READ_ACCESS_TOKEN||env.META_SELLER_ACCESS_TOKEN||env.META_CAPI_ACCESS_TOKEN}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});}catch{throw new MetaCostError('unavailable');}
 let data;try{const body=await response.text();if(body.length>500000)throw Error();data=JSON.parse(body);}catch{throw new MetaCostError('invalid_report');}
 if(!response.ok||data.error)throw new MetaCostError([10,100,190,200].includes(Number(data.error?.code))||response.status===401||response.status===403?'connection_required':'unavailable');
 return data;
}
async function list(path:string,fields:string,env:Env,transport:typeof fetch){
 const rows:Record<string,string>[]=[];let after='';const seen=new Set<string>();
 for(let page=0;page<10;page++){
  const result=await graph(path,{fields,limit:'100',...(after?{after}:{})},env,transport);
  if(!Array.isArray(result.data))throw new MetaCostError('invalid_report');rows.push(...result.data);
  if(!result.paging?.next)return rows;
  const next=result.paging?.cursors?.after;if(typeof next!=='string'||next.length>2048||seen.has(next))throw new MetaCostError('invalid_report');seen.add(next);after=next;
 }
 throw new MetaCostError('invalid_report');
}
export async function listMetaCostAccounts(env:Env,transport:typeof fetch=fetch){
 const rows=await list('me/adaccounts','id,name,currency',env,transport);
 return rows.filter(r=>/^act_\d{5,30}$/.test(r.id)&&r.currency==='USD').map(r=>({id:r.id,name:String(r.name||r.id).slice(0,200)}));
}
export async function listMetaCostCampaigns(account:string,env:Env,transport:typeof fetch=fetch){
 if(!/^act_\d{5,30}$/.test(account))throw new MetaCostError('invalid_report');
 const rows=await list(`${account}/campaigns`,'id,name',env,transport);
 return rows.filter(r=>id.test(r.id)).map(r=>({id:r.id,name:String(r.name||r.id).slice(0,200)}));
}
export async function validateMetaCostSource(account:string,campaign:string,env:Env,transport:typeof fetch=fetch){
 if(!/^act_\d{5,30}$/.test(account)||!id.test(campaign))throw new MetaCostError('invalid_report');
 const accountInfo=await graph(account,{fields:'id,currency,timezone_name'},env,transport);
 const campaignInfo=await graph(campaign,{fields:'id,account_id'},env,transport);
 if(accountInfo.id!==account||accountInfo.currency!=='USD'||campaignInfo.id!==campaign||String(campaignInfo.account_id)!==account.slice(4))throw new MetaCostError('invalid_report');
 try{new Intl.DateTimeFormat('en-US',{timeZone:accountInfo.timezone_name}).format();}catch{throw new MetaCostError('invalid_report');}
 if(typeof accountInfo.timezone_name!=='string')throw new MetaCostError('invalid_report');
 return {timezone:accountInfo.timezone_name as string};
}
export function completedMetaDays(timezone:string,now=new Date()){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(key:string)=>parts.find(p=>p.type===key)!.value;
 const start=Date.parse(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
 return Array.from({length:7},(_,i)=>new Date(start-(7-i)*86400000).toISOString().slice(0,10));
}
export function metaSpendDays(raw:unknown,campaign:string,days:string[]){
 const report=raw as {data?:Array<Record<string,unknown>>;paging?:{next?:string}};
 if(!Array.isArray(report?.data)||report.paging?.next)throw new MetaCostError('invalid_report');
 const amounts=new Map<string,number>();
 for(const row of report.data){
  if(row.campaign_id!==campaign||row.account_currency!=='USD'||typeof row.date_start!=='string'||row.date_stop!==row.date_start||!days.includes(row.date_start)||amounts.has(row.date_start)||typeof row.spend!=='string'||!/^\d{1,7}(?:\.\d{1,6})?$/.test(row.spend))throw new MetaCostError('invalid_report');
  const [whole,fraction='']=row.spend.split('.'),micros=Number(whole)*1000000+Number(fraction.padEnd(6,'0'));
  if(!Number.isSafeInteger(micros)||micros>1000000000000)throw new MetaCostError('invalid_report');amounts.set(row.date_start,micros);
 }
 // Meta omits no-delivery days. Only a complete, successful response supplies zeroes.
 return days.map(day=>({day,spendMicros:amounts.get(day)??0,currency:'USD'}));
}
export async function syncSellerMetaCosts(db:SellerDb,env:Env,transport:typeof fetch=fetch,now=new Date()){
 if(env.VERCEL_ENV!=='production')return {status:'disabled_outside_production'};
 const claim=await db<{id:string;token:string;accountId:string;metaCampaignId:string}|null>('rpc/icash_claim_seller_cost_sync','POST',{});if(!claim)return {status:'not_configured_or_not_due'};
 let status:MetaCostStatus|'synced'='synced',timezone:string|null=null,days:ReturnType<typeof metaSpendDays>|null=null;
 try{
  const access=await sellerMetaCostEnvironment(db,env);
  ({timezone}=await validateMetaCostSource(claim.accountId,claim.metaCampaignId,access,transport));const dates=completedMetaDays(timezone,now);
  const report=await graph(`${claim.accountId}/insights`,{fields:'campaign_id,date_start,date_stop,spend,account_currency',level:'campaign',time_increment:'1',time_range:JSON.stringify({since:dates[0],until:dates[6]}),filtering:JSON.stringify([{field:'campaign.id',operator:'IN',value:[claim.metaCampaignId]}]),limit:'100'},access,transport);
  days=metaSpendDays(report,claim.metaCampaignId,dates);
 }catch(e){status=e instanceof MetaCostError?e.status:'unavailable';}
 const saved=await db<boolean>('rpc/icash_finish_seller_cost_sync','POST',{p_id:claim.id,p_token:claim.token,p_status:status,p_timezone:timezone,p_days:days});
 return {status:saved?status:'sync_claim_changed'};
}
