import {createHash} from 'node:crypto';
import {object} from './required-call-recording.ts';
import {emptyQuotaRejection} from './voice-result.ts';

export const sellerCallSourceVersion='seller-call-source-v1';
export const sellerCallSourceMaxBytes=262144;
export const sellerCallSourceMaxTurns=1000;

/** Preserve the original provider array, including malformed and oversized
 * speech. A bounded missing-body receipt is a coverage hold, never a clipped
 * transcript represented as complete. The provider was already fetched and
 * identity-checked by the ordinary original-call reconciliation path. */
export function sellerCallSource(raw:unknown){
 const c=object(raw),metadata=object(c.metadata);
 const transcript=c.transcript;
 const rawJson=JSON.stringify(transcript??null);
 const rawBytes=Buffer.byteLength(rawJson,'utf8');
 const start=metadata.start_time_unix_secs;
 const startedAt=typeof start==='number'&&Number.isFinite(start)&&start>0&&start*1000<=Date.now()
  &&start*1000<=8640000000000000?new Date(start*1000).toISOString():null;
 return {version:sellerCallSourceVersion,conversationId:c.conversation_id,agentId:c.agent_id,status:c.status,emptyQuotaRejection:emptyQuotaRejection(c),
  startedAt,rawSha256:createHash('sha256').update(rawJson,'utf8').digest('hex'),rawBytes,
  rawTurnCount:Array.isArray(transcript)?transcript.length:null,
  rawJson:rawBytes<=sellerCallSourceMaxBytes?rawJson:null};
}

type Database=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
export async function captureSellerCallSource(db:Database,kind:'outbound'|'inbound',id:string,raw:unknown){
 const saved=await db('rpc/icash_capture_seller_call_source','POST',{p_kind:kind,p_source:id,p_evidence:sellerCallSource(raw)});
 if(saved!==true)throw Error('SELLER_CALL_SOURCE_NOT_SAVED');
}
