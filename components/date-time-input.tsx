'use client';
import {useEffect,useRef,useState} from 'react';
import {joinLocalDateTime,splitLocalDateTime,type LocalTimeParts} from '@/lib/date-time-input';
import './date-time-input.css';

type Props={label:string;hint?:string;name?:string;value?:string;defaultValue?:string;required?:boolean;disabled?:boolean;className?:string;inputClassName?:string;onChange?:(event:{target:{value:string}})=>void};
/** AM/PM is explicit on every device; form values retain the existing local-date contract. */
export function DateTimeInput({label,hint,name,value,defaultValue='',required=false,disabled=false,className='',inputClassName='',onChange}:Props){
 const [parts,setParts]=useState(()=>splitLocalDateTime(value??defaultValue));
 const hidden=useRef<HTMLInputElement>(null),emitted=useRef(value??defaultValue);
 useEffect(()=>{if(value!==undefined&&value!==emitted.current){emitted.current=value;setParts(splitLocalDateTime(value));}},[value]);
 useEffect(()=>{
  if(value!==undefined)return;
  const form=hidden.current?.form;
  const reset=()=>{emitted.current=defaultValue;setParts(splitLocalDateTime(defaultValue));};
  form?.addEventListener('reset',reset);return()=>form?.removeEventListener('reset',reset);
 },[value,defaultValue]);
 function update(patch:Partial<LocalTimeParts>){const next={...parts,...patch},local=joinLocalDateTime(next);setParts(next);emitted.current=local;onChange?.({target:{value:local}});}
 return <div className={`date-time-input ${className}`} role="group" aria-label={label}>
  <span className="date-time-input-label">{label}{hint&&<small>{hint}</small>}</span>
  <input ref={hidden} type="hidden" name={name} value={joinLocalDateTime(parts)} disabled={disabled}/>
  <div className="date-time-input-fields">
   <input className={inputClassName} type="date" aria-label={`${label} date`} required={required} disabled={disabled} value={parts.date} onChange={e=>update({date:e.target.value})}/>
   <div className="date-time-input-clock">
    <select className={inputClassName} aria-label={`${label} hour`} disabled={disabled} value={parts.hour} onChange={e=>update({hour:e.target.value})}>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select>
    <span aria-hidden="true">:</span>
    <select className={inputClassName} aria-label={`${label} minute`} disabled={disabled} value={parts.minute} onChange={e=>update({minute:e.target.value})}>{Array.from({length:60},(_,i)=>{const minute=String(i).padStart(2,'0');return <option key={minute} value={minute}>{minute}</option>;})}</select>
    <select className={inputClassName} aria-label={`${label} AM or PM`} disabled={disabled} value={parts.period} onChange={e=>update({period:e.target.value as LocalTimeParts['period']})}><option value="AM">AM</option><option value="PM">PM</option></select>
   </div>
  </div>
 </div>;
}
