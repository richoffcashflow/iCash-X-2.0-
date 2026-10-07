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
 const [periodReports,setPeriodReports]=useState<WebinarIntelligenceReport[]>([]);
 useEffect(()=>{
  const controller=new AbortController();let disposed=false,inFlight=false;setData(null);setPeriodReports([]);setError('');
  async function load(){if(inFlight)return;inFlight=true;setLoading(true);try{
   const audience=context.split(':')[0];
   const results=await Promise.allSettled(['day','night'].map(period=>webinarRequest<WebinarIntelligenceReport>(`/api/webinar/intelligence?context=${audience}:${period}&ad=${encodeURIComponent(ad)}`,{cache:'no-store',signal:controller.signal},12000)));
   if(!disposed){
    const reports=results.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);
    setPeriodReports(reports);setData(reports.find(result=>result.context===context)??null);
    setError(results.some(result=>result.status==='rejected')?'Some results are unavailable. Try refreshing.':reports.some(result=>!result.metricsAvailable)?'Purchase statistics are temporarily unavailable. Saved routing decisions still apply.':'');
   }
  }catch(e){if(!disposed)setError(e instanceof Error?e.message:'Results are unavailable.');}finally{inFlight=false;if(!disposed)setLoading(false);}}
  const visible=()=>{if(!document.hidden)void load();};void load();const timer=setInterval(visible,60000);document.addEventListener('visibilitychange',visible);
  return()=>{disposed=true;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[context,ad,enabled,refresh]);
 const report=data?.context===context&&data.ad===ad?data:null;
 const winner=report?.arms.find(a=>a.key===report.plan.winnerKey);
 const activeCount=report?.arms.filter(a=>!report.plan.stoppedKeys.includes(a.key)).length??0;
 const phase=!enabled?'Paused':!report?'Loading':winner?'Optimizing':activeCount===1?'One active webinar':activeCount===0?'No active webinars':'Learning';
 const comparison=report?.comparison;
 const comparable=!!comparison&&comparison.holdout_visitors>=100&&comparison.adaptive_visitors>=100&&comparison.holdout_buyers+comparison.adaptive_buyers>=10;
 const baselineRpv=comparison?.holdout_visitors?comparison.holdout_value_cents/comparison.holdout_visitors:0;
 const adaptiveRpv=comparison?.adaptive_visitors?comparison.adaptive_value_cents/comparison.adaptive_visitors:0;
 async function copy(value:string){try{await navigator.clipboard.writeText(value);setNotice('Copied.');}catch{setNotice('Select and copy the text below.');}}
 async function toggle(value:boolean){setError('');try{await onToggle(value);}catch(e){setError(e instanceof Error?e.message:'Could not save.');}}
 return <div className="wi-panel">
  <section className="ws-card wi-hero"><div><span className="wb-eyebrow"><Sparkles size={14}/>AUTOMATIC WEBINAR TESTING</span><h2>Your best webinar. Automatically.</h2><p>Test new webinars. Back the winners. Stop the losers.</p></div><label className="wi-toggle"><input type="checkbox" role="switch" checked={enabled} disabled={busy} onChange={e=>void toggle(e.target.checked)}/><span>{enabled?'Automatic · on':'Automatic · off'}</span></label></section>
  {error&&<div className="ws-alert" role="alert">{error}<button className="wb-text" onClick={()=>setRefresh(n=>n+1)}>Try again</button></div>}
  {notice&&<p className="ws-notice" role="status">{notice}</p>}
  <section className="ws-card wi-link"><div><h3>One link for your ads</h3><p>Send visitors here. Intelligence chooses the webinar.</p><a href="/webinar" target="_blank" rel="noopener noreferrer">/webinar <ArrowUpRight size={15}/></a></div><button className="ws-secondary" onClick={()=>void copy(location.origin+'/webinar')}><Copy size={15}/>Copy link</button></section>
  <div className="wi-viewing"><span>{intelligenceContexts[context]} · {adLabel(ad)}</span><button className="wb-text" disabled={loading} aria-label="Refresh intelligence" onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={14} className={loading?'ws-spinning':''}/>Refresh</button></div>
  <section className="wi-summary" aria-busy={loading}><div><span>Status · {context.endsWith(':night')?'Night':'Day'}</span><strong>{phase}</strong><small>{!enabled?'Turn on to test automatically':report?`${activeCount} active · ${report.plan.stoppedKeys.length} stopped`:'Learning from confirmed purchases'}</small></div>{(['day','night'] as const).map(period=>{
   const periodContext=`${context.split(':')[0]}:${period}`,periodReport=periodReports.find(r=>r.context===periodContext&&r.ad===ad)??(report?.context===periodContext?report:null);
   const best=periodReport?.arms.find(a=>a.key===periodReport.plan.winnerKey),active=periodReport?.arms.filter(a=>!periodReport.plan.stoppedKeys.includes(a.key));
   const only=active?.length===1?active[0]:null,display=best??only,Icon=period==='day'?Sun:Moon;
   return <div key={period}><span className="wi-period-label"><Icon size={14}/>{period==='day'?'Best during the day':'Best at night'}</span><strong>{!enabled?'Paused':display?.title??(periodReport?active?.length?'Still testing':'No active webinar':'—')}</strong><small>{display?`${best?'Winner':'Only active webinar'} · ${display.version==='night'?'Night recording':period==='night'?'Day recording until Night is added':'Day recording'}`:'Day and Night learn separately'}</small></div>;
  })}</section>
  <section className="ws-card wi-recordings"><div className="ws-card-heading"><div><h2>Webinar results</h2><p>Last 30 days · {intelligenceContexts[context].toLowerCase()}</p></div><div className="wi-period-switch" role="group" aria-label="Results time of day">{(['day','night'] as const).map(period=><button type="button" key={period} aria-pressed={context.endsWith(`:${period}`)} onClick={()=>setContext(`${context.split(':')[0]}:${period}` as keyof typeof intelligenceContexts)}>{period==='day'?<Sun size={14}/>:<Moon size={14}/>} {period==='day'?'Day':'Night'}</button>)}</div></div>
   {!report?<p className="wi-empty" role="status">{error?'Results are unavailable. Try refreshing.':'Loading results…'}</p>:report.arms.length===0?<p className="wi-empty">Publish your first webinar to get started. Add a second to begin automatic testing.</p>:<div className="ws-table-wrap"><table className="wi-simple-table"><thead><tr><th>Webinar</th><th>Visitors</th><th>Buyers</th><th>Close rate</th><th>Avg. watch</th></tr></thead><tbody>{report.arms.map(arm=>{
    const row=report.rows.find(r=>r.webinar_id===arm.webinarId&&Number(r.revision)===arm.revision&&r.recording_version===arm.version),Icon=arm.version==='night'?Moon:Sun,stopped=report.plan.stoppedKeys.includes(arm.key);
    return <tr key={arm.key}><td><b>{arm.title}</b><small className="wi-version"><Icon size={12}/>{arm.version==='night'?'Night':'Day'}<span className={`wi-badge ${arm.key===winner?.key?'wi-winner':''}`}>{stopped?'Stopped · 0%':arm.key===winner?.key?'Winner':activeCount===1?'Ready':'Testing'}</span></small></td><td>{report.metricsAvailable===false?'—':row?.visitors??0}</td><td>{report.metricsAvailable===false?'—':row?.buyers??0}</td><td>{row?.mature_visitors?`${(row.buyers/row.mature_visitors*100).toFixed(1)}%`:'—'}</td><td>{row?.average_watch_seconds?formatWatchTime(row.average_watch_seconds):'—'}</td></tr>;
   })}</tbody></table></div>}
   <p className="ws-hint">Stopped webinars get 0% of new smart-link traffic for this audience. New versions get a fresh test. Buyers and close rate allow a full 24 hours to purchase.</p>
  </section>
  <details className="ws-card ws-routing-details wi-advanced"><summary>Advanced · ad tracking and testing details</summary>
   <div className="wi-filters"><label className="wb-label">Audience<select value={context} onChange={e=>setContext(e.target.value as keyof typeof intelligenceContexts)}>{Object.entries(intelligenceContexts).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="wb-label">Ad<select value={ad} onChange={e=>setAd(e.target.value)}><option value="*">All ads</option><option value="direct">Direct / untagged</option>{ad.startsWith('ad:')&&!report?.ads.some(a=>a.ad_key===ad)&&<option value={ad}>{adLabel(ad)}</option>}{report?.ads.filter(a=>a.ad_key.startsWith('ad:')).map(a=><option key={a.ad_key} value={a.ad_key}>{adLabel(a.ad_key)}</option>)}</select></label></div>
   <h3>How visitors are being assigned</h3><p>{winner?(report?.plan.source==='ad'?'Based on this ad’s purchases':'Using shared purchase results'):'New recordings continue learning until the evidence supports a winner.'}</p>
   <div className="ws-table-wrap"><table><thead><tr><th>Webinar</th><th>Ready to compare</th><th>Revenue / visitor</th><th>Planned traffic</th></tr></thead><tbody>{report?.arms.map(arm=>{
    const row=report.rows.find(r=>r.webinar_id===arm.webinarId&&Number(r.revision)===arm.revision&&r.recording_version===arm.version),share=report.plan.shares.find(item=>item.key===arm.key)?.share??0;
    return <tr key={arm.key}><td>{arm.title} · {arm.version==='night'?'Night':'Day'}</td><td>{report.metricsAvailable===false?'—':row?.mature_visitors??0}</td><td>{row?.mature_visitors?money(row.revenue_cents/row.mature_visitors):'—'}</td><td>{enabled?`${(share*100).toFixed(1)}%`:'Paused'}</td></tr>;
   })}</tbody></table></div>
   <section className="wi-comparison"><h3>Is automatic routing helping?</h3><p>A small comparison group uses an active baseline. The comparison restarts when the active lineup changes.</p><div className="wi-comparison-values"><div><span>Baseline revenue / visitor</span><strong>{comparison?.holdout_visitors?money(baselineRpv):'—'}</strong><small>{comparison?.holdout_visitors??0} visits ready to compare</small></div><div><span>Automatic revenue / visitor</span><strong>{comparison?.adaptive_visitors?money(adaptiveRpv):'—'}</strong><small>{comparison?.adaptive_visitors??0} visits ready to compare</small></div><div><span>Observed difference</span><strong>{comparable&&baselineRpv>0?`${((adaptiveRpv/baselineRpv-1)*100).toFixed(1)}%`:'Collecting data'}</strong><small>Observed results, not a guaranteed lift</small></div></div></section>
   <h3>Connect your ads</h3><p>Paste this into the URL parameters field in Meta so Intelligence can recognize each ad.</p><code className="wi-parameters">{metaWebinarParameters}</code><button className="ws-secondary" onClick={()=>void copy(metaWebinarParameters)}><Copy size={15}/>Copy ad parameters</button>
   <p>Day and Night choose their own winners. A recording stops only after enough randomized visits and confirmed purchases show it is underperforming. Stopped recordings receive no new test or baseline traffic. With challengers available, 20% tests active recordings, 5% uses the active baseline, and the rest favors the winner. One remaining recording gets 100%.</p><p>Ads with little data use shared results. Existing viewers keep their saved place. Later returns rotate through eligible unseen webinars; if all are stopped, the smart link opens checkout. Dedicated /live/ links open their specific webinar. Exclude a webinar from testing in Video &amp; details.</p><p>Only randomized traffic teaches the ranking. Repeat visits count once per visitor, ad and audience in the 30-day window. Stops remain saved until a new revision is published. Tests, previews and reviewed or refunded payments are excluded. Revenue means collected payments, not profit. Meta budgets stay in Meta.</p>
  </details>
 </div>;
}
