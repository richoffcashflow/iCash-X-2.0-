import type {ReactNode} from 'react';
import {funnelRows,type FunnelStage,type FunnelStep} from '@/lib/conversion-funnel';
import styles from './conversion-funnel.module.css';

export function ConversionFunnel({title,description,stages,steps,controls,unavailable=false}:{title:string;description:string;stages:FunnelStage[];steps?:FunnelStep[];controls?:ReactNode;unavailable?:boolean}){
 const rows=steps?funnelRows(steps,stages):null,last=rows?.at(-1);
 return <section className={styles.funnel} aria-label={title} aria-busy={!steps&&!unavailable}>
  <div className={styles.header}><div><h2>{title}</h2><p>{description}</p></div>{controls}</div>
  <div className={styles.summary}><span>Overall conversion</span><strong>{last?.share===null||last?.share===undefined?'—':`${last.share}%`}</strong><span>{last?`${last.count.toLocaleString('en-US')} of ${rows![0].count.toLocaleString('en-US')} reached the final step`:unavailable?'Funnel unavailable':'Loading funnel…'}</span></div>
  <div className={styles.diagram}>
   <div className={styles.shape} aria-hidden="true"><svg viewBox={`0 0 100 ${stages.length*72}`} preserveAspectRatio="none">{stages.map((stage,i)=>{
    // A continuous funnel silhouette: tapered body followed by a narrow outlet.
    // Stage widths describe the sequence; the adjacent numbers carry the data.
    const top=i*35/Math.max(1,stages.length-1),bottom=Math.min(i+1,stages.length-1)*35/Math.max(1,stages.length-1);
    return <polygon key={stage.key} points={`${top},${i*72} ${100-top},${i*72} ${100-bottom},${(i+1)*72} ${bottom},${(i+1)*72}`} className={rows&&rows[i].count>0?styles.filled:styles.emptyStage} style={rows&&rows[i].count>0?{fill:`rgb(${24+i*9},${24+i*9},${24+i*9})`}:undefined} vectorEffect="non-scaling-stroke"/>;
   })}</svg></div>
   <ol className={styles.steps}>{stages.map((stage,i)=>{
    const row=rows?.[i];
    return <li key={stage.key} className={styles.row}>
     <div className={styles.label}><span>{stage.label}</span><div className={styles.drop}>{i===0?<small>Starting point</small>:row?row.dropPercent===null?<small>No prior activity</small>:<><span><span aria-hidden="true">↓ </span>{row.dropPercent}% drop-off</span><small>{row.drop!.toLocaleString('en-US')} not advanced</small></>:<small>{unavailable?'Unavailable':'—'}</small>}</div></div>
     <div className={styles.value}><strong>{row?row.count.toLocaleString('en-US'):'—'}</strong><small>{row?.share===null||row?.share===undefined?'—':`${row.share}% of start`}</small></div>
    </li>;
   })}</ol>
  </div>
  <p className={styles.note}>Stage widths show the sequence. Counts and percentages show actual progress. Each person or lead counts once per step; drop-off means they have not advanced in this period.</p>
 </section>;
}
