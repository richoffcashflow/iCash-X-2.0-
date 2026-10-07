'use client';
import {useEffect,useRef,useState} from 'react';
import {z} from 'zod';

const reasons={
 ready:'The saved reference is reusable. Published settings, phone routing and draft checks passed.',
 authorization_already_present:'Main already has an Authorization header. No change was made.',
 source_reference_invalid:'The private branch does not provide a reusable saved-secret reference. Use the correct ElevenLabs workspace to review it.',
 unsafe_headers:'An existing header needs manual review before this repair can proceed.',
 routing_not_safe:'The incoming phone and Main traffic settings do not establish a safe repair target.',
 drafts_present:'There is a conflicting unpublished draft. Resolve it in ElevenLabs before preparing this repair again.',
 evidence_missing:'The provider did not return enough evidence to prepare this repair safely.',
 configuration_changed:'The provider settings changed after review. Nothing was applied; review the current settings again.',
 review_expired:'The review expired. Prepare a fresh review before applying.',
 invalid_review:'The review could not be validated. Nothing was applied.',
 provider_unavailable:'The provider is unavailable. Leave the call test on hold.',
 provider_auth_failed:'The existing server connection could not authenticate with ElevenLabs.',
 provider_access_denied:'The existing connection does not have permission for this operation. No permission was expanded.',
 provider_receipt_invalid:'The provider response could not be safely verified.',
 configuration_unavailable:'The existing server configuration is unavailable. Nothing was prepared for application.',
 verification_failed:'The resulting configuration could not be verified. Do not apply again; review the provider state.',
 apply_uncertain:'The application result is uncertain. Do not apply again; check the provider state first.',
 verified_only_auth_changed:'Verified: Main now uses the saved Authorization reference, and the other checked published settings are unchanged.',
} as const;
const reasonSchema=z.enum(Object.keys(reasons) as [keyof typeof reasons,...(keyof typeof reasons)[]]);
const resultSchema=z.object({
 status:z.enum(['ready','blocked','no_change','verified_only_auth_changed','outcome_unknown']),reason:reasonSchema,
 operation:z.literal('reuse_saved_authorization_reference_on_main'),
 fingerprint:z.string().regex(/^[a-f0-9]{64}$/).nullable(),
 reviewToken:z.string().min(20).max(4096).regex(/^[A-Za-z0-9._-]+$/).nullable(),expiresAt:z.string().datetime().nullable(),
 callVerification:z.literal('not_tested'),concurrencyProtection:z.literal('fresh_snapshot_check_only'),checkedAt:z.string().datetime(),
 providerRequestStatus:z.number().int().min(100).max(599).nullable().optional(),
}).refine(result=>result.status!=='ready'||(result.reason==='ready'&&!!result.fingerprint&&!!result.reviewToken&&!!result.expiresAt))
 .refine(result=>result.status!=='verified_only_auth_changed'||result.reason==='verified_only_auth_changed')
 .refine(result=>result.status==='ready'||result.reviewToken===null);
type Review=z.infer<typeof resultSchema>;
type Active={controller:AbortController;timer:ReturnType<typeof setTimeout>|null;apply:boolean};
const endpoint='/api/owner-inbound-acceptance/elevenlabs/authorization';

export default function OwnerElevenLabsAuthorization(){
 const [review,setReview]=useState<Review|null>(null),[busy,setBusy]=useState(false),[consent,setConsent]=useState(false),[attempted,setAttempted]=useState(false),[message,setMessage]=useState('');
 const active=useRef<Active|null>(null),applyAttempted=useRef(false);
 useEffect(()=>()=>{const current=active.current;active.current=null;if(current){if(current.timer!==null)clearTimeout(current.timer);current.controller.abort();}},[]);
 async function run(apply=false){
  if(active.current)return;
  if(apply&&(!consent||review?.status!=='ready'||applyAttempted.current))return;
  if(apply&&(!review?.expiresAt||Date.parse(review.expiresAt)<=Date.now())){setReview(null);setConsent(false);setMessage(reasons.review_expired);return;}
  const token=apply?review!.reviewToken:null;
  if(apply){applyAttempted.current=true;setAttempted(true);}
  const request:Active={controller:new AbortController(),timer:null,apply};active.current=request;
  setBusy(true);setReview(null);setConsent(false);setMessage('');
  request.timer=setTimeout(()=>{
   if(active.current!==request)return;
   active.current=null;request.controller.abort();setBusy(false);
   setMessage(apply?'The request timed out after submission. Its result is unknown. Do not apply again; check the provider state.':'The preparation timed out. You can safely check again.');
  },125000);
  try{
   const response=await fetch(endpoint,{method:apply?'POST':'GET',cache:'no-store',credentials:'same-origin',redirect:'error',referrerPolicy:'no-referrer',signal:request.controller.signal,
    ...(apply?{headers:{'Content-Type':'application/json'},body:JSON.stringify({reviewToken:token})}:{})});
   if(active.current!==request)return;
   const parsed=resultSchema.safeParse(await response.json());
   if(active.current!==request)return;
   if(parsed.success&&(response.ok||['blocked','outcome_unknown','no_change'].includes(parsed.data.status))&&(!apply?parsed.data.status!=='verified_only_auth_changed':parsed.data.status!=='ready')){
    setReview(parsed.data);setMessage(reasons[parsed.data.reason]);
   }else if(response.status===401)setMessage('Sign in as the configured owner to review this repair.');
   else if(response.status===403)setMessage('Only the configured owner can use this repair.');
   else throw Error();
  }catch{if(active.current===request)setMessage(apply?'The submitted repair could not be verified. Do not apply again; check the provider state.':'Repair preparation is unavailable. No provider settings were changed.');}
  finally{if(active.current===request){if(request.timer!==null)clearTimeout(request.timer);active.current=null;setBusy(false);}}
 }
 return <section aria-label="Incoming webhook authorization repair" style={{maxWidth:650,margin:'2rem auto',padding:'1.5rem',lineHeight:1.6,border:'1px solid currentColor',borderRadius:12}}>
  <h2>Incoming webhook authorization</h2>
  <p>Reuse the private test branch’s existing saved Authorization reference on Main’s iCash webhook. The secret stays hidden. Preparation checks the saved reference, published settings, phone routing and conflicting drafts.</p>
  <button type="button" disabled={busy} onClick={()=>void run(false)}>{busy&&!active.current?.apply?'Checking repair…':attempted?'Check current repair state':'Prepare authorization repair'}</button>
  <p role="status">{busy?(active.current?.apply?'Applying once and verifying the published settings…':'Reading the current configuration…'):message||'No repair has been prepared.'}</p>
  {typeof review?.providerRequestStatus==='number'&&<p>Provider update response: HTTP {review.providerRequestStatus}</p>}
  {review?.status==='ready'&&!attempted&&<>
   <p>Only the missing Authorization reference will be added. Applying publishes a new Main agent version immediately. Keep other ElevenLabs editors idle until verification finishes; the provider does not offer an atomic version lock.</p>
   <p>Review expires {new Date(review.expiresAt!).toLocaleString('en-US',{hour12:true})}.</p>
   <label><input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)}/> I approve reusing this saved reference on Main and publishing this authentication change.</label>
   <div><button type="button" disabled={busy||!consent} onClick={()=>void run(true)}>Apply saved reference once</button></div>
  </>}
  {attempted&&review?.status!=='verified_only_auth_changed'&&<p>An apply was submitted from this page. Further checks are read-only. An uncertain result needs review before another attempt.</p>}
  <p>This repair does not start a call, enable the audio test, change forwarding, or verify the hidden secret’s value. A successful configuration check is not an end-to-end call result.</p>
 </section>;
}
