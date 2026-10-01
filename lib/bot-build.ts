import type {BotProfile,BotSetup} from './bot-setup';

// A retry first reads the server's revision: a lost response may have saved
// successfully, and retrying the old revision would otherwise fail forever.
export type SetupEditableField='displayName'|'market'|'marketMode'|'voice';
export async function saveBotBuild(profile:BotProfile,current:BotSetup,options:{retry:boolean;signal:AbortSignal;request?:typeof fetch;nameOnly?:boolean;editedFields?:SetupEditableField[]}):Promise<BotSetup>{
 const request=options.request??fetch;
 if(options.retry){
  const response=await request('/api/setup',{cache:'no-store',signal:options.signal});
  const data=await response.json();
  if(!response.ok||!data.setup)throw Error('Could not restore your setup. Please try again.');
  if(data.setup.id!==current.id)throw Error('Your setup session changed. Reload before saving again.');
  current=data.setup;
  if(options.editedFields)profile={...profile,...current.profile,...Object.fromEntries(options.editedFields.map(field=>[field,profile[field]])),aiLogo:null};
  else if(options.nameOnly)profile={...profile,...current.profile,displayName:profile.displayName,aiLogo:null};
 }
 const response=await request('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',profile,stage:4,revision:current.revision}),signal:options.signal});
 const data=await response.json();
 if(!response.ok||!data.setup)throw Error(data.error??'Could not save your setup. Please try again.');
 if(data.setup.id!==current.id)throw Error('Your setup session changed. Reload before continuing.');
 return data.setup;
}

/** A short presentation transition, never simulated provider provisioning. */
export function waitForBotCreationTransition(started:number,signal:AbortSignal,reducedMotion:boolean):Promise<void>{
 const delay=reducedMotion?0:Math.max(0,5000-(Date.now()-started));
 if(signal.aborted)return Promise.reject(new DOMException('Creation interrupted.','AbortError'));
 if(!delay)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},delay);
  function abort(){clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new DOMException('Creation interrupted.','AbortError'));}
  signal.addEventListener('abort',abort,{once:true});
 });
}
