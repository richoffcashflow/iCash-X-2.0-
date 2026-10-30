'use client';
import {useRef,useState} from 'react';
import {privatePhoneDisplay} from '@/lib/private-phone-display';

export function DemoPhoneField({value,privatePhone,disabled,onChange}:{value:string;privatePhone?:string|null;disabled:boolean;onChange:(value:string)=>void}){
 const [editing,setEditing]=useState(false),input=useRef<HTMLInputElement>(null);
 const display=privatePhoneDisplay(value,privatePhone),masked=display!==value;
 const concealed=masked&&!editing;
 return <>
  <label className="demo-label" htmlFor="demo-phone">Phone number</label>
  <input ref={input} id="demo-phone" type={privatePhone&&!concealed?'password':'tel'} inputMode="tel" autoComplete={privatePhone?'off':'tel'} required maxLength={30} value={concealed?display:value} readOnly={concealed} disabled={disabled} onChange={e=>onChange(e.target.value)} onBlur={()=>setEditing(false)} placeholder="(214) 555-0123"/>
  {concealed&&<button type="button" className="demo-secondary" disabled={disabled} onClick={()=>{setEditing(true);onChange('');input.current?.focus();}}>Use another number</button>}
 </>;
}
