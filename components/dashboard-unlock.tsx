'use client';
import {useEffect,useState} from 'react';
import {AccountAccess} from '@/components/account-access';
import {dashboardReturnPath} from '@/lib/dashboard-paths';
export function DashboardUnlock(){
 const [allowed,setAllowed]=useState<boolean|null>(null),[password,setPassword]=useState(''),[remember,setRemember]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 function destination(){return dashboardReturnPath(new URLSearchParams(location.search).get('next'));}
 async function status(){try{const r=await fetch('/api/auth/dashboard-password',{cache:'no-store'}),d=await r.json();if(r.status===503)throw Error(d.error);if(d.unlocked){location.replace(destination());return;}setAllowed(d.allowed===true);}catch{setError('Could not check access. Please reload.');}}
 useEffect(()=>{void status();},[]);
 async function unlock(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError('');try{const r=await fetch('/api/auth/dashboard-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,remember})});setPassword('');const d=await r.json();if(!r.ok)throw Error(d.error);location.replace(destination());}catch(e){setError(e instanceof Error?e.message:'Could not unlock.');}finally{setBusy(false);}}
 return <main className="dashboard-unlock"><a href="/">← Workspace</a><h1>Unlock your dashboard</h1>{allowed===null?<p role="status">Checking access…</p>:allowed?<><p>Enter your account password to continue.</p><form onSubmit={unlock}><label>Password<input type="password" autoComplete="current-password" required maxLength={512} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label><label className="dashboard-remember"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)} disabled={busy}/><span>Remember this device for 30 days</span></label><p className="dashboard-unlock-duration">{remember?'Use this on your personal device.':'Your dashboards stay unlocked for one hour.'}</p><button type="submit" disabled={busy}>{busy?'Checking…':'Unlock dashboard'}</button></form></>:<><p>Sign in with your dashboard account to continue.</p><AccountAccess onSignedIn={()=>void status()}/></>}{error&&<p role="alert">{error}</p>}</main>;
}
