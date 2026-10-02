'use client';
import {useEffect,useRef,useState} from 'react';
import {z} from 'zod';
const phone=z.string().regex(/^\+[1-9]\d{7,14}$/);
const resultSchema=z.object({sourcePhone:phone,expectedDestination:phone,enabled:z.boolean(),destination:phone.nullable(),providerStatus:z.enum(['active','queued']),estimatedCompletion:z.number().int().nonnegative().max(8640000000000000).nullable(),routeConfigured:z.boolean(),callVerification:z.literal('not_tested'),forwardingCostVerified:z.literal(false),checkedAt:z.string().datetime()}).refine(r=>(r.enabled?r.destination!==null:r.destination===null)&&(r.providerStatus==='active'?r.estimatedCompletion===null:r.estimatedCompletion!==null)&&r.routeConfigured===(r.enabled&&r.providerStatus==='active'&&r.destination===r.expectedDestination));
type Result=z.infer<typeof resultSchema>;
const errors:Record<string,string>={sign_in_required:'Sign in to the owner account to check forwarding.',owner_required:'This forwarding check is available only to the configured owner.',configuration_unavailable:'The existing server configuration is unavailable. Forwarding status is unknown.',provider_auth_failed:'Contiguity did not accept the existing server authentication. Forwarding status is unknown.',provider_access_denied:'Contiguity denied this leased-number read. Forwarding status is unknown.',provider_request_rejected:'Contiguity rejected the status request. Forwarding status is unknown.',provider_unavailable:'Contiguity is unavailable. Forwarding status is unknown.',provider_receipt_invalid:'Contiguity returned an unrecognized status response. Forwarding status is unknown.'};
export default function ForwardingStatus(){
 const [result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('Forwarding status has not been checked.');
 const inFlight=useRef<AbortController|null>(null),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;inFlight.current?.abort();};},[]);
 async function refresh(){
  if(inFlight.current)return;
  const controller=new AbortController();inFlight.current=controller;setBusy(true);setResult(null);setMessage('Checking forwarding…');
  try{
   const response=await fetch('/api/owner-inbound-acceptance/forwarding',{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(65000)])});
   const body:unknown=await response.json();
   if(!mounted.current)return;
   if(!response.ok){const error=z.object({status:z.string()}).safeParse(body);setMessage(error.success&&Object.hasOwn(errors,error.data.status)?errors[error.data.status]:'Forwarding status is unavailable. Try checking again later.');return;}
   const parsed=resultSchema.safeParse(body);
   if(!parsed.success){setMessage('Forwarding status is unknown because the response could not be verified.');return;}
   setResult(parsed.data);setMessage('Read-only forwarding status received.');
  }catch{if(mounted.current)setMessage('Forwarding status is unavailable. Try checking again later.');}
  finally{if(inFlight.current===controller)inFlight.current=null;if(mounted.current)setBusy(false);}
 }
 return <section aria-label="Source number forwarding status" style={{border:'1px solid #bbb',borderRadius:8,padding:16,marginBlock:20}}>
  <h2>Call forwarding</h2>
  <p>This check reads the current Contiguity setting. It does not change forwarding or start a call.</p>
  <button type="button" disabled={busy} onClick={refresh}>{busy?'Checking forwarding…':'Check forwarding status'}</button>
  <p role="status" aria-live="polite">{message}</p>
  {result&&<dl>
   <dt>Leased source</dt><dd>{result.sourcePhone}</dd>
   <dt>Forwarding</dt><dd>{result.enabled?'Enabled':'Disabled'}</dd>
   <dt>Provider status</dt><dd>{result.providerStatus==='active'?'Active on the line':'Queued; change is pending'}</dd>
   <dt>Destination</dt><dd>{result.destination??'None'}</dd>
   <dt>Expected Twilio destination</dt><dd>{result.expectedDestination}</dd>
   {result.estimatedCompletion!==null&&<><dt>Estimated completion</dt><dd>{new Date(result.estimatedCompletion).toLocaleString()}</dd></>}
   <dt>Route configuration</dt><dd>{result.routeConfigured?'Active forwarding matches the expected destination':'Not confirmed active at the expected destination'}</dd>
   <dt>Checked</dt><dd>{new Date(result.checkedAt).toLocaleString()}</dd>
  </dl>}
  <p>This forwarding check does not verify an end-to-end call or forwarding charges. See the private audio test result below for call verification.</p>
 </section>;
}
