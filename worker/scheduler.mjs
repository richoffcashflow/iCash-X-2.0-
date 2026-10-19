/** Independent, sequential lanes: an outage in one never suppresses the other.
 * Retries claim fresh DB work; consumed provider capabilities are never replayed.
 */
export function createScheduler({screening,automation,now=Date.now,onFailure=()=>{}}){
 const lanes={screening:{failures:0,idle:0,nextAt:0},automation:{failures:0,idle:0,nextAt:0}};
 let running=false,lastLoopAt=now();
 return {
  health(active=true){
   const stalled=now()-lastLoopAt>180000;
   const degraded=stalled||Object.values(lanes).some(lane=>lane.failures>0);
   return {code:active&&(stalled||Object.values(lanes).some(lane=>lane.failures>=3))?503:200,
    body:{status:active?(degraded?'degraded':'screening'):'standby',outreachEnabled:false,
     automation:active?(stalled||lanes.automation.failures?'held':'available'):'standby'}};
  },
  async run(){
   if(running)throw Error('WORKER_LOOP_ALREADY_RUNNING');
   running=true;
   try{
    for(const [name,work] of [['screening',screening],['automation',automation]]){
     const lane=lanes[name];
     if(now()<lane.nextAt)continue;
     let delay;
     try{
      const worked=await work();lane.failures=0;
      lane.idle=worked?0:Math.min(lane.idle+1,3);
      delay=worked?(name==='screening'?250:1000):Math.min(name==='automation'?15000:60000,(name==='automation'?5000:15000)*2**(lane.idle-1));
     }catch{
      lane.failures=Math.min(lane.failures+1,6);
      delay=name==='screening'?Math.min(60000,1000*2**lane.failures):Math.min(300000,15000*2**lane.failures);
      onFailure(name);
     }
     lane.nextAt=now()+delay;
    }
    return Math.max(0,Math.min(...Object.values(lanes).map(lane=>lane.nextAt))-now());
   }finally{running=false;lastLoopAt=now();}
  },
 };
}
