/** Bounded independent lanes. A slow provider never stops pure screening or
 * another account's work. Each automation attempt claims a fresh DB capability;
 * the shared database still enforces call capacity, funding and recipient locks.
 */
export function createScheduler({screening,automation,automationConcurrency=4,automationPools,now=Date.now,onFailure=()=>{}}){
 if(automationPools!==undefined){
  if(!Array.isArray(automationPools)||automationPools.length<1||automationPools.length>16||automationPools.some(pool=>!['general','research','voice','messages','recovery'].includes(pool)))throw Error('INVALID_WORKER_POOLS');
  automationConcurrency=automationPools.length;
 }else if(!Number.isInteger(automationConcurrency)||automationConcurrency<1||automationConcurrency>4)throw Error('INVALID_WORKER_CONCURRENCY');
 const lane=(name,work,pool=name)=>({name,pool,work,failures:0,idle:0,nextAt:0,pending:null,startedAt:0});
 const screeningLane=lane('screening',screening);
 const automationLanes=Array.from({length:automationConcurrency},(_,i)=>lane('automation',()=>automation(automationPools?.[i]),automationPools?.[i]??'automation'));
 const lanes=[screeningLane,...automationLanes];
 let stopped=false,lastLoopAt=now(),nextAutomationAt=0,cursor=0;
 const start=lane=>{
  lane.startedAt=now();
  lane.pending=Promise.resolve().then(lane.work).then(worked=>{
   lane.failures=0;lane.idle=worked?0:Math.min(lane.idle+1,3);
   const delay=worked?(lane.name==='screening'?250:automationPools?100:1000):Math.min(lane.name==='automation'?15000:60000,(lane.name==='automation'?5000:15000)*2**(lane.idle-1));
   lane.nextAt=now()+delay;
  },error=>{
   lane.failures=Math.min(lane.failures+1,6);
   lane.nextAt=now()+(lane.name==='screening'?Math.min(60000,1000*2**lane.failures):Math.min(300000,15000*2**lane.failures));
   try{onFailure(lane.pool,error);}catch{/* Reporting must never poison the scheduler. */}
  }).finally(()=>{lane.pending=null;});
 };
 return {
  health(active=true){
   const stalled=now()-lastLoopAt>180000||lanes.some(lane=>lane.pending&&now()-lane.startedAt>(lane.name==='automation'?140000:75000));
   const degraded=stalled||lanes.some(lane=>lane.failures>0);
   const automationHeld=automationLanes.every(lane=>lane.failures>0);
   const pools=[...new Set(automationLanes.map(lane=>lane.pool))].map(name=>{
    const group=automationLanes.filter(lane=>lane.pool===name);
    return {name,capacity:group.length,inFlight:group.filter(lane=>lane.pending).length,failed:group.every(lane=>lane.failures>=3)};
   });
   const failed=screeningLane.failures>=3||pools.some(pool=>pool.failed);
   return {code:active&&(stalled||failed)?503:200,
    body:{status:active?(degraded?'degraded':'screening'):'standby',outreachEnabled:false,
     automation:active?(stalled||automationHeld?'held':'available'):'standby',
     automationConcurrency,automationInFlight:automationLanes.filter(lane=>lane.pending).length,...(automationPools?{pools}:{}),
     screeningInFlight:!!screeningLane.pending}};
  },
  run(){
   if(stopped)return 60000;
   lastLoopAt=now();
   if(!screeningLane.pending&&now()>=screeningLane.nextAt)start(screeningLane);
   if(now()>=nextAutomationAt)for(let offset=0;offset<automationLanes.length;offset++){
    const index=(cursor+offset)%automationLanes.length,lane=automationLanes[index];
    if(lane.pending||now()<lane.nextAt)continue;
    // Rotate even when a fast lane finishes first. Independent provider waits
    // may overlap, while fresh database claims remain staggered and bounded.
    nextAutomationAt=now()+(automationPools?250:1000);
    cursor=(index+1)%automationLanes.length;start(lane);break;
   }
   return Math.max(1,Math.min(...lanes.map(lane=>lane.pending?250:Math.max(lane.nextAt,lane.name==='automation'?nextAutomationAt:0)-now())));
  },
  async stop(){
   stopped=true;
   // Finish known attempts; never issue a replacement during shutdown.
   await Promise.allSettled(lanes.map(lane=>lane.pending).filter(Boolean));
  },
 };
}
