import assert from 'node:assert/strict';
import {test} from 'node:test';

async function fixture(storage=new Map()){
 const handlers=new Set(),navigations=[];let activated=true;
 globalThis.window={addEventListener:(name,fn)=>{assert.equal(name,'beforeunload');handlers.add(fn);},removeEventListener:(_name,fn)=>handlers.delete(fn),location:{assign:path=>navigations.push(path),replace:path=>navigations.push(path)}};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userActivation:{get hasBeenActive(){return activated;}}}});
 globalThis.sessionStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
 const api=await import('../lib/webinar-exit-reminder.ts?case='+Math.random());
 return {...api,handlers,navigations,storage,activate:value=>activated=value,leave(trusted=true){let prevented=0;const event={isTrusted:trusted,returnValue:'',preventDefault(){prevented++;}};for(const fn of [...handlers])fn(event);return prevented;}};
}

test('One real departure gets one prompt, including duplicate mounts and subsequent reloads',async()=>{
 const f=await fixture();f.installWebinarExitReminder();f.installWebinarExitReminder();
 assert.equal(f.leave(false),0,'Synthetic events cannot ask for a dialog');
 f.activate(false);assert.equal(f.leave(),0,'Wait for actual interaction');assert.equal(f.storage.size,0);
 f.activate(true);assert.equal(f.leave(),1);assert.equal(f.leave(),0,'Choosing Stay does not rearm');
 assert.equal(f.handlers.size,0);f.installWebinarExitReminder();assert.equal(f.handlers.size,0);
 const reload=await fixture(f.storage);reload.installWebinarExitReminder();assert.equal(reload.handlers.size,0,'A new document in the same tab remembers the reminder');
});
test('Checkout, completed video and verified VIP state can suppress the reminder synchronously',async()=>{
 const f=await fixture();let active=false;const stop=f.installWebinarExitReminder(()=>active);
 assert.equal(f.leave(),0);assert.equal(f.storage.size,0);active=true;assert.equal(f.leave(),1);stop();assert.equal(f.handlers.size,0);
});
test('Normal VIP and workspace navigation disarms every current guard without consuming the reminder',async()=>{
 for(const replace of [false,true]){
  const f=await fixture();f.installWebinarExitReminder();f.installWebinarExitReminder();f.navigateWebinar('/live/123457',replace);
  assert.deepEqual(f.navigations,['/live/123457']);assert.equal(f.handlers.size,0);assert.equal(f.leave(),0);assert.equal(f.storage.size,0);
  f.installWebinarExitReminder();assert.equal(f.leave(),1,'The next video can still remind once');
 }
});
test('Cleanup and unavailable browser storage never trap navigation',async()=>{
 let f=await fixture();const stop=f.installWebinarExitReminder();stop();stop();assert.equal(f.leave(),0);assert.equal(f.handlers.size,0);
 f=await fixture();sessionStorage.getItem=()=>{throw Error('Storage disabled');};f.installWebinarExitReminder();assert.equal(f.handlers.size,0);
 f=await fixture();f.installWebinarExitReminder();sessionStorage.setItem=()=>{throw Error('Storage full');};assert.equal(f.leave(),0);assert.equal(f.handlers.size,0);
});
test('Checkout and recovery links bypass the reminder only when leaving the current tab',async()=>{
 const f=await fixture();f.installWebinarExitReminder();
 const click={button:0,defaultPrevented:false,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false};
 for(const change of [{button:1},{defaultPrevented:true},{metaKey:true},{ctrlKey:true},{shiftKey:true},{altKey:true}]){
  f.allowWebinarLinkNavigation({...click,...change});assert.equal(f.handlers.size,1);
 }
 f.allowWebinarLinkNavigation(click);assert.equal(f.handlers.size,0);assert.equal(f.storage.size,0);
});
