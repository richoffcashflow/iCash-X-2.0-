'use client';
import {useState} from 'react';
import {ArrowLeft,MessageCircle,RotateCcw,ShieldCheck} from 'lucide-react';
import {SupportChat} from '@/components/support-chat';
import {createSupportPreview,supportScenarios,type SupportScenario} from './preview-transport';
import './support-preview.css';

export function SupportPreview(){
 const [demo,setDemo]=useState(()=>({scenario:'bot' as SupportScenario,revision:0,transport:createSupportPreview('bot')}));
 const [opened,setOpened]=useState(true);
 const selected=supportScenarios.find(item=>item.id===demo.scenario)!;
 function select(scenario:SupportScenario){setOpened(true);setDemo(previous=>({scenario,revision:previous.revision+1,transport:createSupportPreview(scenario)}));}
 return <main className="james-preview">
  <nav className="james-preview-nav" aria-label="Preview navigation"><a href="/preview/workspace"><ArrowLeft size={16}/>Practice workspace</a><span>iCash X <b>SUPPORT PREVIEW</b></span></nav>
  <div className="james-preview-layout">
   <section className="james-preview-intro" aria-labelledby="preview-title">
    <div className="james-preview-eyebrow"><MessageCircle size={16}/>A little help, right here.</div>
    <h1 id="preview-title">iCash Support.</h1>
    <p className="james-preview-lead">A familiar name.<br/>A clear next step.</p>
    <p className="james-preview-description">A simple support chat, with brief reading and typing pauses that keep the conversation comfortable.</p>
    <div className="james-preview-scenarios"><h2>Try a conversation</h2><div>{supportScenarios.map(item=><button key={item.id} type="button" aria-pressed={demo.scenario===item.id} onClick={()=>select(item.id)}>{item.label}</button>)}</div><p>{demo.scenario==='recovery'?'Send once to see a connection interruption. Your draft stays ready; retry it to recover the saved reply.':'A sample question is ready. Press the send arrow to see the reply.'}</p></div>
    <button className="james-preview-reset" type="button" onClick={()=>select(demo.scenario)}><RotateCcw size={14}/>Restart preview</button>
    <p className="james-preview-sample"><ShieldCheck size={16}/>Sample conversations only. No customer accounts, payments, calls or support tickets are changed.</p>
   </section>
   <div className="james-preview-window"><div hidden={!opened}><SupportChat key={demo.revision} active={opened} transport={demo.transport} initialDraft={selected.draft} onClose={()=>setOpened(false)}/></div>{!opened&&<div className="james-preview-closed"><MessageCircle size={32}/><h2>Here when you need help.</h2><p>Your sample conversation is still here.</p><button type="button" onClick={()=>setOpened(true)}>Open chat</button></div>}</div>
  </div>
 </main>;
}
