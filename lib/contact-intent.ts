import {sellerResponseDisposition} from './seller-response-policy.ts';
/** Shared by authenticated SMS ingestion and analysis. Explicit withdrawal wins
 * over a callback in the same message; ordinary uses such as "stop by" do not. */
export function isContactOptOut(body:string){
 return sellerResponseDisposition(body)==='opt_out';
}
export function asksForCallback(body:string){
 return !isContactOptOut(body)&&/\b(?:call me|call back|callback|can you call|could you call|call tomorrow|call today)\b/i.test(body)
  && !/\b(?:do not|don't|dont|cannot|can't|no)\s+(?:call|callback)\b/i.test(body);
}
