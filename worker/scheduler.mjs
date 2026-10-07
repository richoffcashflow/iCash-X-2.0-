/** Independent, sequential lanes: an outage in one never suppresses the other.
 * Retries claim fresh DB work; consumed provider capabilities are never replayed.
 */
export function createScheduler({screening,automation,now=Date.now,onFailure=()=>{}}){
 const lanes={screening:{failures:0,nextAt:0},automation:{failures:0,nextAt:0}};
 let running=false;
 return {
  health(active=true){
   const degraded=Object.values(lanes).some(lane=>lane.failures>0);
   return {code:active&&Object.values(lanes).some(lane=>lane.failures>=3)?503:200,
    body:{status:active?(degraded?'degraded':'screening'):'standby',outreachEnabled:false,
     automation:active?(lanes.automation.failures?'held':'available'):'standby'}};
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
      delay=name==='screening'&&worked?250:15000;
     }catch{
      lane.failures=Math.min(lane.failures+1,6);
      delay=name==='screening'?Math.min(60000,1000*2**lane.failures):Math.min(300000,15000*2**lane.failures);
      onFailure(name);
     }
     lane.nextAt=now()+delay;
    }
    return Math.max(0,Math.min(...Object.values(lanes).map(lane=>lane.nextAt))-now());
   }finally{running=false;}
  },
 };
}
