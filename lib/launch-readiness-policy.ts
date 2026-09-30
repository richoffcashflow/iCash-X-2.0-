export type LaunchChecks={cashReserve:boolean;discovery:boolean;voice:boolean;contactPermission:boolean;productionContracts:boolean;unresolvedDispatches:boolean};
export type LaunchEnvironment={data:boolean;voice:boolean;email:boolean;billing:boolean};
/** Completed/accepted work settles against versioned estimates; unknown delivery remains held. */
export const deliveryCapabilities={allProviderCostSettlement:true,buyerOutreach:true,titleAndClosingExecution:false};
export function evaluateLaunch(checks:LaunchChecks,env:LaunchEnvironment){
 const blockers:string[]=[];
 // An empty contact list must not block setup or funding. Permission is enforced
 // per recipient by dispatch, not by whether any permission row exists globally.
 const {contactPermission: _contactPermission,...operationalChecks}=checks;
 for(const [key,ready] of Object.entries({dataProvider:env.data,voiceProvider:env.voice,emailAccess:env.email,billing:env.billing,...operationalChecks,...deliveryCapabilities})){
  if(key==='unresolvedDispatches'){if(ready)blockers.push(key);}else if(ready!==true)blockers.push(key);
 }
 return {ready:blockers.length===0,acquisitionReady:env.data&&env.voice&&checks.cashReserve&&checks.discovery&&checks.voice&&!checks.unresolvedDispatches,blockers};
}
