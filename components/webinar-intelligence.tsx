'use client';
import {useEffect,useState} from 'react';
import {ArrowUpRight,Copy,RefreshCw,Sparkles,Sun,Moon} from 'lucide-react';
import {webinarRequest} from '@/lib/webinar-client';
import {formatWatchTime} from '@/lib/webinar-policy';
import {intelligenceContexts,metaWebinarParameters,type WebinarIntelligenceReport} from '@/lib/webinar-intelligence-report';
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const adLabel=(ad:string)=>ad==='*'?'All ads':ad==='direct'?'Direct / untagged':`Ad ${ad.slice(3)}`;
export function WebinarIntelligence({enabled,busy,onToggle}:{enabled:boolean;busy:boolean;onToggle:(enabled:boolean)=>Promise<void>}){
 const [context,setContext]=useState<keyof typeof intelligenceContexts>('new:day');
 const [ad,setAd]=useState('*'),[data,setData]=useState<WebinarIntelligenceReport|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();let disposed=false,inFlight=false;setData(null);setError('');
  async function load(){if(inFlight)return;inFlight=true;setLoading(true);try{
   const result=await webinarRequest<WebinarIntelligenceReport>(`/api/webinar/intelligence?context=${encodeURIComponent(context)}&ad=${encodeURIComponent(ad)}`,{cache:'no-store',signal:controller.signal},12000);
   if(!disposed){setData(result);setError('');}
  }catch(e){if(!disposed)setError(e instanceof Error?e.message:'Results are unavailable.');}finally{inFlight=false;if(!disposed)setLoading(false);}}
  const visible=()=>{if(!document.hidden)void load();};void load();const timer=setInterval(visible,60000);document.addEventListener('visibilitychange',visible);
  return()=>{disposed=true;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[context,ad,enabled,refresh]);
 const report=data?.context===context&&data.ad===ad?data:null;
 const winner=report?.arms.find(a=>a.key===report.plan.winnerKey);
 const phase=!enabled?'Paused':!report?'Loading':report.plan.phase==='waiting'?'Waiting for recordings':winner?'Optimizing':'Learning';
 const comparison=report?.comparison;
 const comparable=!!comparison&&comparison.holdout_visitors>=100&&comparison.adaptive_visitors>=100&&comparison.holdout_buyers+comparison.adaptive_buyers>=10;
 const baselineRpv=comparison?.holdout_visitors?comparison.holdout_value_cents/comparison.holdout_visitors:0;
 const adaptiveRpv=comparison?.adaptive_visitors?comparison.adaptive_value_cents/comparison.adaptive_visitors:0;
 async function copy(value:string){try{await navigator.clipboard.writeText(value);setNotice('Copied.');}catch{setNotice('Select and copy the text below.');}}
 async function toggle(value:boolean){setError('');try{await onToggle(value);}catch(e){setError(e instanceof Error?e.message:'Could not save.');}}
 return <div className="wi-panel">
  <section className="ws-card wi-hero"><div><span className="wb-eyebrow"><Sparkles size={14}/>WEBINAR INTELLIGENCE</span><h2>Let every visit teach you.</h2><p>Find the webinar that turns each ad’s visitors into customers.</p></div><label className="wi-toggle"><input type="checkbox" role="switch" checked={enabled} disabled={busy} onChange={e=>void toggle(e.target.checked)}/><span>Auto-optimize</span></label></section>
  {error&&<div className="ws-alert" role="alert">{error}<button className="wb-text" onClick={()=>setRefresh(n=>n+1)}>Try again</button></div>}
  {notice&&<p className="ws-notice" role="status">{notice}</p>}
  <section className="ws-card wi-link"><div><h3>Your smart link</h3><p>Use this destination in your ads. New published webinars join testing automatically.</p><a href="/webinar" target="_blank" rel="noopener noreferrer">/webinar <ArrowUpRight size={15}/></a></div><button className="ws-secondary" onClick={()=>void copy(location.origin+'/webinar')}><Copy size={15}/>Copy smart link</button></section>
  <div className="wi-filters"><label className="wb-label">Audience<select value={context} onChange={e=>setContext(e.target.value as keyof typeof intelligenceContexts)}>{Object.entries(intelligenceContexts).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="wb-label">Ad<select value={ad} onChange={e=>setAd(e.target.value)}><option value="*">All ads</option><option value="direct">Direct / untagged</option>{ad.startsWith('ad:')&&!report?.ads.some(a=>a.ad_key===ad)&&<option value={ad}>{adLabel(ad)}</option>}{report?.ads.filter(a=>a.ad_key.startsWith('ad:')).map(a=><option key={a.ad_key} value={a.ad_key}>{adLabel(a.ad_key)}</option>)}</select></label><button className="ws-secondary" disabled={loading} aria-label="Refresh intelligence" onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={16} className={loading?'ws-spinning':''}/></button></div>
  <section className="wi-summary" aria-busy={loading}><div><span>Status</span><strong>{phase}</strong><small>{winner?(report?.plan.source==='ad'?'Based on this ad’s purchases':'Using shared purchase results'):'Comparing confirmed payments'}</small></div><div><span>Current winner</span><strong>{winner?.title??'Still learning'}</strong><small>{winner?`${winner.version==='night'?'Night':'Day'} recording`:'A few clicks cannot declare a winner'}</small></div><div><span>Testing</span><strong>{report?`${report.arms.length} recordings`:'—'}</strong><small>Day covers nighttime until Night is ready</small></div></section>
  <section className="ws-card wi-recordings"><div className="ws-card-heading"><div><h2>What’s working</h2><p>Last 30 days · purchases within 24 hours of the first assigned visit.</p></div></div>
   {report?.arms.length===0?<p className="wi-empty">Publish your first webinar to get started. Add a second to begin automatic testing.</p>:<div className="ws-table-wrap"><table><thead><tr><th>Webinar</th><th>Status</th><th>Visitors</th><th>Ready to compare</th><th>Close rate</th><th>Revenue / visitor</th><th>Avg. watch</th><th>Planned traffic</th></tr></thead><tbody>{report?.arms.map(arm=>{
    const row=report.rows.find(r=>r.webinar_id===arm.webinarId&&Number(r.revision)===arm.revision&&r.recording_version===arm.version),share=report.plan.shares.find(s=>s.key===arm.key)?.share??0,Icon=arm.version==='night'?Moon:Sun;
    return <tr key={arm.key}><td><b>{arm.title}</b><small className="wi-version"><Icon size={12}/>{arm.version==='night'?'Night':'Day'}</small></td><td><span className={`wi-badge ${arm.key===winner?.key?'wi-winner':''}`}>{arm.key===winner?.key?'Winner':report.arms.length===1?'Ready':'Testing'}</span></td><td>{row?.visitors??0}</td><td>{row?.mature_visitors??0}</td><td>{row?.mature_visitors?`${(row.buyers/row.mature_visitors*100).toFixed(1)}%`:'—'}</td><td>{row?.mature_visitors?money(row.revenue_cents/row.mature_visitors):'—'}</td><td>{row?.average_watch_seconds?formatWatchTime(row.average_watch_seconds):'—'}</td><td>{enabled?`${(share*100).toFixed(1)}%`:'Paused'}</td></tr>;
   })}</tbody></table></div>}
   {report?.arms.length===1&&<p className="ws-hint">This recording receives all eligible visits. Publish another webinar to test a challenger.</p>}
   <p className="ws-hint">Visitors get a full 24 hours before their purchase result enters learning. Each ad and audience uses the same event definitions. Watch time helps explain results; confirmed revenue determines allocation.</p>
  </section>
  <section className="ws-card wi-comparison"><div><h2>Is intelligence improving results?</h2><p>5% of visitors stay with the baseline recording. This compares that group with automatic routing for the same set of recordings.</p></div><div className="wi-comparison-values"><div><span>Baseline revenue / visitor</span><strong>{comparison?.holdout_visitors?money(baselineRpv):'—'}</strong><small>{comparison?.holdout_visitors??0} completed observation windows</small></div><div><span>Automatic revenue / visitor</span><strong>{comparison?.adaptive_visitors?money(adaptiveRpv):'—'}</strong><small>{comparison?.adaptive_visitors??0} completed observation windows</small></div><div><span>Observed difference</span><strong>{comparable&&baselineRpv>0?`${((adaptiveRpv/baselineRpv-1)*100).toFixed(1)}%`:'Collecting data'}</strong><small>Observed results, not a guaranteed lift</small></div></div></section>
  <details className="ws-card ws-routing-details"><summary>Ad tracking & how testing works</summary><p>Paste these into the URL parameters field for your Meta ads. This lets the smart link recognize each ad automatically.</p><code className="wi-parameters">{metaWebinarParameters}</code><button className="ws-secondary" onClick={()=>void copy(metaWebinarParameters)}><Copy size={15}/>Copy ad parameters</button><p>During learning, eligible recordings share randomized traffic. Once the data supports a winner, 20% of traffic continues randomized testing, 5% stays with the baseline, and the remainder favors the winner. Ads with little data use shared results until they have enough purchases.</p><p>Existing viewers keep their saved place. Later returns rotate through eligible unseen webinars. Dedicated /live/ links always open their specific webinar. Exclude a webinar from testing in Video &amp; details.</p><p>Only randomized traffic teaches the ranking. Repeat visits count once per visitor, ad and audience in the 30-day window. Edited revisions learn again. Tests, previews and reviewed or refunded payments are excluded. Revenue is collected payments, not profit. This controls webinar routing; your Meta campaign budgets stay in Meta.</p></details>
 </div>;
}
