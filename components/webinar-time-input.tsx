'use client';
import {changeDurationUnit,splitDuration} from '../packages/webinar-engine/src/index';

export function WebinarTimeInput({label,value,onChange,max=14400}:{label:string;value:number;onChange:(seconds:number)=>void;max?:number}){
 const parts=splitDuration(value);
 return <fieldset className="ws-time-input"><legend>{label}</legend><div>{(['hours','minutes','seconds'] as const).map(unit=><label key={unit}><span>{unit[0].toUpperCase()+unit.slice(1)}</span><input aria-label={`${label} ${unit}`} type="number" inputMode="numeric" min={0} max={unit==='hours'?Math.floor(max/3600):59} step={1} value={parts[unit]} onChange={e=>onChange(changeDurationUnit(value,unit,Number(e.target.value),max))}/></label>)}</div></fieldset>;
}
