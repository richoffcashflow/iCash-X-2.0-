/** One bounded database write per minute; telemetry never gates customer work. */
export function createHeartbeat({rpc,health,now=Date.now,onFailure=()=>{}}){
 let pending=false,nextAt=0;
 return async()=>{
  if(pending||now()<nextAt)return;
  pending=true;nextAt=now()+60000;
  try{
   const state=health().body.status;
   await rpc('icash_record_service_heartbeat',{p_component:'worker',p_status:state==='screening'?'ok':state==='standby'?'standby':'degraded'});
  }catch{onFailure();}finally{pending=false;}
 };
}
