'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import dynamic from 'next/dynamic';
import {LifeBuoy} from 'lucide-react';
import '@/app/support/chat.css';

const SupportChat=dynamic(()=>import('@/components/support-chat').then(module=>module.SupportChat),{
 ssr:false,
 loading:()=> <p className="support-panel-loading" role="status">Opening support…</p>,
});

export function SupportLauncher(){
 const [opened,setOpened]=useState(false),[visible,setVisible]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  const panel=dialog.current;if(!panel)return;
  if(visible&&!panel.open)panel.showModal();else if(!visible&&panel.open)panel.close();
 },[visible,opened]);
 function close(){setVisible(false);trigger.current?.focus();}
 return <>
  <button ref={trigger} type="button" className="workspace-support-launcher" aria-haspopup="dialog" aria-expanded={visible} onClick={()=>{setOpened(true);setVisible(true);}}><LifeBuoy size={17} aria-hidden="true"/>Help</button>
  {opened&&createPortal(<dialog ref={dialog} className="support-panel" aria-label="iCash X support" onCancel={event=>{event.preventDefault();close();}} onClose={close}>
   <SupportChat active={visible} onClose={close}/>
  </dialog>,document.body)}
 </>;
}
