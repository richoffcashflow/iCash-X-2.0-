import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const branch='codex/dealmachine-active-phone-contract-20261027';
const safeKey=v=>typeof v==='string'&&/^[a-zA-Z0-9_]{1,100}$/.test(v)?v:null;
// Read-only capability investigation, scoped to this preview branch. This does
// not create exports, retrieve contacts, download files, or consume credits.
export async function inspectPhoneContract(env=process.env,transport=fetch){
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!==branch)return {status:'not_requested',paidRequests:0};
 if(!env.DEALMACHINE_API_KEY)return {status:'unconfigured',paidRequests:0};
 const get=async path=>{
  const r=await transport('https://api.v2.dealmachine.com/v1'+path,{method:'GET',headers:{Authorization:`Bearer ${env.DEALMACHINE_API_KEY}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('METADATA_UNAVAILABLE');return r.json();
 };
 const fields=[];let complete=false;
 for(let page=1;page<=4;page++){
  const raw=await get(`/fields?source_type=people&per_page=250&page=${page}`);
  if(!Array.isArray(raw?.data)||typeof raw?.pagination?.has_next_page!=='boolean')throw Error('METADATA_UNAVAILABLE');
  for(const row of raw.data){
   const id=safeKey(row?.field_id);
   if(!id||!/(?:phone|activ|person_id|contact_id|identifier|full_name)/i.test(id))continue;
   fields.push({fieldId:id,type:safeKey(row.type),billingCategory:safeKey(row.billing_category),filterable:row.is_filterable===true,
    metadataKeys:Object.keys(row).filter(k=>safeKey(k)).sort().slice(0,30)});
  }
  if(!raw.pagination.has_next_page){complete=true;break;}
 }
 const exports=await get('/exports?limit=5&status=completed');
 if(!Array.isArray(exports?.data))throw Error('METADATA_UNAVAILABLE');
 return {status:complete?'checked':'catalog_incomplete',paidRequests:0,fields,
  existingExports:{total:Number.isSafeInteger(exports.pagination?.total)?exports.pagination.total:null,
   samples:exports.data.slice(0,5).map(row=>({keys:Object.keys(row).filter(k=>safeKey(k)).sort(),
    creditsKeys:row.credits&&typeof row.credits==='object'?Object.keys(row.credits).filter(k=>safeKey(k)).sort():[],
    records:Number.isSafeInteger(row.record_count)?row.record_count:null,
    files:Array.isArray(row.download_urls)?row.download_urls.slice(0,5).map(f=>({size:Number.isSafeInteger(f.size)?f.size:null,
     people:typeof f.filename==='string'&&/^people_export_/.test(f.filename),gzip:typeof f.filename==='string'&&f.filename.endsWith('.csv.gz')})):[]}))}};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 try{console.log('DealMachine phone contract: '+JSON.stringify(await inspectPhoneContract()));}
 catch{console.log('DealMachine phone contract: unavailable; paid requests: 0.');}
}
