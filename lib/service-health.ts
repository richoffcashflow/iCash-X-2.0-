type Check = 'ok' | 'unavailable';
export type ServiceHealth = {status:'ok'|'degraded';checkedAt:string;checks:{database:Check;authentication:Check}};
let cached:{expiresAt:number;value:ServiceHealth}|undefined;
let pending:Promise<ServiceHealth>|undefined;

/** Shared probes prevent a monitoring burst from adding a database request per caller. */
export async function serviceHealth():Promise<ServiceHealth>{
 if(cached&&cached.expiresAt>Date.now())return cached.value;
 if(pending)return pending;
 pending=(async()=>{
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
  const probe=async(path:string,database=false):Promise<Check>=>{
   if(!url||!key)return 'unavailable';
   try{
    const response=await fetch(`${url}${path}`,{headers:{apikey:key,...(database?{Authorization:`Bearer ${key}`}:{})},cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(!response.ok){await response.body?.cancel();return 'unavailable';}
    if(database){const rows:unknown=await response.json();return Array.isArray(rows)&&rows.some(row=>row?.id===1)?'ok':'unavailable';}
    await response.body?.cancel();return 'ok';
   }catch{return 'unavailable';}
  };
  const [database,authentication]=await Promise.all([probe('/rest/v1/icash_membership_offer?id=eq.1&select=id&limit=1',true),probe('/auth/v1/health')]);
  const value:ServiceHealth={status:database==='ok'&&authentication==='ok'?'ok':'degraded',checkedAt:new Date().toISOString(),checks:{database,authentication}};
  cached={value,expiresAt:Date.now()+(value.status==='ok'?10000:5000)};
  return value;
 })();
 try{return await pending;}finally{pending=undefined;}
}
