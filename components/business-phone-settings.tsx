'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {webinarRequest} from '@/lib/webinar-client';
import {additionalBusinessPhones,newBusinessPhone,businessVoiceIngress} from '@/lib/business-phone-policy';
type Status={phone:string;leaseActive:boolean;incoming:boolean;incomingPending:boolean;callerIdVerified:boolean;callerIdError?:string|null;ingressReady:boolean;differentDestination:boolean};
const formatted=(phone:string)=>phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/,'($1) $2-$3');

function PhoneConnection({phone}:{phone:string}){
 const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const endpoint='/api/messaging/admin/calls?phone='+encodeURIComponent(phone);
 async function check(connect=false){
  setBusy(true);setError('');setSaved(false);
  try{const s=await webinarRequest<Status>(endpoint,connect?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'connect',phone})}:{cache:'no-store'});setStatus(s);setSaved(connect);}
  catch(e){setError(e instanceof Error?e.message:'Could not check this number.');}
  finally{setBusy(false);}
 }
 useEffect(()=>{let active=true;void webinarRequest<Status>(endpoint,{cache:'no-store'}).then(s=>{if(active)setStatus(s);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not check this number.');});return()=>{active=false;};},[endpoint]);
 return <section aria-label={'Calls for '+formatted(phone)} style={{border:'1px solid #ddd',borderRadius:20,padding:24,marginTop:24}}>
  <h2 style={{marginTop:0}}>{formatted(phone)}</h2>
  <dl style={{display:'grid',gridTemplateColumns:'1fr auto',gap:20}}>
   <dt>Incoming calls</dt><dd style={{margin:0}}>{!status?error?'Not connected':'Checking…':status.incoming?'Connected':status.incomingPending?'Connecting…':'Needs connection'}</dd>
   <dt>Outgoing caller ID</dt><dd style={{margin:0}}>{!status?error?'Not connected':'Checking…':status.callerIdVerified?'Verified':'Needs verification'}</dd>
  </dl>
  <p style={{color:'#555',fontSize:14,lineHeight:1.6}}>Incoming calls forward to your iCash X reception at {formatted(businessVoiceIngress)}. Your existing bot and eligible custom voice handle the call.</p>
  {status&&!status.leaseActive&&<p role="status">This number is no longer an active lease.</p>}
  {status?.differentDestination&&<p role="status">This number forwards somewhere else. Review its current forwarding destination before connecting it.</p>}
  {status&&!status.ingressReady&&<p role="status">Your reception connection needs review before forwarding can be enabled.</p>}
  {status&&!status.callerIdVerified&&<p style={{color:'#555',fontSize:14,lineHeight:1.6}}>{status.callerIdError??'Twilio needs to verify ownership of this number before it can make outgoing calls.'} Complete its caller ID verification, then press Connect calls here.</p>}
  <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:24}}>
   <button type="button" disabled={busy||!status||!status.leaseActive||!status.ingressReady||status.differentDestination} onClick={()=>void check(true)} style={{background:'#111',color:'#fff',padding:'13px 20px',border:0,borderRadius:10,cursor:'pointer',opacity:busy?0.6:1}}>{busy?'Checking…':status?.incoming&&status.callerIdVerified?'Confirm connection':'Connect calls'}</button>
   <button type="button" disabled={busy} onClick={()=>void check()} style={{background:'#fff',color:'#111',padding:'13px 20px',border:'1px solid #ddd',borderRadius:10,cursor:'pointer'}}>Refresh</button>
  </div>
  {saved&&<p role="status" style={{fontSize:14}}>{status?.incoming&&status.callerIdVerified?'Incoming and outgoing calls are connected.':status?.incoming?'Incoming calls are connected. Outgoing calls need caller ID verification.':'The provider is connecting this number. Refresh shortly.'}</p>}
  {error&&<p role="alert" style={{fontSize:14}}>{error}</p>}
 </section>;
}
export function BusinessPhoneSettings(){
 const [phone,setPhone]=useState<string>(newBusinessPhone);
 return <main style={{maxWidth:620,margin:'48px auto',padding:24,fontFamily:'Arial, sans-serif',color:'#111'}}>
  <Link href="/messagingadmin" style={{color:'#666'}}>← Messaging</Link>
  <h1 style={{fontSize:30,marginBottom:8}}>Calls</h1><p style={{color:'#666'}}>Connect your business numbers to iCash X.</p>
  <label style={{display:'grid',gap:8,marginTop:24}}>Business number<select value={phone} onChange={e=>setPhone(e.target.value)} style={{background:'#fff',color:'#111',padding:12,border:'1px solid #ddd',borderRadius:10,fontSize:16}}>{additionalBusinessPhones.map(number=><option key={number} value={number}>{formatted(number)}</option>)}</select></label>
  <PhoneConnection key={phone} phone={phone}/>
 </main>;
}
