'use client';
import {useEffect,useState} from 'react';
import {AccountAccess} from '@/components/account-access';
import {webinarRequest} from '@/lib/webinar-client';
import {disputeMoney,disputeTime,disputeNeedsResponse,type DisputeSummary,type EvidencePacket} from '@/lib/disputes';
import styles from './view.module.css';
type Report={mode:'live'|'test';disputes:DisputeSummary[];nextCursor:string|null;checkedAt:string};
export function DisputesView(){
 const [cursor,setCursor]=useState(''),[selected,setSelected]=useState<string|null>(null),[revision,setRevision]=useState(0);
 const [report,setReport]=useState<Report|null>(null),[packet,setPacket]=useState<EvidencePacket|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[denied,setDenied]=useState<401|403|null>(null);
 useEffect(()=>{let active=true;const controller=new AbortController();setBusy(true);setError('');setPacket(null);setReport(null);
  const url='/api/admin/disputes'+(selected?'?id='+selected:cursor?'?after='+cursor:'');
  void webinarRequest<Report|{packet:EvidencePacket}>(url,{cache:'no-store',signal:controller.signal},55000).then(result=>{
   if(!active)return;
   if(selected){if(!('packet' in result)||result.packet.dispute.id!==selected)throw Error('Incomplete evidence.');setPacket(result.packet);}
   else{if(!('disputes' in result)||!Array.isArray(result.disputes))throw Error('Incomplete dispute list.');setReport(result);}
   setDenied(null);
  }).catch(e=>{if(!active)return;const status=(e as {status?:number})?.status;if(status===401||status===403){setDenied(status);setReport(null);setPacket(null);}else setError(e instanceof Error?e.message:'Could not load disputes.');}).finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;controller.abort();};
 },[cursor,selected,revision]);
 const due=report?.disputes.filter(d=>disputeNeedsResponse(d.status))??[];
 return <main className={styles.page}><nav><a href="/admin">← Overview</a><span>iCash X <b>Owner</b></span></nav>
  <header><div><h1>Disputes</h1><p>Know what needs a response. Keep the evidence together.</p></div><button disabled={busy} onClick={()=>setRevision(v=>v+1)}>{busy?'Loading…':'Refresh'}</button></header>
  {denied?<section><h2>{denied===401?'Sign in to your owner account':'Owner access only'}</h2>{denied===401&&<AccountAccess onSignedIn={()=>{setDenied(null);setRevision(v=>v+1);}}/>}</section>:<>
   {error&&<p className={styles.notice} role="alert">{error} <a href="https://dashboard.stripe.com/disputes" target="_blank" rel="noopener noreferrer">Open Stripe</a></p>}
   {busy&&<p role="status">{selected?'Preparing payment, purchase and usage evidence…':'Checking Stripe…'}</p>}
   {packet?<><button onClick={()=>setSelected(null)}>← All disputes</button><section><div className={styles.detailHeading}><div><h2>{disputeMoney(packet.dispute.amountCents,packet.dispute.currency)}</h2><p>{packet.customer}</p></div><span>{packet.dispute.status.replaceAll('_',' ')}</span></div><p><strong>{packet.dispute.reason.replaceAll('_',' ')}</strong> · Respond by {disputeTime(packet.dispute.dueAt)}</p><p>{packet.guidance}</p><div className={styles.actions}><a href={`/api/admin/disputes?id=${packet.dispute.id}&format=pdf`}>Download evidence PDF</a><a href={`/api/admin/disputes?id=${packet.dispute.id}&format=download`}>Download original records</a><a href={packet.dispute.stripeUrl} target="_blank" rel="noopener noreferrer">Review &amp; submit in Stripe ↗</a></div><p className={styles.note}>Draft only. Check the claim and missing evidence below before submitting. Downloading does not send a response or issue a refund.</p></section>
    <section><h2>Review before submitting</h2><ul>{packet.gaps.map((gap,i)=><li key={i}>{gap}</li>)}</ul></section>
    {packet.sections.map((section,i)=><details className={styles.evidence} key={i}><summary>{section.title}<span>{section.lines.length} records</span></summary>{section.lines.length?section.lines.map((line,j)=><p key={j}>{line}</p>):<p>No records in this selection.</p>}</details>)}
   </>:report?<><div className={styles.metrics}><section><p>Need a response</p><strong>{due.length}</strong></section><section><p>Past deadline</p><strong>{due.filter(d=>d.pastDue||!!d.dueAt&&Date.parse(d.dueAt)<Date.now()).length}</strong></section><section><p>Recorded disputes</p><strong>{report.disputes.length}</strong></section></div><p className={styles.note}>{report.mode==='test'?'Test mode · ':''}{cursor?'Next':'Latest'} 50 disputes · Updated {disputeTime(report.checkedAt)}. Counts cover this page.</p>
    {report.disputes.length?<div className={styles.tableWrap}><table><thead><tr><th>Customer &amp; payment</th><th>Reason</th><th>Status</th><th>Response due · CT</th><th/></tr></thead><tbody>{report.disputes.map(d=><tr key={d.id}><td><strong>{disputeMoney(d.amountCents,d.currency)}</strong><small>{d.customer??'Customer details in evidence'}</small><small>{d.paymentId??d.chargeId}</small></td><td>{d.reason.replaceAll('_',' ')}</td><td>{d.status.replaceAll('_',' ')}{d.pastDue&&disputeNeedsResponse(d.status)&&<small>Deadline passed</small>}</td><td>{disputeNeedsResponse(d.status)?disputeTime(d.dueAt):'—'}</td><td><button onClick={()=>setSelected(d.id)}>Prepare evidence</button></td></tr>)}</tbody></table></div>:<section className={styles.empty}><h2>No disputes</h2><p>No disputes were returned by Stripe for this page.</p></section>}
    <div className={styles.actions}>{cursor&&<button onClick={()=>setCursor('')}>Back to latest</button>}{report.nextCursor&&<button onClick={()=>setCursor(report.nextCursor!)}>Older disputes</button>}<a href="https://dashboard.stripe.com/disputes" target="_blank" rel="noopener noreferrer">Open Stripe ↗</a></div>
   </>:null}
  </>}
 </main>;
}
