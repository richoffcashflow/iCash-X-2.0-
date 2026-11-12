import {dispatchReliabilityAlerts} from './reliability-alerts-service.ts';
import {externalMonitorFresh} from './external-monitor-health.ts';
type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
export async function refreshReliability(db:Database,maintenanceOk:boolean){
 let monitored=true,refreshFailed=false;
 try{
  await db('rpc/icash_record_service_heartbeat','POST',{p_component:'maintenance',p_status:maintenanceOk?'ok':'degraded'});
 }catch{monitored=false;}
 try{await db('rpc/icash_repair_expired_research_configs','POST',{});}
 catch{monitored=false;refreshFailed=true;console.error(JSON.stringify({event:'icash_research_configuration_repair_unavailable'}));}
 try{
  const report=await db<{issueCount:number}>('rpc/icash_refresh_account_work_snapshot','POST',{});
  if(!Number.isSafeInteger(report?.issueCount)||report.issueCount<0)throw Error('Invalid monitor snapshot');
  if(report.issueCount)console.error(JSON.stringify({event:'icash_workflow_attention',issueCount:report.issueCount}));
 }catch{
  monitored=false;refreshFailed=true;
 }
 try{
  if(!await externalMonitorFresh(db))throw Error('External monitor stale');
 }catch{monitored=false;refreshFailed=true;console.error(JSON.stringify({event:'icash_external_monitor_unavailable'}));}
 if(refreshFailed){
  // Failed recovery or a failed snapshot cannot extend healthy recovery from
  // fresh old evidence. Both independent stages still run before observation.
  try{await db('rpc/icash_record_service_heartbeat','POST',{p_component:'maintenance',p_status:'degraded'});}
  catch{/* Alert observation remains independent of this telemetry write. */}
 }
 // Incident observation can detect stale monitoring even when refresh failed.
 // It uses persisted evidence and never fabricates a successful snapshot.
 try{const notification=await dispatchReliabilityAlerts({db});if(['needs_review','unconfigured','recipient_unverified'].includes(notification))console.error(JSON.stringify({event:'icash_owner_notification_attention',status:notification}));}
 catch{monitored=false;console.error(JSON.stringify({event:'icash_owner_notification_unavailable'}));}
 if(!monitored)console.error(JSON.stringify({event:'icash_reliability_monitor_unavailable'}));
 return monitored;
}
