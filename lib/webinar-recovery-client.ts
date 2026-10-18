type RecoveryState='active'|'left'|'checkout';
export type RecoverySignal={sessionId:string;pageId:string;sequence:number;state:RecoveryState};

/** A departure is visibility/pagehide, never beforeunload (the viewer can choose Stay). */
export function installWebinarRecovery(sessionId:string,eligible:()=>boolean,send:(signal:RecoverySignal)=>void){
 const pageId=crypto.randomUUID();let sequence=0,last:RecoveryState|null=null;
 const emit=(state:RecoveryState,heartbeat=false)=>{
  if(state===last&&!heartbeat)return;
  last=state;send({sessionId,pageId,sequence:++sequence,state});
 };
 const leave=()=>{if(last!==null)emit(eligible()?'left':'checkout');};
 const sync=()=>{if(!document.hidden)emit(eligible()?'active':'checkout');};
 const visibility=()=>{if(document.hidden)leave();else sync();};
 document.addEventListener('visibilitychange',visibility);
 window.addEventListener('pagehide',leave);window.addEventListener('pageshow',sync);
 const timer=setInterval(()=>{if(!document.hidden)emit(eligible()?'active':'checkout',true);},25000);
 sync();
 // SPA/back navigation can unmount the room without pagehide. A Strict Mode
 // remount immediately reports active and cancels this during the same grace.
 return {sync,stop(){leave();clearInterval(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',sync);}};
}
