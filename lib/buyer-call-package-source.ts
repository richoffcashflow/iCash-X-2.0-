import type {RecordedReceptionRow} from './recorded-reception.ts';
import {object} from './required-call-recording.ts';

/** A complete speech source, never a summary or a first/last-turn excerpt.
 * Agent tool-only turns may contain no speech; missing buyer speech cannot be
 * silently discarded. The database rechecks every clock and source binding. */
export function buyerCallPackageSource(row:RecordedReceptionRow,raw:unknown){
 const conversation=object(raw),metadata=object(conversation.metadata),start=metadata.start_time_unix_secs;
 const began=Date.parse(String(row.call_started_at)),ended=Date.parse(String(row.call_ended_at)),deadline=began+row.max_total_seconds*1000;
 if(conversation.status!=='done'||conversation.conversation_id!==row.conversation_id||!Array.isArray(conversation.transcript)
  ||conversation.transcript.length<1||conversation.transcript.length>1000
  ||typeof start!=='number'||!Number.isFinite(start)||!Number.isFinite(began)||!Number.isFinite(ended)
  ||!Number.isInteger(row.max_total_seconds)||row.max_total_seconds<1||row.max_total_seconds>600
  ||start*1000<began||start*1000>ended||start*1000>deadline)return null;
 const turns:{role:'agent'|'user';message:string|null;seconds:number}[]=[];let previous=-1;
 for(const value of conversation.transcript){
  const turn=object(value),seconds=turn.time_in_call_secs;
  if(!['agent','user'].includes(String(turn.role))||typeof seconds!=='number'||!Number.isFinite(seconds)
   ||seconds<previous||seconds<0||seconds>row.max_total_seconds||start*1000+seconds*1000>ended||start*1000+seconds*1000>deadline
   ||!(typeof turn.message==='string'&&turn.message.length<=12000||turn.role==='agent'&&turn.message===null))return null;
  previous=seconds;turns.push({role:turn.role as 'agent'|'user',message:turn.message as string|null,seconds});
 }
 const source={version:'buyer-call-package-v1',complete:true,startedAt:new Date(start*1000).toISOString(),turns};
 return Buffer.byteLength(JSON.stringify(source),'utf8')<=262144?source:null;
}
