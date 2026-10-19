import {processSellerIntake,type SellerDb} from './seller-pipeline.ts';

/** Refresh an expired shared lookup once, using the same receipt, cost and
 * ambiguous-outcome rules as first research. Never resubmit the seller form. */
export async function processSellerResearchRefresh(db:SellerDb,key:string|undefined,transport:typeof fetch=fetch){
 const refreshDb:SellerDb=<T>(path:string,method?:string,body?:unknown)=>{
  if(path==='rpc/icash_claim_seller_lookup')path='rpc/icash_claim_seller_research_refresh';
  else if(path==='rpc/icash_finish_seller_lookup')path='rpc/icash_finish_seller_research_refresh';
  else if(path.startsWith('icash_seller_intakes?'))path=path.replace('icash_seller_intakes?','icash_seller_research_refreshes?');
  return db<T>(path,method,body);
 };
 return processSellerIntake(refreshDb,key,transport);
}
