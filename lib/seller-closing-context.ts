import {canonical,object} from './required-call-recording.ts';
export type SellerClosingContext={priceCents:number;earnestCents:number;inspectionDays:number|null;closingDate:string;effectiveDate:string;escrowAgent:string;dealNotes:string};
type Db=<T>(path:string)=>Promise<T>;
/** An approved pending agreement supplies an exact price, never an estimated ceiling. */
export async function loadSellerClosingContext(db:Db,account:string,screening:string,phone:string,ceiling:number|null):Promise<SellerClosingContext|null>{
 if(ceiling===null)return null;
 const deals=await db<{id:string;terms:unknown}[]>(`icash_deal_files?account_id=eq.${account}&screening_id=eq.${screening}&stage=eq.draft&select=id,terms&limit=2`);
 if(deals.length!==1)return null;
 const d=deals[0],t=object(d.terms),price=t.priceCents;
 if(!Number.isSafeInteger(price)||Number(price)<=0||Number(price)>ceiling||t.priceSource!=='seller_reported'||!Number.isSafeInteger(t.earnestCents)||Number(t.earnestCents)<0)return null;
 const envelopes=await db<{terms:unknown;recipients:unknown}[]>(`icash_signing_envelopes?account_id=eq.${account}&deal_id=eq.${d.id}&kind=eq.purchase&state=eq.awaiting_counterparty&test_mode=eq.false&select=terms,recipients&limit=2`);
 if(envelopes.length!==1||JSON.stringify(canonical(envelopes[0].terms))!==JSON.stringify(canonical(d.terms)))return null;
 const recipients=envelopes[0].recipients;
 if(!Array.isArray(recipients)||!recipients.slice(0,-1).some(r=>object(r).phone===phone))return null;
 return {priceCents:Number(price),earnestCents:Number(t.earnestCents),inspectionDays:Number.isSafeInteger(t.inspectionDays)?Number(t.inspectionDays):null,closingDate:typeof t.closingDate==='string'?t.closingDate:'',effectiveDate:typeof t.effectiveDate==='string'?t.effectiveDate:'',escrowAgent:typeof t.escrowAgent==='string'?t.escrowAgent:'',dealNotes:typeof t.dealNotes==='string'?t.dealNotes.slice(0,4000):''};
}
