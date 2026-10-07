'use client';
import type {KeyboardEvent,ReactNode,SyntheticEvent} from 'react';

type Props={blocked:boolean;actionsOnly?:boolean;onRequireCredits:()=>void;children:ReactNode};

/** A UI prompt only. Work endpoints still authorize and reserve every paid action. */
export function CreditActionGate({blocked,actionsOnly=false,onRequireCredits,children}:Props){
 function prompt(event:SyntheticEvent){
  if(!blocked)return;
  if(actionsOnly&&(!(event.target instanceof Element)||!event.target.closest('[data-credit-action],.message-composer,.manual-call-options input')))return;
  event.preventDefault();event.stopPropagation();onRequireCredits();
 }
 function keyDown(event:KeyboardEvent<HTMLDivElement>){
  if(event.key==='Enter'||event.key===' '){prompt(event);return;}
  const editing=event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable="true"]');
  if(editing&&(event.key.length===1||['Backspace','Delete','ArrowUp','ArrowDown'].includes(event.key)))prompt(event);
 }
 return <div className="credit-action-gate" onClickCapture={prompt} onSubmitCapture={prompt} onKeyDownCapture={keyDown} onBeforeInputCapture={prompt} onPasteCapture={prompt} onPointerDownCapture={event=>{
  // Native disabled controls do not emit clicks. Still explain how to continue.
  if(event.button===0&&event.target instanceof Element&&event.target.closest('button,a,summary,input,textarea,select,[role="button"]'))prompt(event);
 }}>{children}</div>;
}
