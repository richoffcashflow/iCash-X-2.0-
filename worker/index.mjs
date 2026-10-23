import http from 'node:http';
import {createRpc,tick,automationTick} from './runner.mjs';
import {createScheduler} from './scheduler.mjs';
import {createHeartbeat} from './heartbeat.mjs';
const configured=Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SECRET_KEY);
const active=configured&&process.env.SCREENING_WORKER_ENABLED==='true';
let stopping=false,timer,heartbeatTimer;
const rpc=configured?createRpc(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY):null;
const scheduler=createScheduler({screening:()=>tick(rpc),automation:()=>automationTick(rpc),
 onFailure:lane=>console.error(lane==='screening'?'Screening database unavailable; backing off':'Automation held; backing off; reconciliation may be required')});
async function loop(){
 if(stopping||!rpc||!active)return;
 const delay=await scheduler.run();
 if(!stopping)timer=setTimeout(loop,delay);
}
const server=http.createServer((req,res)=>{
 if(req.url!=='/health'){res.writeHead(404);res.end();return;}
 const health=scheduler.health(active);
 res.writeHead(health.code,{'content-type':'application/json'});
 res.end(JSON.stringify(health.body));
});
const heartbeat=rpc?createHeartbeat({rpc,health:()=>scheduler.health(active),onFailure:()=>console.error('Worker heartbeat unavailable')}):null;
server.listen(Number(process.env.PORT||3001),'0.0.0.0',()=>{
 console.info('Worker started',{active,automationConcurrency:scheduler.health(active).body.automationConcurrency});
 if(active)void loop();
 if(heartbeat){void heartbeat();heartbeatTimer=setInterval(()=>void heartbeat(),60000);}
});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;clearTimeout(timer);clearInterval(heartbeatTimer);server.close();void scheduler.stop();});
