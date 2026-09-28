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
   async function rpc(method,params,id,session){
    const headers={Authorization:'Bearer '+key,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-03-26'};
    if(session) headers['Mcp-Session-Id']=session;
    const response=await fetch('https://mcp.dealmachine.com',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',...(id===undefined?{}:{id}),method,params}),redirect:'error',signal:AbortSignal.timeout(15000)});
    const text=await response.text();
    let payload={};
    try { payload=text.trim().startsWith('{')?JSON.parse(text):JSON.parse(text.split('\n').find(l=>l.startsWith('data: '))?.slice(6)??'{}'); } catch {}
    return {status:response.status,session:response.headers.get('mcp-session-id'),payload};
   }
   const init=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'icash-x-verification',version:'1.0.0'}},1);
   if(init.status===200){
    await rpc('notifications/initialized',{},undefined,init.session);
    const listed=await rpc('tools/list',{},2,init.session);
    const tool=listed.payload.result?.tools?.find(t=>t.name==='dealmachine_comps');
    report({compsTool:tool?{name:tool.name,description:tool.description,inputSchema:tool.inputSchema}:null,status:listed.status,errorCode:listed.payload.error?.code});
   }else report({compsMetadataStatus:init.status,errorCode:init.payload.error?.code});
  }
 } catch { report({status:'failed',reason:'Network or invalid response; sensitive details suppressed'}); }
}

// Only public field metadata and status; no account data, balances or secrets.
if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === 'dealmachine-verification') writeFileSync('public/dealmachine-verification.json',JSON.stringify(reports));
