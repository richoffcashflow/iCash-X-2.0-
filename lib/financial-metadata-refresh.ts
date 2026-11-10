import {checkTargetingCapabilities} from '../scripts/check-dealmachine-targeting-capabilities.mjs';
import {canSaveSharedIntegrationCheck} from '../scripts/integration-check-write-policy.mjs';
type Db=(path:string,method?:string,body?:unknown)=>Promise<unknown>;
/** Refresh only free metadata; a durable shared claim bounds failures/concurrency. */
export async function refreshFinancialMetadata(db:Db,check=checkTargetingCapabilities,env=process.env){
 if(!canSaveSharedIntegrationCheck(env)||await db('rpc/icash_claim_financial_metadata','POST',{})!==true)return false;
 try{const result=await check(env);return result.status==='verified'&&result.catalogVersion===4;}catch{return false;}
}
