/** Restart only a stuck local worker, never a held job or a failed provider.
 * Stop fresh claims immediately; allow other in-flight handlers their complete
 * 235-second dispatch deadline before the bounded exit. Original DB tickets and
 * uncertain operations survive the process; this module never replays them.
 */
export function createWatchdog({isStalled,stop,exit,setTimer=setTimeout,clearTimer=clearTimeout,onStall=()=>{}}){
 let restarting=false,exited=false,timer;
 const finish=()=>{
  if(exited)return;
  exited=true;clearTimer(timer);exit(1);
 };
 return (active=true)=>{
  if(!active||restarting||!isStalled())return;
  restarting=true;
  timer=setTimer(finish,270000);
  try{onStall();}catch{/* Diagnostics cannot prevent recovery. */}
  // stop() synchronously prevents new claims before awaiting existing work.
  try{Promise.resolve(stop()).then(finish,finish);}catch{finish();}
 };
}
