import http from 'node:http';
import {createRpc,tick} from './runner.mjs';
const configured=Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SECRET_KEY);
const active=configured&&process.env.SCREENING_WORKER_ENABLED==='true';
let stopping=false,timer,failures=0;
const rpc=active?createRpc(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY):null;
async function loop(){
 if(stopping||!rpc)return;
 let worked=false;
 try{worked=await tick(rpc);failures=0;}catch{failures=Math.min(failures+1,6);console.error('Screening database unavailable; backing off');}
 if(!stopping)timer=setTimeout(loop,failures?Math.min(60000,1000*2**failures):worked?250:15000);
}
const server=http.createServer((req,res)=>{
 if(req.url!=='/health'){res.writeHead(404);res.end();return;}
 res.writeHead(failures>=3?503:200,{'content-type':'application/json'});
 res.end(JSON.stringify({status:active?(failures?'degraded':'screening'):'standby',outreachEnabled:false}));
});
server.listen(Number(process.env.PORT||3001),'0.0.0.0',()=>{if(active)void loop();});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;clearTimeout(timer);server.close();});
