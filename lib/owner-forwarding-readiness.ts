import {z} from 'zod';
import {ownerInboundTarget} from './owner-inbound-acceptance.ts';

// Official GET contract, reviewed 2026-10-02:
// https://docs.contiguity.com/api-reference/product/leases/call-forwarding
// This adapter cannot enable/disable forwarding, reserve credit or make a call.
const e164=z.string().regex(/^\+[1-9]\d{7,14}$/);
const receipt=z.object({object:z.literal('response'),data:z.object({
 number:e164,call_forwarding:z.object({enabled:z.boolean(),to:e164.nullable(),
 status:z.enum(['active','queued']),estimated_completion:z.number().int().nonnegative().nullable()})
})});
type Environment={CONTIGUITY_API_KEY?:string;CONTIGUITY_FROM?:string};
const maxBytes=65536;
export type ForwardingReadinessError='configuration_unavailable'|'provider_auth_failed'|'provider_access_denied'|'provider_request_rejected'|'provider_unavailable'|'provider_receipt_invalid';
export class OwnerForwardingError extends Error{
 readonly code:ForwardingReadinessError;
 constructor(code:ForwardingReadinessError){super(code);this.code=code;}
}
export async function readOwnerForwarding(env:Environment,fetcher:typeof fetch=fetch){
 if(typeof window!=='undefined')throw new OwnerForwardingError('configuration_unavailable');
 const key=env.CONTIGUITY_API_KEY,source=ownerInboundTarget.sourceNumber;
 if(env.CONTIGUITY_FROM!==source||typeof key!=='string'||!key.length||key.length>4096||!/^[\x21-\x7e]+$/.test(key))throw new OwnerForwardingError('configuration_unavailable');
 const url=`https://api.contiguity.com/numbers/lease/${encodeURIComponent(source)}/call_forwarding`;
 const signal=AbortSignal.timeout(8000);
 let response:Response;
 try{response=await fetcher(url,{method:'GET',headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},cache:'no-store',redirect:'error',credentials:'omit',signal});}
 catch{throw new OwnerForwardingError('provider_unavailable');}
 if(response.redirected||(response.url&&response.url!==url))throw new OwnerForwardingError('provider_unavailable');
 if(!response.ok){
  const code=response.status===401?'provider_auth_failed':response.status===403?'provider_access_denied':response.status===400?'provider_request_rejected':'provider_unavailable';
  throw new OwnerForwardingError(code);
 }
 let parsed:z.infer<typeof receipt>;
 try{
  const length=response.headers.get('content-length');
  if(length&&(!/^\d+$/.test(length)||Number(length)>maxBytes))throw Error();
  if(!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:;|$)/i.test(response.headers.get('content-type')??'')||!response.body)throw Error();
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){signal.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)throw new OwnerForwardingError('provider_receipt_invalid');chunks.push(part.value);}}
  catch(error){await reader.cancel().catch(()=>undefined);throw error instanceof OwnerForwardingError?error:new OwnerForwardingError('provider_unavailable');}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  parsed=receipt.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  const f=parsed.data.call_forwarding;
  if(parsed.data.number!==source||(f.enabled?f.to===null:f.to!==null)||(f.status==='active'?f.estimated_completion!==null:f.estimated_completion===null))throw Error();
 }catch(error){throw error instanceof OwnerForwardingError?error:new OwnerForwardingError('provider_receipt_invalid');}
 const f=parsed.data.call_forwarding;
 return {sourcePhone:source,expectedDestination:ownerInboundTarget.ingressNumber,
  enabled:f.enabled,destination:f.to,providerStatus:f.status,estimatedCompletion:f.estimated_completion,
  routeConfigured:f.enabled&&f.status==='active'&&f.to===ownerInboundTarget.ingressNumber,
  callVerification:'not_tested' as const,forwardingCostVerified:false as const,
  checkedAt:new Date().toISOString()};
}
