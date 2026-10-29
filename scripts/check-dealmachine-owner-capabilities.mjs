import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// Free catalog reads only. No contacts, searches, exports, lists or credits.
// This runs in the existing trusted build environment; credentials never leave it.
export async function inspectOwnerCapabilities(env=process.env,transport=fetch){
 // The one-time phone preview owns this branch's tightly bounded API reads.
 if(env.VERCEL_ENV==='preview'&&env.VERCEL_GIT_COMMIT_REF==='codex/dealmachine-active-phone-contract-20261027')return {status:'covered_by_scoped_preview',paidRequests:0};
 if(!env.DEALMACHINE_API_KEY)return {status:'unconfigured',paidRequests:0};
 const matches=[];
 for(let page=1;page<=4;page++){
  const response=await transport(`https://api.v2.dealmachine.com/v1/filters?source_type=people&per_page=250&page=${page}`,{
   method:'GET',headers:{Authorization:`Bearer ${env.DEALMACHINE_API_KEY}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000),
  });
  if(!response.ok)return {status:'catalog_unavailable',http:response.status,paidRequests:0};
  const raw=await response.json();
  if(!Array.isArray(raw?.data)||typeof raw?.pagination?.has_next_page!=='boolean')return {status:'catalog_shape_unavailable',paidRequests:0};
  for(const row of raw.data){
   if(!row||typeof row.filter_id!=='string'||! /^[a-zA-Z0-9_]{1,100}$/.test(row.filter_id))continue;
   if(row.filter_id!=='has_active_phone_number'&&!/(?:^|_)(?:id|identifier)(?:_|$)/.test(row.filter_id)&&!(typeof row.name==='string'&&/\b(?:identifier|record id|person id)\b/i.test(row.name)))continue;
   matches.push({filterId:row.filter_id,type:typeof row.type==='string'&&/^[A-Z_]+$/.test(row.type)?row.type:null,
    premium:typeof row.is_premium_filter==='boolean'?row.is_premium_filter:null,
    operators:Array.isArray(row.allowed_operators)?row.allowed_operators.filter(x=>typeof x==='string'&&/^[a-z_]{1,60}$/.test(x)).slice(0,20):[]});
  }
  if(!raw.pagination.has_next_page)return {status:'checked',paidRequests:0,pages:page,filters:matches};
 }
 return {status:'catalog_incomplete',paidRequests:0,filters:matches};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 try{console.log('DealMachine owner filter capabilities: '+JSON.stringify(await inspectOwnerCapabilities()));}
 catch{console.log('DealMachine owner filter capabilities: unavailable; paid requests: 0.');}
}
