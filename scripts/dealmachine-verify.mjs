import { writeFileSync } from 'node:fs';
// Explicit preview diagnostic only. No records, contacts or paid endpoints.
// Never emits credentials, raw provider bodies, customer identities or stack traces.
const allowed = new Set(['/usage','/fields?source_type=properties&search=repair&per_page=250','/fields?source_type=properties&search=condition&per_page=250','/fields?source_type=properties&search=sale&per_page=250']);
const propertyPath='/properties/prop_179843131?contact_audience=none&fields=estimated_repair_cost,estimated_repair_cost_range,building_condition,living_area_sqft';
allowed.add(propertyPath);
const key = process.env.DEALMACHINE_API_KEY;
const reports=[];
const report = (value) => { reports.push(value); console.log('ICASH_DM_VERIFY '+JSON.stringify(value)); };
async function request(path) {
 if (!allowed.has(path)) throw new Error('Blocked endpoint');
 const response = await fetch('https://api.v2.dealmachine.com/v1'+path, {headers:{Authorization:'Bearer '+key},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
 if (!response.ok) { report({endpoint:path,status:response.status}); return null; }
 return response.json();
}
if (process.env.VERCEL_ENV !== 'preview' || process.env.VERCEL_GIT_COMMIT_REF !== 'dealmachine-verification') {
 report({status:'skipped',reason:'Dedicated preview branch required'});
} else if (!key) {
 report({status:'blocked',reason:'Missing DEALMACHINE_API_KEY'});
} else if (!key.startsWith('dm_sk_live_')) {
 report({status:'blocked',reason:'Configured key does not match documented V2 API key format; no request sent'});
} else {
 try {
  const usage = await request('/usage');
  if (usage) {
   report({status:'authenticated'});
   for (const term of ['repair','condition','sale']) {
    const result = await request('/fields?source_type=properties&search='+term+'&per_page=250');
    if (result) report({query:term,fields:Array.isArray(result.data)?result.data.filter(f=>['estimated_repair_cost','estimated_repair_cost_range','building_condition','building_quality','last_sale_date','last_sale_price'].includes(f.field_id)).map(f=>({id:f.field_id,type:f.type,description:f.description,filterable:f.is_filterable})):null,hasNextPage:result.pagination?.has_next_page??null});
   }
   const property=await request(propertyPath);
   if(property){
    const d=property.data??{};
    const wanted=['estimated_repair_cost','estimated_repair_cost_range','estimated_repair_cost_low','estimated_repair_cost_high','repair_cost_low','repair_cost_high','building_condition','living_area_sqft'];
    report({propertyCheck:'prop_179843131',values:Object.fromEntries(wanted.filter(k=>Object.hasOwn(d,k)).map(k=>[k,d[k]])),credits:typeof property.credits?.used==='number'?property.credits.used:null,contactsReturned:Array.isArray(d.contacts)&&d.contacts.length>0});
   }
   const mcp=await fetch('https://mcp.dealmachine.com',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}}),redirect:'error',signal:AbortSignal.timeout(15000)});
   if(mcp.ok){
    const body=await mcp.text();
    const payload=body.trim().startsWith('{')?JSON.parse(body):JSON.parse(body.split('\n').find(l=>l.startsWith('data: '))?.slice(6)??'{}');
    const tool=payload.result?.tools?.find(t=>t.name==='dealmachine_comps');
    report({compsTool:tool?{name:tool.name,description:tool.description,inputSchema:tool.inputSchema}:null});
   }else report({compsMetadataStatus:mcp.status});
  }
 } catch { report({status:'failed',reason:'Network or invalid response; sensitive details suppressed'}); }
}

// Only public field metadata and status; no account data, balances or secrets.
if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === 'dealmachine-verification') writeFileSync('public/dealmachine-verification.json',JSON.stringify(reports));
