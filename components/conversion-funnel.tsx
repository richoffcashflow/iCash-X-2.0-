import type {ReactNode} from 'react';
import {funnelRows,type FunnelStage,type FunnelStep} from '@/lib/conversion-funnel';
import styles from './conversion-funnel.module.css';

export function ConversionFunnel({title,description,stages,steps,controls,unavailable=false}:{title:string;description:string;stages:FunnelStage[];steps?:FunnelStep[];controls?:ReactNode;unavailable?:boolean}){
 const rows=steps?funnelRows(steps,stages):null,last=rows?.at(-1);
 return <section className={styles.funnel} aria-label={title} aria-busy={!steps&&!unavailable}>
  <div className={styles.header}><div><h2>{title}</h2><p>{description}</p></div>{controls}</div>
  <div className={styles.summary}><span>Overall conversion</span><strong>{last?.share===null||last?.share===undefined?'—':`${last.share}%`}</strong><span>{last?`${last.count.toLocaleString('en-US')} of ${rows![0].count.toLocaleString('en-US')} reached the final step`:unavailable?'Funnel unavailable':'Loading funnel…'}</span></div>
  <ol className={styles.steps}>{stages.map((stage,i)=>{
   const row=rows?.[i],share=row?.share??0,next=rows?.[i+1]?.share??share;
   const topLeft=(100-share)/2,topRight=100-topLeft,bottomLeft=(100-next)/2,bottomRight=100-bottomLeft;
   return <li key={stage.key}>{i>0&&<div className={styles.drop}><span aria-hidden="true">↓</span>{row?row.dropPercent===null?'No one at the previous step':<>{row.drop!.toLocaleString('en-US')} not advanced <span>· {row.dropPercent}% drop-off</span></>:unavailable?'Unavailable':'—'}</div>}
    <div className={styles.row}><span className={styles.label}>{stage.label}</span><div className={styles.shape} aria-hidden="true">{!rows?<div className={styles.loading}/>:share>0?<svg viewBox="0 0 100 32" preserveAspectRatio="none"><polygon points={`${topLeft},0 ${topRight},0 ${bottomRight},32 ${bottomLeft},32`}/></svg>:<span className={styles.zero}>—</span>}</div><div className={styles.value}><strong>{row?row.count.toLocaleString('en-US'):'—'}</strong><small>{row?.share===null||row?.share===undefined?'—':`${row.share}% of start`}</small></div></div>
   </li>;
  })}</ol>
  <p className={styles.note}>Each person or lead counts once per step. Drop-off means they have not advanced in this period; it does not mean they are permanently lost.</p>
 </section>;
}
