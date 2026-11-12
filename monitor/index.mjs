import http from 'node:http';
import {createExternalMonitor} from './runtime.mjs';
const monitor=createExternalMonitor({log:event=>console.info(JSON.stringify(event))});
let timer,stopping=false;const startedAt=Date.now();
const server=http.createServer((request,response)=>{
 if(request.url!=='/health'){response.writeHead(404);response.end();return;}
 const state=monitor.health();
 // Readiness is the observer's own fresh completed cycle, not a claim that the
 // observed application recovered. Deploy during an incident without hiding it.
 const fresh=state.lastCompletedAt&&Date.now()-Date.parse(state.lastCompletedAt)<180000;
 response.writeHead(fresh?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(state));
});
async function run(){
 if(stopping)return;
 const started=Date.now();
 try{await monitor.tick();}catch{console.error('External monitor cycle unavailable');}
 if(!stopping)timer=setTimeout(run,Math.max(1000,60000-(Date.now()-started)));
}
server.listen(Number(process.env.PORT||3001),'0.0.0.0',()=>{console.info('Independent reliability monitor started',{commit:process.env.RAILWAY_GIT_COMMIT_SHA});void run();});
const watchdog=setInterval(()=>{
 const last=monitor.health().lastCompletedAt;
 if(!stopping&&Date.now()-(last?Date.parse(last):startedAt)>180000){console.error('Independent monitor stalled; restarting');process.exit(1);}
},15000);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;clearTimeout(timer);clearInterval(watchdog);server.close();});
