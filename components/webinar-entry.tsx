'use client';
import {useEffect,useMemo} from 'react';
import dynamic from 'next/dynamic';
import {prepareWebinarEntry} from '@/lib/webinar-entry';
import {WebinarLoading} from '@/components/webinar-loading';
const WebinarRoom=dynamic(()=>import('@/components/webinar-room').then(m=>m.WebinarRoom),{ssr:false,loading:WebinarLoading});
export function WebinarEntry({webinarCode}:{webinarCode?:string}){
 const initialStart=useMemo(()=>prepareWebinarEntry(webinarCode),[webinarCode]);
 // The small entry bundle starts the session while the full room downloads.
 useEffect(()=>{void initialStart();},[initialStart]);
 return <WebinarRoom key={webinarCode??'default'} webinarCode={webinarCode} initialStart={initialStart}/>;
}
