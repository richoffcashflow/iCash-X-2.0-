// Explicit Call clicks survive effect replay and are canceled if the panel closes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url),timers=new Map(),effects=[],refs=[];
let cursor=0,handled=0,started=0,stopped=0,index=0;
const original={window:globalThis.window,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
globalThis.window={addEventListener(){},removeEventListener(){}};
globalThis.setTimeout=fn=>{const id=++index;timers.set(id,fn);return id;};
globalThis.clearTimeout=id=>timers.delete(id);
try{
 const module={exports:{}};
 const source=ts.transpileModule(readFileSync(new URL('../components/browser-call-controls.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',source)(name=>{
  if(name==='react')return {useState:v=>[v,()=>{}],useRef:v=>refs[cursor++]??(refs[cursor-1]={current:v}),useEffect:fn=>effects.push(fn),useEffectEvent:fn=>fn};
  if(name==='@/components/owner-phone-privacy')return {PrivatePhone:({children})=>children};
  if(name==='@/lib/browser-call-session')return {guardBrowserCallCallbacks:(_current,callbacks)=>callbacks,BrowserCallSession:class{async start(){started++;}async stop(){stopped++;}}};
  if(name==='lucide-react')return {Mic:()=>null,MicOff:()=>null,Phone:()=>null,PhoneOff:()=>null};
  return require(name);
 },module,module.exports);
 module.exports.BrowserCallControls({screeningId:'fixture',contacts:[{phone:'+12025550101',available:true}],autoStart:true,onAutoStartHandled(){handled++;},onFinished(){}});
 let cleanups=effects.map(fn=>fn());assert.equal(started,0,'Mount does not consume the click before effect cleanup');
 cleanups.forEach(fn=>fn?.());assert.equal(timers.size,0,'Cleanup cancels an unstarted click');
 cleanups=effects.map(fn=>fn());assert.equal(timers.size,1,'Effect replay schedules exactly one call');
 for(const [id,fn] of [...timers]){timers.delete(id);fn();}await Promise.resolve();
 assert.equal(started,1);assert.equal(handled,1);
 cleanups.forEach(fn=>fn?.());assert.equal(stopped,1,'Closing still ends the created session');
 console.log('PASS explicit call start: effect replay consumes one click, early close cancels it, and active close ends the session.');
}finally{Object.assign(globalThis,original);}
