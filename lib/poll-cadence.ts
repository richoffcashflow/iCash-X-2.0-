/** Fast while messages are changing or a send is unresolved; bounded idle backoff. */
export function createPollCadence(){
 let last:string|undefined,delay=5000;
 return {
  observe(value:unknown,active=false){
   const next=JSON.stringify(value);
   delay=active||next!==last?5000:Math.min(30000,delay*2);
   last=next;return delay;
  },
  failed(){delay=Math.min(30000,delay*2);return delay;},
 };
}
