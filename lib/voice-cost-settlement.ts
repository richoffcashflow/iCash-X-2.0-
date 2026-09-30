import {costCategories} from './cost-guard.ts';
import {validateCostManifest} from './cost-manifest.ts';

/** Server-reviewed evidence only. Never populate these inputs from model analysis.
 * Each supplier has its own duration: carrier ringing/rounding can exceed agent time.
 * Fixed allocations (including subscription costs) must not duplicate included usage.
 */
export type VoiceCostInput =
 | {kind:'receipt';amountMicros:number;evidenceRef:string}
 | {kind:'fixed_estimate';amountMicros:number;evidenceRef:string}
 | {kind:'duration_estimate';durationSeconds:number|null;unitSeconds:number;microsPerUnit:number;rounding:'exact'|'up';minimumUnits:number;evidenceRef:string;durationEvidenceRef:string};
export type VoiceCostInputs=Record<typeof costCategories[number],VoiceCostInput>;
const safe=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const evidence=(s:string)=>typeof s==='string'&&s.trim().length>=10;
export function voiceCostManifest(inputs:VoiceCostInputs){
 if(!inputs||Object.keys(inputs).length!==costCategories.length)throw Error('Complete voice cost evidence required');
 const entries=costCategories.map(category=>{
  const p=inputs[category];
  if(!p||!evidence(p.evidenceRef))throw Error(`Missing voice evidence: ${category}`);
  let amountMicros:number;
  if(p.kind==='duration_estimate'){
   if(!safe(p.durationSeconds as number)||!safe(p.unitSeconds)||p.unitSeconds===0||!safe(p.microsPerUnit)||!safe(p.minimumUnits)||!evidence(p.durationEvidenceRef)||!['exact','up'].includes(p.rounding))throw Error(`Verified supplier duration and billing rule required: ${category}`);
   const seconds=BigInt(p.durationSeconds!);const unit=BigInt(p.unitSeconds);
   // Integer arithmetic: round units only when the reviewed supplier rule says so.
   const minimum=BigInt(p.minimumUnits)*unit;
   const rounded=p.rounding==='up'?((seconds+unit-BigInt(1))/unit)*unit:seconds;
   const numerator=rounded>minimum?rounded:minimum;
   amountMicros=Number((numerator*BigInt(p.microsPerUnit)+unit-BigInt(1))/unit);
  }else if(p.kind==='receipt'||p.kind==='fixed_estimate')amountMicros=p.amountMicros;
  else throw Error('Unknown voice cost basis');
  if(!safe(amountMicros))throw Error('Invalid voice cost amount');
  return [category,{amountMicros,evidenceRef:p.evidenceRef,basis:p.kind==='receipt'?'verified':'estimated',...(p.kind==='duration_estimate'?{usage:{durationSeconds:p.durationSeconds,unitSeconds:p.unitSeconds,microsPerUnit:p.microsPerUnit,rounding:p.rounding,minimumUnits:p.minimumUnits,durationEvidenceRef:p.durationEvidenceRef}}:{})}] as const;
 });
 const components=Object.fromEntries(entries) as Record<typeof costCategories[number],typeof entries[number][1]>;
 // ElevenLabs cost_fiat includes platform + model; no separate LLM charge here.
 if(inputs.elevenlabs.kind!=='receipt'||components.llm.amountMicros!==0)throw Error('ElevenLabs inclusive receipt required; separate LLM must be zero');
 const {totalMicros}=validateCostManifest(components);
 return {components,totalMicros,costBasis:entries.every(([,p])=>p.basis==='verified')?'verified':'estimated'};
}
