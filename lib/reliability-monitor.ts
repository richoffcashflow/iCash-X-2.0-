type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
export async function refreshReliability(db:Database,maintenanceOk:boolean){
 try{
  await db('rpc/icash_record_service_heartbeat','POST',{p_component:'maintenance',p_status:maintenanceOk?'ok':'degraded'});
  const report=await db<{issueCount:number}>('rpc/icash_refresh_reliability_snapshot','POST',{});
  if(!Number.isSafeInteger(report?.issueCount)||report.issueCount<0)throw Error('Invalid monitor snapshot');
  if(report.issueCount)console.error(JSON.stringify({event:'icash_workflow_attention',issueCount:report.issueCount}));
  return true;
 }catch{console.error(JSON.stringify({event:'icash_reliability_monitor_unavailable'}));return false;}
}
