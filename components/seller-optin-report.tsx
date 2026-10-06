'use client';
import {useState} from 'react';
import {sellerOptinVariants,type SellerOptinRow,type SellerOptinPlan} from '@/lib/seller-optin';
type Report={rows:SellerOptinRow[];groups:({source:string;device:string}&SellerOptinPlan)[]};
const percent=(n:number,total:number)=>total?`${(n/total*100).toFixed(1)}%`:'—';
export function SellerOptinReport({data}:{data:Report|null}){
 const [segment,setSegment]=useState('all');
 if(!data)return <section><h2>Opt-in performance</h2><p>Measurement is temporarily unavailable. The seller form remains open.</p></section>;
 const rows=data.rows.filter(r=>segment==='all'||`${r.source}:${r.device}`===segment);
 const totals=sellerOptinVariants.map(v=>({...v,...rows.filter(r=>r.variant===v.id).reduce((a,r)=>({views:a.views+r.views,starts:a.starts+r.starts,contacts:a.contacts+r.contacts,submissions:a.submissions+r.submissions,qualified:a.qualified+r.qualified}),{views:0,starts:0,contacts:0,submissions:0,qualified:0})}));
 const group=data.groups.find(g=>`${g.source}:${g.device}`===segment);
 return <section aria-label="Opt-in performance" className="seller-optin-report"><div className="seller-optin-report-heading"><div><h2>Opt-in performance</h2><p>Automatic testing · Last 31 days</p></div><label>Audience<select value={segment} onChange={e=>setSegment(e.target.value)}><option value="all">All visitors</option>{data.groups.map(g=><option key={`${g.source}:${g.device}`} value={`${g.source}:${g.device}`}>{g.source} · {g.device}</option>)}</select></label></div>
 <p>{group?.winner?`${sellerOptinVariants.find(v=>v.id===group.winner)?.label} receives 80% of new visitors in this audience. The other versions receive 10% each.`:segment==='all'&&data.groups.some(g=>g.winner)?'Traffic is favoring a leading version in some audiences. Select an audience to see its current allocation.':'Learning: versions share traffic equally until enough qualified requests separate a winner within an audience.'}</p>
 <div className="seller-optin-table-wrap"><table><thead><tr><th scope="col">Version</th><th scope="col">Visitors</th><th scope="col">Form starts</th><th scope="col">Contact step</th><th scope="col">Requests</th><th scope="col">Opt-in rate</th><th scope="col">Qualified</th><th scope="col">Qualified rate</th></tr></thead><tbody>{totals.map(v=><tr key={v.id}><th scope="row">{v.label}{group?.winner===v.id&&<small>Leading</small>}</th><td>{v.views}</td><td>{v.starts}</td><td>{v.contacts}</td><td>{v.submissions}</td><td>{percent(v.submissions,v.views)}</td><td>{v.qualified}</td><td>{percent(v.qualified,v.views)}</td></tr>)}</tbody></table></div>
 <p className="seller-optin-method">Routing uses qualified requests within 24 hours, reviewed in daily cohorts. At least 100 mature visitors per version and 10 qualified requests for the leader are required, plus a conservative separation check. Mobile and desktop are evaluated separately within each traffic source. Repeat visits keep the same version.</p>
 </section>;
}
