// One free, read-only owner preview. Log schema/boolean evidence only, never
// identifiers, names, phones, credentials or a paid enrichment response.
export async function inspectOwnerShape(env=process.env,fetcher=fetch){
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY||!env.DEALMACHINE_API_KEY)return {status:'unconfigured'};
 const response=await fetcher(env.SUPABASE_URL+'/rest/v1/icash_owner_contacts?select=result:result->propertyId&order=created_at.desc&limit=1',{
  headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY},redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok)return {status:'record_unavailable'};
 const [record]=await response.json();if(!/^prop_\d{1,20}$/.test(record?.result??''))return {status:'no_property'};
 const preview=await fetcher('https://api.v2.dealmachine.com/v1/properties/'+record.result+'?enrich=false&contact_audience=owners',{
  headers:{Authorization:'Bearer '+env.DEALMACHINE_API_KEY},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!preview.ok)return {status:'preview_unavailable',http:preview.status};
 const raw=await preview.json();
 if(raw?.credits?.used!==0||!Array.isArray(raw?.data?.contacts))return {status:'invalid_free_preview'};
 return {status:'checked',paidRequests:0,creditsUsed:0,contacts:raw.data.contacts.slice(0,25).map(person=>({
  keys:Object.keys(person).sort(),flags:Object.fromEntries(Object.entries(person).filter(([key])=>/^is_[a-z_]+$/.test(key)).map(([key,value])=>[key,{type:typeof value,value:typeof value==='boolean'||typeof value==='number'||value===null?value:typeof value==='string'&&['true','false','0','1','owner','renter','resident'].includes(value.toLowerCase())?value:'redacted'}]))
 }))};
}
try{console.log('DealMachine owner preview schema: '+JSON.stringify(await inspectOwnerShape()));}catch{console.log('DealMachine owner preview schema: unavailable. No paid request.');}
