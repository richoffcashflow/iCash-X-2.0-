'use client';
import {useEffect} from 'react';
import {usePathname} from 'next/navigation';
import {installReminderTracking} from '@/lib/webinar-reminder-client';
export function WebinarReminderTracking(){
 const path=usePathname();
 useEffect(()=>installReminderTracking(async input=>{
  const res=await fetch('/api/webinar/reminder-visit',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),cache:'no-store',signal:AbortSignal.timeout(3000)});
  return res.ok&&res.status!==204&&(await res.json()).saved===true;
 }),[path]);
 return null;
}
