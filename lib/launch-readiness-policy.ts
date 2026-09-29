export type LaunchChecks={cashReserve:boolean;discovery:boolean;voice:boolean;contactPermission:boolean;productionContracts:boolean;unresolvedDispatches:boolean};
export type LaunchEnvironment={data:boolean;voice:boolean;email:boolean;billing:boolean};
/** These require executable integrations, not flags claiming unfinished work is complete. */
export const deliveryCapabilities={allProviderCostSettlement:false,buyerOutreach:true,titleAndClosingExecution:false};
export function evaluateLaunch(checks:LaunchChecks,env:LaunchEnvironment){
 const blockers:string[]=[];
 for(const [key,ready] of Object.entries({dataProvider:env.data,voiceProvider:env.voice,emailAccess:env.email,billing:env.billing,...checks,...deliveryCapabilities})){
  if(key==='unresolvedDispatches'){if(ready)blockers.push(key);}else if(ready!==true)blockers.push(key);
 }
 return {ready:blockers.length===0,acquisitionReady:env.data&&env.voice&&checks.cashReserve&&checks.discovery&&checks.voice&&checks.contactPermission&&!checks.unresolvedDispatches,blockers};
}
