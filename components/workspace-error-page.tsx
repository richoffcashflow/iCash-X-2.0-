'use client';
import {useEffect} from 'react';
import {recordWorkspaceExperience} from '@/lib/workspace-experience-client';

export function WorkspaceErrorPage({retry}:{retry:()=>void}){
 useEffect(()=>{recordWorkspaceExperience({event:'panel_error',stage:'workspace'});},[]);
 return <main style={{maxWidth:520,margin:'12vh auto',padding:24,fontFamily:'Arial, sans-serif',color:'#171717',background:'#fff',lineHeight:1.6}}>
  <h1 style={{fontSize:24,letterSpacing:'-.5px'}}>Let’s try that again</h1>
  <p>This page couldn’t load. Try again to get the latest status.</p>
  <button type="button" style={{minHeight:44,padding:'12px 20px',border:0,borderRadius:10,background:'#171717',color:'#fff',fontSize:14,cursor:'pointer'}} onClick={()=>{recordWorkspaceExperience({event:'panel_retry',stage:'workspace'});retry();}}>Try again</button>
  <a href="/" style={{display:'inline-block',padding:12,marginLeft:8,color:'#444'}}>Return home</a>
 </main>;
}
