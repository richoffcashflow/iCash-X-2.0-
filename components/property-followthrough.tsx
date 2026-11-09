import {safeLocalTime} from './workspace-view';
import type {propertyFollowthrough} from '@/lib/property-followthrough';
export function PropertyFollowthrough({progress:p,stale}:{progress:ReturnType<typeof propertyFollowthrough>;stale:boolean}){
 return <section className="property-followthrough" aria-label="Deal next step">
  <div className="property-followthrough-heading"><strong>Next move</strong><span>{stale?'Refreshing status':p.owner==='You'?'Needs you':p.owner==='Bot'?'Bot handles next':p.owner==='Stopped'?'Stopped':p.owner==='Awaiting update'?p.owner:'Waiting on '+p.owner.toLowerCase()}</span></div>
  <p>{p.next}</p><dl><div><dt>Last confirmed</dt><dd>{p.last?<>{p.last.label} · {safeLocalTime(p.last.at)}</>:'No completed action recorded'}</dd></div>
  {p.checkAt&&<div><dt>{p.checkLabel}</dt><dd>{safeLocalTime(p.checkAt,p.timezone)}</dd></div>}</dl>
 </section>;
}
