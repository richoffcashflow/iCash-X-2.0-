'use client';
import {useEffect,useRef,useState} from 'react';
import type {VoiceConversation as VoiceSession} from '@elevenlabs/client';
import type {PropertyContext} from '@/lib/property-context';
import type {voiceResult} from '@/lib/voice-result';
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(cents/100);
type Result=NonNullable<ReturnType<typeof voiceResult>>;
export default function VoiceTest(){
 const [access,setAccess]=useState('');const [phase,setPhase]=useState('ready');const [message,setMessage]=useState('');
 const [sessionId,setSessionId]=useState('');const [result,setResult]=useState<Result|null>(null);
 const [propertyId,setPropertyId]=useState('');const [property,setProperty]=useState<PropertyContext|null>(null);
 const [phoneConversation,setPhoneConversation]=useState('');
 const [lines,setLines]=useState<{role:string;text:string}[]>([]);
 const call=useRef<VoiceSession|null>(null);const starting=useRef(false);const mounted=useRef(true);
 useEffect(()=>{
  mounted.current=true;
  const token=new URLSearchParams(location.hash.slice(1)).get('access');
  if(token&&/^[a-f0-9]{64}$/.test(token)){sessionStorage.setItem('icash_voice_test_access',token);history.replaceState(null,'',location.pathname);}
  setAccess(sessionStorage.getItem('icash_voice_test_access')??'');
  const previous=sessionStorage.getItem('icash_voice_test_session');
  if(previous){setSessionId(previous);setPhase('ended');}
  return()=>{mounted.current=false;void call.current?.endSession();call.current=null;};
 },[]);
 async function start(){
  if(starting.current||call.current)return;starting.current=true;setPhase('connecting');setMessage('');setResult(null);setProperty(null);setLines([]);
  try{
   // Ask for microphone permission before spending the limited session allowance.
   const permission=await navigator.mediaDevices.getUserMedia({audio:true});permission.getTracks().forEach(t=>t.stop());
   if(!mounted.current)return;
   const r=await fetch('/api/voice-test/session',{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:JSON.stringify({propertyId:propertyId.trim()})});const data=await r.json();
   if(!r.ok)throw new Error(data.error||'Could not start this test.');
   setProperty(data.propertyContext??null);
   setSessionId(data.sessionId);sessionStorage.setItem('icash_voice_test_session',data.sessionId);
   const {VoiceConversation}=await import('@elevenlabs/client');
   const active=await VoiceConversation.startSession({conversationToken:data.conversationToken,connectionType:'webrtc',
    onMessage:m=>setLines(old=>[...old,{role:m.source==='user'?'You':'Alex',text:m.message}]),
    onDisconnect:()=>{call.current=null;if(mounted.current)setPhase('ended');},
    onError:()=>{if(mounted.current)setMessage('The voice connection had a problem. End the test and check the saved result.');}
   });
   if(!mounted.current){await active.endSession();return;}
   call.current=active;
   if(data.contextualUpdate){try{active.sendContextualUpdate(data.contextualUpdate);}catch{await active.endSession();call.current=null;throw new Error('Property context could not reach the voice session. The test was ended.');}}
   setPhase('talking');
  }catch(e){if(mounted.current){setPhase('ended');setMessage(e instanceof Error&&e.name==='NotAllowedError'?'Allow microphone access to try the voice conversation.':e instanceof Error?e.message:'Could not connect.');}}
  finally{starting.current=false;}
 }
 async function stop(){setPhase('ending');try{await call.current?.endSession();}finally{call.current=null;setPhase('ended');}}
 async function importPhone(){
  setPhase('checking');setMessage('');setResult(null);
  try{
   const r=await fetch('/api/voice-test/import',{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:JSON.stringify({conversationId:phoneConversation.trim()})});const data=await r.json();
   if(!r.ok)throw new Error(data.error);
   setSessionId(data.sessionId);sessionStorage.setItem('icash_voice_test_session',data.sessionId);
   await check(data.sessionId);
  }catch(e){setPhase('ended');setMessage(e instanceof Error?e.message:'Could not import this call.');}
 }
 async function check(id=sessionId){
  setPhase('checking');setMessage('');
  try{
   const r=await fetch(`/api/voice-test/result?session=${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${access}`},cache:'no-store'});const data=await r.json();
   if(!r.ok)throw new Error(data.error);
   if(data.status==='complete'){setResult(data.result);setProperty(data.propertyContext??null);setPhase('complete');}
   else{setPhase('ended');setMessage(data.status==='failed'?'The provider could not finish this conversation.':'The summary is still processing. Check again in a few seconds.');}
  }catch(e){setPhase('ended');setMessage(e instanceof Error?e.message:'Unable to fetch the result.');}
 }
 const busy=['connecting','ending','checking'].includes(phase);
 return <main style={{maxWidth:520,margin:'0 auto',padding:'32px 20px 60px',color:'#111',background:'#fff',minHeight:'100dvh'}}>
  <p style={{fontSize:13,fontWeight:700,letterSpacing:1}}>iCASH X · PRIVATE TEST</p>
  <h1 style={{fontSize:32,lineHeight:1.15,margin:'22px 0 12px'}}>Talk to your AI bot.</h1>
  <p style={{fontSize:17,lineHeight:1.6,color:'#555'}}>Pretend you’re a seller. Ask Alex to call back on a specific date and time. Then check what it remembered.</p>
  <p style={{fontSize:14,color:'#666',margin:'14px 0 24px'}}>Up to 3 minutes. Your voice is processed by ElevenLabs; a transcript is saved for this test. No sellers are contacted and no customer credits are used.</p>
  {!access?<p role="alert">Open the private test link provided to you.</p>:<>
   {phase!=='talking'&&<details style={{marginBottom:16}}><summary style={{minHeight:44,cursor:'pointer'}}>Use a real property · optional</summary><p style={{lineHeight:1.5}}>Private testing only. Enter a DealMachine property ID. Starting uses up to 1 provider property credit and one test allowance. No owner contacts are purchased. Estimates do not authorize an offer.</p><label htmlFor="test-property">DealMachine property ID</label><input id="test-property" value={propertyId} onChange={e=>setPropertyId(e.target.value)} disabled={busy} placeholder="prop_…" maxLength={25} style={{display:'block',width:'100%',boxSizing:'border-box',minHeight:48,padding:12,marginTop:8,border:'1px solid #ccc',borderRadius:12}}/></details>}
   <button disabled={busy} onClick={phase==='talking'?stop:start} style={{width:'100%',minHeight:56,border:0,borderRadius:16,background:'#111',color:'#fff',fontSize:18,fontWeight:650,opacity:busy?.5:1}}>{phase==='talking'?'End conversation':phase==='connecting'?'Connecting…':phase==='ending'?'Ending…':'Start voice test'}</button>
   {sessionId&&phase!=='talking'&&<button onClick={()=>check()} disabled={busy} style={{width:'100%',minHeight:52,marginTop:12,border:'1px solid #ddd',borderRadius:16,background:'#fff',fontSize:17}}>{phase==='checking'?'Checking…':'See summary & callback'}</button>}
   {phase!=='talking'&&<details style={{marginTop:20}}><summary style={{minHeight:44,cursor:'pointer'}}>Import a phone test</summary><p style={{lineHeight:1.5}}>Copy the conversation ID from your completed ElevenLabs call. Only this private test agent is accepted. Importing never places a call.</p><label htmlFor="phone-conversation">Conversation ID</label><input id="phone-conversation" value={phoneConversation} onChange={e=>setPhoneConversation(e.target.value)} placeholder="conv_…" maxLength={125} style={{display:'block',width:'100%',boxSizing:'border-box',minHeight:48,margin:'8px 0',padding:12,border:'1px solid #ccc',borderRadius:12}}/><button onClick={importPhone} disabled={busy||!phoneConversation.trim()} style={{minHeight:48,padding:'0 20px',borderRadius:12}}>Save phone result</button></details>}
  </>}
  <p role="status" style={{lineHeight:1.5,marginTop:16}}>{phase==='talking'?'🎙️ Connected — speak naturally.':message}</p>
  {property&&<section aria-label="Property reference" style={{padding:20,background:'#f5f5f5',borderRadius:18,marginTop:24}}><h2 style={{fontSize:20,margin:'0 0 12px'}}>{property.address}</h2><p style={{fontSize:13,color:'#666'}}>DealMachine · fetched {new Date(property.fetchedAt).toLocaleString()} · unreviewed estimates</p><p>Estimated ARV · DealMachine: {property.estimatedMarketValueCents===null?'Unavailable':money(property.estimatedMarketValueCents)}</p><p>Estimated repairs: {property.repairs.baselineCents===null?'Unavailable':money(property.repairs.baselineCents)}</p>{property.repairs.rangeCents&&<p>Repair range: {money(property.repairs.rangeCents.low)}–{money(property.repairs.rangeCents.high)}</p>}{property.screeningBuyerCeilingCents!==null&&<p>Preliminary 70% ceiling: {money(property.screeningBuyerCeilingCents)} before assignment fee. Not an approved offer.</p>}{property.financialScreening&&<details><summary style={{minHeight:44,cursor:'pointer'}}>Equity &amp; title checks</summary><p>Estimated equity: {property.financialScreening.equityCents===null?'Unknown':money(property.financialScreening.equityCents)}</p><p>Estimated mortgage balance: {property.financialScreening.estimatedLoanBalanceCents===null?'Unknown':money(property.financialScreening.estimatedLoanBalanceCents)}</p><p>Title and payoff: not verified.</p>{property.financialScreening.reasons.map(reason=><p key={reason} style={{lineHeight:1.5}}>{reason}</p>)}<p style={{fontSize:13}}>Mortgage and lien totals are not added together because records may overlap. These figures are not the seller’s take-home amount.</p></details>}<p style={{fontWeight:650}}>Offer needs review</p><p style={{lineHeight:1.5}}>We use DealMachine’s estimated value as the preliminary ARV input. The 70% calculation still needs reviewed repairs and your assignment fee before an offer can be approved.</p><p style={{fontSize:13}}>Provider credits used: {property.vendorCreditsUsed??'Not reported'}. No offer or contract is sent.</p></section>}
  {result&&<section style={{padding:20,background:'#f5f5f5',borderRadius:18,marginTop:24}}>
   <h2 style={{fontSize:20,margin:'0 0 12px'}}>Saved conversation</h2><p style={{fontSize:13,color:'#666'}}>Provider-generated summary — check the seller’s words before relying on details. A summary is not proof that an action occurred.</p><p style={{lineHeight:1.6}}>{result.summary}</p>
   {result.sellerNotes&&<details><summary style={{minHeight:44,cursor:'pointer'}}>Seller notes · exact words</summary>{result.sellerNotes.map((n,i)=><p key={i} style={{lineHeight:1.6}}>“{n.text}”</p>)}</details>}
   {result.activity&&<details><summary style={{minHeight:44,cursor:'pointer'}}>Saved activity</summary><ol>{result.activity.map(e=><li key={e.id} style={{marginBottom:12}}><strong>{e.title}</strong><p>{e.detail}</p></li>)}</ol></details>}
   <p style={{fontWeight:650,marginTop:18}}>{result.callbackStatus==='scheduled_test'?'📅 Practice callback saved':result.callbackStatus==='blocked_opt_out'?'Contact stopped':result.callbackStatus==='needs_confirmation'?'Callback needs a confirmed date, time and timezone':'No callback requested'}</p>
   {result.dueAt&&<p>{new Date(result.dueAt).toLocaleString('en-US',{timeZone:result.timezone??'UTC',dateStyle:'full',timeStyle:'short'})} · {result.timezone}</p>}
   <p style={{fontSize:13,color:'#666',marginTop:14}}>Test record only. No callback will be dialed.</p>
   <details style={{marginTop:16}}><summary style={{minHeight:44,cursor:'pointer'}}>View saved transcript</summary>{result.transcript.map((t,i)=><p key={i} style={{lineHeight:1.6,marginBottom:12}}><strong>{t.role==='user'?'You':'Alex'}:</strong> {t.message}</p>)}</details>
  </section>}
  {!result&&lines.length>0&&<section aria-label="Live conversation" style={{marginTop:24}}>{lines.map((line,i)=><p key={i} style={{padding:14,borderRadius:16,background:line.role==='You'?'#111':'#f3f3f3',color:line.role==='You'?'#fff':'#111',margin:'10px 0',lineHeight:1.5}}><strong>{line.role}</strong><br/>{line.text}</p>)}</section>}
 </main>;
}
