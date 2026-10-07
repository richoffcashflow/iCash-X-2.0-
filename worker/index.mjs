import http from 'node:http';
import {createRpc,tick,automationTick} from './runner.mjs';
import {createScheduler} from './scheduler.mjs';
const configured=Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SECRET_KEY);
const active=configured&&process.env.SCREENING_WORKER_ENABLED==='true';
let stopping=false,timer;
const rpc=active?createRpc(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY):null;
const scheduler=createScheduler({screening:()=>tick(rpc),automation:()=>automationTick(rpc),
 onFailure:lane=>console.error(lane==='screening'?'Screening database unavailable; backing off':'Automation held; backing off; reconciliation may be required')});
async function loop(){
 if(stopping||!rpc)return;
 const delay=await scheduler.run();
 if(!stopping)timer=setTimeout(loop,delay);
}
const server=http.createServer((req,res)=>{
 if(req.url!=='/health'){res.writeHead(404);res.end();return;}
 const health=scheduler.health(active);
 res.writeHead(health.code,{'content-type':'application/json'});
 res.end(JSON.stringify(health.body));
});
server.listen(Number(process.env.PORT||3001),'0.0.0.0',()=>{if(active)void loop();});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;clearTimeout(timer);server.close();});
