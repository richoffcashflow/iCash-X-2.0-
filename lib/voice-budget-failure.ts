/** Only this exact, atomic Postgres reservation rejection is safe to classify.
 * Network/HTTP ambiguity and all other failures retain reconciliation behavior. */
export class VoiceActivationBudgetError extends Error {
 constructor(){super('Voice activation budget exhausted');this.name='VoiceActivationBudgetError';}
}
export class ProspectingBudgetError extends Error {
 readonly quoteCents:number;
 constructor(quoteCents:number){super('Prospecting budget reached');this.name='ProspectingBudgetError';this.quoteCents=quoteCents;}
}
/** A rejected SMS claim is rolled back before any provider dispatch. */
export class SellerInventoryUnavailableError extends Error {
 constructor(){super('Seller inventory unavailable');this.name='SellerInventoryUnavailableError';}
}
export async function voiceReservationFailure(path:string,status:number,response:Response):Promise<Error>{
 const voice=['rpc/icash_reserve_paced_voice','rpc/icash_reserve_flexible_voice'].includes(path);
 if(status===400&&(voice||['rpc/icash_reserve_operation','rpc/icash_reserve_and_claim_property_discovery','rpc/icash_reserve_and_claim_filtered_discovery','rpc/icash_claim_text','rpc/icash_claim_customer_text'].includes(path))){
  try{const body=await response.json();
   if(['rpc/icash_claim_text','rpc/icash_claim_customer_text'].includes(path)&&body?.code==='P0001'&&body?.message==='Seller inventory assigned or suppressed')return new SellerInventoryUnavailableError();
   if(voice&&body?.code==='P0001'&&body?.message==='Activation spending cap reached')return new VoiceActivationBudgetError();
   if(body?.code==='P0001'&&body?.message==='Prospecting budget reached'){
    const detail=JSON.parse(body.details??'null');
    if(Number.isSafeInteger(detail?.quoteCents)&&detail.quoteCents>0)return new ProspectingBudgetError(detail.quoteCents);
   }
  }catch{/* Unrecognized response is not a safe budget rejection. */}
 }
 return new Error('Database request failed');
}
