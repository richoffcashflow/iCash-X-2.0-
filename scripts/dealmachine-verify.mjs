// Explicit preview diagnostic only. No records, contacts or paid endpoints.
// Never emits credentials, raw provider bodies, customer identities or stack traces.
const allowed = new Set(['/usage','/fields?source_type=properties&search=repair&per_page=250','/fields?source_type=properties&search=condition&per_page=250','/fields?source_type=properties&search=sale&per_page=250']);
const key = process.env.DEALMACHINE_API_KEY;
const report = (value) => console.log('ICASH_DM_VERIFY '+JSON.stringify(value));
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
   report({status:'authenticated',creditsAvailable:typeof usage.credits?.total_available==='number'?usage.credits.total_available:null});
   for (const term of ['repair','condition','sale']) {
    const result = await request('/fields?source_type=properties&search='+term+'&per_page=250');
    if (result) report({query:term,fields:Array.isArray(result.data)?result.data.map(f=>({id:f.field_id,type:f.type,description:f.description,filterable:f.is_filterable})):null,hasNextPage:result.pagination?.has_next_page??null});
   }
  }
 } catch { report({status:'failed',reason:'Network or invalid response; sensitive details suppressed'}); }
}
