'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Check,Mail,MessageSquare,Settings2,Users} from 'lucide-react';
import {AccountAccess} from '@/components/account-access';
import {MessagingSettings,type FollowupReadiness,type FollowupStats,type CustomerStats} from '@/components/messaging-settings';
import type {CampaignSettings} from '@/lib/messaging-settings';
import {webinarRequest} from '@/lib/webinar-client';
type Data={settings:CampaignSettings;revision:number;customerUpdatesEnabled:boolean;readiness:FollowupReadiness;stats:FollowupStats|null;customerStats:CustomerStats|null;customerReadiness:{email:boolean;sms:boolean}};
export function MessagingAdmin(){
 const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[denied,setDenied]=useState(false),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const mounted=useRef(false);
 async function load(){
  setLoading(true);setError('');
  try{const result=await webinarRequest<Data>('/api/messaging/admin',{cache:'no-store'});if(mounted.current){setData(result);setDirty(false);setDenied(false);}}
  catch(e){if(mounted.current){setDenied((e as {status?:number}).status===403);setError(e instanceof Error?e.message:'Messaging could not load.');}}
  finally{if(mounted.current)setLoading(false);}
 }
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 function update(patch:Partial<Data>){setData(current=>current?{...current,...patch}:null);setDirty(true);setNotice('');}
 async function save(){
  if(!data||busy)return;setBusy(true);setError('');setNotice('');
  try{
   const result=await webinarRequest<Pick<Data,'revision'|'readiness'|'customerReadiness'>>('/api/messaging/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({settings:data.settings,revision:data.revision,customerUpdatesEnabled:data.customerUpdatesEnabled})});
   setData(current=>current?{...current,...result}:null);setDirty(false);setNotice('Messaging settings saved.');
  }catch(e){setError(e instanceof Error?e.message:'Settings could not save.');}finally{setBusy(false);}
 }
 return <div className="ws-shell ms-shell">
  <header className="ws-header"><a href="/" className="wb-wordmark">iCash X<small>MESSAGING</small></a><div className="ms-header-links"><a href="/webinaradmin">Webinar Studio <ArrowUpRight size={14}/></a><a href="/">Workspace <ArrowUpRight size={14}/></a></div></header>
  {denied?<main className="ws-auth"><span className="wb-eyebrow">OWNER ACCESS</span><h1>Your conversations. One place.</h1><p>Sign in with the iCash X owner account to manage messaging.</p><AccountAccess onSignedIn={()=>void load()}/></main>:<main className="ms-main">
   <div className="ws-heading"><div><span className="wb-eyebrow">YOUR CUSTOMER COMMUNICATIONS</span><h1>Keep the conversation going.</h1><p>Email, texts, and customer reminders. One independent home for all of iCash X.</p></div><span className="ws-status">{dirty?'Unsaved changes':'Independent system'}</span></div>
   <nav className="ms-nav" aria-label="Messaging sections"><a href="#campaign"><Mail size={17}/>Sales campaign</a><a href="#customers"><Users size={17}/>Customer updates</a><a href="#sending"><Settings2 size={17}/>Sending setup</a><a href="#replies"><MessageSquare size={17}/>Replies</a></nav>
   {error&&<div role="alert" className="ws-alert">{error}<button className="wb-text" disabled={loading||busy} onClick={()=>void load()}>Reload settings</button></div>}
   {notice&&<div role="status" className="ws-notice"><Check size={16}/>{notice}</div>}
   {loading&&!data?<p role="status">Loading messaging…</p>:data?<fieldset className="ms-controls" disabled={busy||loading}><MessagingSettings settings={data.settings} readiness={data.readiness} stats={data.stats} customerEnabled={data.customerUpdatesEnabled} customerStats={data.customerStats} customerReadiness={data.customerReadiness} busy={busy} onChange={settings=>update({settings})} onCustomerChange={customerUpdatesEnabled=>update({customerUpdatesEnabled})} onSave={()=>void save()}/></fieldset>:null}
  </main>}
 </div>;
}
