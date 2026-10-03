'use client';
import type {SupportEvidence} from '@/lib/support-policy';
import {supportCheckLabels,supportCheckTime,supportNextStep} from '@/lib/support-self-service';

export function SupportAccountChecks({evidence,loading,busy,onRefresh,onCancel,onTeam}:{evidence:SupportEvidence[];loading:boolean;busy:boolean;onRefresh:()=>void;onCancel:()=>void;onTeam:(e:SupportEvidence)=>void}){
 const summary=evidence.filter(e=>['work','credits','billing','payments'].includes(e.key));
 const other=evidence.filter(e=>!['work','credits','billing','payments'].includes(e.key));
 function card(e:SupportEvidence){
  const next=supportNextStep(e);
  return <article className="support-check" data-status={e.status} key={e.key}>
   <div className="support-check-heading"><h3>{supportCheckLabels[e.key]??'Account check'}</h3><span>{e.status==='unknown'?'Unverified':e.status==='attention'?'Needs attention':'Checked'}</span></div>
   <p>{e.detail}</p>
   {next&&<div className="support-check-next"><p>{next.text}</p>{next.action==='workspace'?<a href="/">{next.label} →</a>:<button type="button" disabled={busy||loading} onClick={next.action==='cancel'?onCancel:next.action==='team'?()=>onTeam(e):onRefresh}>{next.action==='team'?'Prepare support question':next.label}</button>}</div>}
  </article>;
 }
 return <section className="support-account-checks" aria-labelledby="support-account-heading" aria-busy={loading}>
  <div className="support-account-heading"><div><h2 id="support-account-heading">Your account at a glance</h2><p>{loading?'Checking your account…':evidence.length?`Account records checked ${supportCheckTime(evidence[0].observedAt)}`:'Account checks are unavailable. Refresh status to try again.'}</p></div></div>
  {evidence.length>0&&<><p className="support-check-scope">These checks explain what is recorded. They do not start work, retry payments, or change your settings.</p><div className="support-check-grid">{summary.map(card)}</div>{other.length>0&&<details className="support-other-checks"><summary>Service and work checks{other.some(e=>e.status!=='ok')?' · Needs attention':''}</summary><div className="support-check-grid">{other.map(card)}</div></details>}</>}
 </section>;
}
