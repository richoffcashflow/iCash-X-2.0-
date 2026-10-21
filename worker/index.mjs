import http from 'node:http';
import {createRpc,tick,automationTick} from './runner.mjs';
import {createScheduler} from './scheduler.mjs';
import {createHeartbeat} from './heartbeat.mjs';
import {createWorkspaceEvents} from './workspace-events.mjs';
const configured=Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SECRET_KEY);
const active=configured&&process.env.SCREENING_WORKER_ENABLED==='true';
let stopping=false,timer,heartbeatTimer,eventsTimer,learningTimer,learningBusy=false;
const rpc=configured?createRpc(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY):null;
const events=rpc?createWorkspaceEvents({rpc,key:process.env.SUPABASE_SECRET_KEY}):null;
async function refreshLearning(){
 if(!rpc||learningBusy||stopping)return;learningBusy=true;
 try{const result=await rpc('icash_refresh_shared_learning',{p_limit:2});if(result?.failed)console.error('Shared learning refresh needs review');}
 catch{console.error('Shared learning refresh unavailable');}finally{learningBusy=false;}
}
const scheduler=createScheduler({screening:()=>tick(rpc),automation:()=>automationTick(rpc),
 onFailure:lane=>console.error(lane==='screening'?'Screening database unavailable; backing off':'Automation held; backing off; reconciliation may be required')});
async function loop(){
 if(stopping||!rpc||!active)return;
 const delay=await scheduler.run();
 if(!stopping)timer=setTimeout(loop,delay);
}
const server=http.createServer((req,res)=>{
 if(events?.handle(req,res))return;
 if(req.url!=='/health'){res.writeHead(404);res.end();return;}
 const health=scheduler.health(active);
 res.writeHead(health.code,{'content-type':'application/json'});
 res.end(JSON.stringify(health.body));
});
const heartbeat=rpc?createHeartbeat({rpc,health:()=>scheduler.health(active),onFailure:()=>console.error('Worker heartbeat unavailable')}):null;
server.listen(Number(process.env.PORT||3001),'0.0.0.0',()=>{
 if(active)void loop();
 if(heartbeat){void heartbeat();heartbeatTimer=setInterval(()=>void heartbeat(),60000);}
 if(events)eventsTimer=setInterval(()=>void events.poll(),2000);
 if(rpc){void refreshLearning();learningTimer=setInterval(()=>void refreshLearning(),15000);}
});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;clearTimeout(timer);clearInterval(heartbeatTimer);clearInterval(eventsTimer);clearInterval(learningTimer);events?.close();server.close();});
