'use client';
import {useEffect,useState} from 'react';
export default function OwnerRecordingTestLink(){const [visible,setVisible]=useState(false);useEffect(()=>{const c=new AbortController();fetch('/api/owner-recording-test',{cache:'no-store',signal:c.signal}).then(async r=>r.ok?r.json():null).then(x=>{if(!c.signal.aborted)setVisible(x?.phoneEnding==='5280');}).catch(()=>{});return()=>c.abort();},[]);return visible?<p><a href="/owner-recording-test">Private recorded phone check</a> · 60-second owner-only test</p>:null;}
