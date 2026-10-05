'use client';
import type {Webinar} from '@/lib/webinar-policy';

export function WebinarAudienceEditor({webinar,onChange}:{webinar:Webinar;onChange:(patch:Partial<Webinar>)=>void}){
 const display=webinar.audienceDisplay;
 function edit(patch:Partial<typeof display>){onChange({audienceDisplay:{...display,...patch}});}
 const number=(value:string)=>Math.min(100000,Math.max(0,Math.floor(Number(value)||0)));
 return <div className="ws-audience-editor">
  <label className="wb-check"><input type="checkbox" checked={webinar.showAudienceCount} onChange={e=>onChange({showAudienceCount:e.target.checked})}/><span>Show an audience count</span></label>
  {webinar.showAudienceCount&&<>
   <label className="wb-label">Audience display<select value={display.mode} onChange={e=>edit({mode:e.target.value as typeof display.mode})}>
    <option value="actual">Actual viewers · updates automatically</option>
    <option value="fixed">Simulated audience · target number</option>
    <option value="simulated">Simulated audience · custom range</option>
   </select></label>
   {display.mode==='fixed'&&<>
    <label className="wb-label">Target viewers<input type="number" min={0} max={100000} value={display.fixedCount} onChange={e=>edit({fixedCount:number(e.target.value)})}/></label>
    <p className="ws-hint">Starts below your target, builds toward it, then moves slightly above and below it. The count tapers near the end. Timing follows your video length.</p>
   </>}
   {display.mode==='simulated'&&<div className="ws-fields">
    <label className="wb-label">Minimum<input type="number" min={0} max={100000} value={display.minimum} onChange={e=>{const minimum=number(e.target.value);edit({minimum,maximum:Math.max(minimum,display.maximum)});}}/></label>
    <label className="wb-label">Maximum<input type="number" min={display.minimum} max={100000} value={display.maximum} onChange={e=>{const maximum=number(e.target.value);edit({maximum,minimum:Math.min(maximum,display.minimum)});}}/></label>
   </div>}
   <p className="ws-hint">{display.mode==='actual'?'Counts unique viewers playing this webinar. Multiple tabs count once.':`${display.mode==='simulated'?'Changes stay within your range. ':''}Labeled “simulated viewers” in the room. Each session varies and resumes consistently. Actual visitor and close-rate reports stay accurate.`}</p>
  </>}
 </div>;
}
