import {readWorkspaceEventToken} from '../lib/workspace-event-token.ts';
const origins=new Set(['https://www.geticashx.com','https://geticashx.com']);
/** One small revision query serves many open dashboards. No private rows stream. */
export function createWorkspaceEvents({rpc,key,now=Date.now,allowedOrigins=origins}){
 const clients=new Set();let polling=false,closed=false,lastPing=0;
 function handle(req,res){
  if(req.url!=='/workspace/events')return false;
  const origin=req.headers.origin;
  if(!allowedOrigins.has(origin)){res.writeHead(403);res.end();return true;}
  const headers={'Access-Control-Allow-Origin':origin,'Vary':'Origin','Cache-Control':'private, no-store'};
  if(req.method==='OPTIONS'){res.writeHead(204,{...headers,'Access-Control-Allow-Methods':'GET','Access-Control-Allow-Headers':'Authorization','Access-Control-Max-Age':'300'});res.end();return true;}
  if(req.method!=='GET'){res.writeHead(405,headers);res.end();return true;}
  const auth=req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  const scope=auth&&readWorkspaceEventToken(auth,key,now());
  if(!scope){res.writeHead(401,headers);res.end();return true;}
  if(clients.size>=1000||[...clients].filter(c=>c.accountId===scope.accountId).length>=10||!clients.size&&closed){res.writeHead(503,headers);res.end();return true;}
  res.writeHead(200,{...headers,'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': connected\n\n');
  const client={...scope,res,revision:null};clients.add(client);res.on('close',()=>clients.delete(client));
  return true;
 }
 async function poll(){
  if(closed||polling||!clients.size)return;polling=true;
  try{
   for(const c of clients)if(c.expiresAt<=now()||c.res.destroyed){c.res.end();clients.delete(c);}
   const ids=[...new Set([...clients].map(c=>c.accountId))];
   for(let i=0;i<ids.length;i+=100){
    const batch=ids.slice(i,i+100),versions=await rpc('icash_workspace_revision_batch',{p_accounts:batch});
    if(!versions||typeof versions!=='object'||Array.isArray(versions))throw Error('Invalid revisions');
    for(const c of clients){
     if(!batch.includes(c.accountId))continue;
     const revision=versions[c.accountId]??'0';if(typeof revision!=='string'||!/^\d{1,20}$/.test(revision))throw Error('Invalid revision');
     if(c.revision!==revision){c.revision=revision;if(!c.res.write(`event: revision\ndata: ${JSON.stringify({revision})}\n\n`)){c.res.end();clients.delete(c);}}
    }
   }
   if(now()-lastPing>=20000){lastPing=now();for(const c of clients)if(!c.res.write(': heartbeat\n\n')){c.res.end();clients.delete(c);}}
  }catch{for(const c of clients)c.res.end();clients.clear();}
  finally{polling=false;}
 }
 function close(){closed=true;for(const c of clients)c.res.end();clients.clear();}
 return {handle,poll,close,size:()=>clients.size};
}
