type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
/** Once the companion has reported, loss of its heartbeat is itself an outage.
 * A degraded observed app is not a stopped observer and must not form a loop. */
export async function externalMonitorFresh(db:Database,now=Date.now()){
 const rows=await db<Array<{checked_at:string;result:{observedAt?:string;releaseSha?:string;intervalMs?:number}}>>('icash_integration_checks?provider=eq.external_reliability_monitor_v1&select=checked_at,result&limit=1','GET');
 if(Array.isArray(rows)&&rows.length===0)return true; // Companion not installed yet.
 if(!Array.isArray(rows)||rows.length!==1)return false;
 const row=rows[0],checked=Date.parse(row.checked_at),observed=Date.parse(row.result?.observedAt??'');
 return Number.isFinite(checked)&&Number.isFinite(observed)&&Math.abs(checked-observed)<=1000
  &&now-checked>=-5000&&now-checked<180000&&row.result?.intervalMs===60000&&/^[a-f0-9]{40}$/.test(row.result?.releaseSha??'');
}
