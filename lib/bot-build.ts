import type {BotProfile,BotSetup} from './bot-setup';

// A retry first reads the server's revision: a lost response may have saved
// successfully, and retrying the old revision would otherwise fail forever.
export async function saveBotBuild(profile:BotProfile,current:BotSetup,options:{retry:boolean;signal:AbortSignal;request?:typeof fetch}):Promise<BotSetup>{
 const request=options.request??fetch;
 if(options.retry){
  const response=await request('/api/setup',{cache:'no-store',signal:options.signal});
  const data=await response.json();
  if(!response.ok||!data.setup)throw Error('Could not restore your setup. Please try again.');
  current=data.setup;
 }
 const response=await request('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',profile,stage:4,revision:current.revision}),signal:options.signal});
 const data=await response.json();
 if(!response.ok||!data.setup)throw Error(data.error??'Could not save your setup. Please try again.');
 return data.setup;
}
