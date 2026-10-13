'use client';
import {usePathname} from 'next/navigation';
import {useEffect,useState} from 'react';
import {dashboardPath} from '@/lib/dashboard-paths';
export function DashboardLock(){
 const path=usePathname(),[busy,setBusy]=useState(false);const active=dashboardPath(path);
 useEffect(()=>{if(!active)return;async function check(){try{const r=await fetch('/api/auth/dashboard-password',{cache:'no-store'}),d=await r.json();if(r.status!==503&&!d.unlocked)location.replace('/dashboard-unlock?next='+encodeURIComponent(location.pathname+location.search));}catch{/* Preserve the view during a transient outage; APIs still fail closed. */}}const timer=setInterval(()=>void check(),60000);const visible=()=>{if(document.visibilityState==='visible')void check();};document.addEventListener('visibilitychange',visible);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[active]);
 if(!active)return null;
 return <button className="dashboard-lock" disabled={busy} onClick={async()=>{setBusy(true);try{const r=await fetch('/api/auth/dashboard-password',{method:'DELETE'});if(r.ok)location.replace('/dashboard-unlock?next='+encodeURIComponent(location.pathname+location.search));}finally{setBusy(false);}}}>{busy?'Locking…':'Lock dashboard'}</button>;
}
