/** Only this exact, atomic Postgres reservation rejection is safe to classify.
 * Network/HTTP ambiguity and all other failures retain reconciliation behavior. */
export class VoiceActivationBudgetError extends Error {
 constructor(){super('Voice activation budget exhausted');this.name='VoiceActivationBudgetError';}
}
export async function voiceReservationFailure(path:string,status:number,response:Response):Promise<Error>{
 if(status===400&&['rpc/icash_reserve_paced_voice','rpc/icash_reserve_flexible_voice'].includes(path)){
  try{const body=await response.json();if(body?.code==='P0001'&&body?.message==='Activation spending cap reached')return new VoiceActivationBudgetError();}catch{/* Unrecognized response is not a safe budget rejection. */}
 }
 return new Error('Database request failed');
}
