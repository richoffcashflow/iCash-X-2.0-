'use client';
import {useState} from 'react';
import {webinarRequest as workspaceRequest} from '@/lib/webinar-client';
import {closingSetupNext,closingReviewLabels,type ClosingSetupView,type PayoutPreference,type TitleProposal} from '@/lib/closing-setup';

const blankPayout:PayoutPreference={payeeName:'',payeeType:'individual',method:'check_pickup',mailingAddress:'',detailsSharedWithTitle:false};
const blankTitle:TitleProposal={company:'',closer:'',email:'',phone:''};
function officialLink(value:string){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
export function ClosingSetup({dealId,view,onSaved}:{dealId:string;view:ClosingSetupView;onSaved:()=>void}){
 const [payout,setPayout]=useState(view.setup?.payout??blankPayout),[title,setTitle]=useState(view.setup?.title_proposal??blankTitle);
 const [editing,setEditing]=useState<'payout'|'title'|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [independent,setIndependent]=useState(false),[coverage,setCoverage]=useState(false),[agreed,setAgreed]=useState(false);
 const next=closingSetupNext(view),proposal=view.setup?.title_proposal;
 async function save(action:string,data:unknown){
  if(busy)return;setBusy(true);setError('');setMessage('');
  try{await workspaceRequest('/api/work/closing-setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dealId,action,data})});setEditing(null);setMessage(action==='takeover'?'You’re handling this property. Automation is paused.':action==='confirm_title'?'Closer selected. No documents or payment instructions were sent.':'Saved for this deal.');setIndependent(false);setCoverage(false);setAgreed(false);}
  catch(e){setError(e instanceof Error?e.message:'Could not save. Please retry.');}finally{setBusy(false);onSaved();}
 }
 function changePayout(patch:Partial<PayoutPreference>){setPayout(p=>({...p,...patch,detailsSharedWithTitle:false}));}
 return <section className="closing-progress closing-setup" aria-label="Title and your payment"><h4>Title & your payment</h4><p>{next.text}</p>
 {view.setup?.review_reason!=='setup'&&view.setup?.review_reason&&<p role="status"><strong>{closingReviewLabels[view.setup.review_reason]}</strong></p>}
 <div><strong>{view.verifiedContact?'Selected closer':'Choose your closing office'}</strong>{view.verifiedContact?<p>{proposal?.company??'Verified title contact'} · {view.verifiedContact.email}{proposal?.phone&&<><br/>Verified phone: <a href={'tel:'+proposal.phone}>{proposal.phone}</a></>}</p>:<>
 {view.buyerSuggestions.length>0&&<details><summary>Buyer’s title preference</summary>{view.buyerSuggestions.map(s=><p key={s.id} style={{whiteSpace:'pre-wrap'}}>{s.title_quote}</p>)}<small>Buyer-provided details need independent confirmation.</small></details>}
 {!proposal&&view.directory.length>0&&<details><summary>Local title candidates ({view.directory.length})</summary><p>Confirm county coverage, assignment handling, fees and a named closer.</p>{view.directory.map(c=><p key={c.id}><strong>{c.name}</strong>{officialLink(c.source_url)&&<> · <a href={officialLink(c.source_url)!} target="_blank" rel="noreferrer">Official website</a></>}<br/>{c.public_phone??c.public_email??'Use the official website for contact details.'}<br/><button type="button" disabled={busy} onClick={()=>{const digits=(c.public_phone??'').replace(/\D/g,'');setTitle({company:c.name,closer:'',email:c.public_email??'',phone:digits.length===10?'+1'+digits:digits.length===11&&digits.startsWith('1')?'+'+digits:''});setEditing('title');}}>Use as a preference</button></p>)}</details>}
 {proposal&&<p>Preference: {proposal.company}. Verification is still needed.</p>}
 </>}
 <button type="button" className="demo-button" disabled={busy} onClick={()=>{setTitle(view.setup?.title_proposal??blankTitle);setEditing('title');setError('');}}>{view.verifiedContact?'Review closing contact':'Add or review a title company'}</button>
 {editing==='title'&&<form onSubmit={e=>{e.preventDefault();void save('title_preference',title);}}>
 <label>Title company<input value={title.company} maxLength={200} required onChange={e=>setTitle(t=>({...t,company:e.target.value}))}/></label>
 <label>Closer’s name<input value={title.closer} maxLength={200} onChange={e=>setTitle(t=>({...t,closer:e.target.value}))}/></label>
 <label>Closer’s email<input type="email" value={title.email} maxLength={254} onChange={e=>setTitle(t=>({...t,email:e.target.value}))}/></label>
 <label>Independently checked company phone<input type="tel" value={title.phone} placeholder="+12145551234" maxLength={16} onChange={e=>setTitle(t=>({...t,phone:e.target.value}))}/></label>
 <p>A company name is enough to save a preference. Complete the contact details before verification.</p><button className="fund-button" disabled={busy}>Save preference</button></form>}
 {!view.verifiedContact&&proposal&&proposal.closer&&proposal.email&&proposal.phone&&editing===null&&<form onSubmit={e=>{e.preventDefault();void save('confirm_title',{revision:view.setup!.updated_at,independentContact:independent,assignmentsAndCoverage:coverage,agreedByParties:agreed});}}>
 <label className="closing-attestation"><input type="checkbox" checked={independent} onChange={e=>setIndependent(e.target.checked)} required/>I confirmed the closer’s identity and email using a phone number from the company’s official website or an established trusted contact.</label>
 <label className="closing-attestation"><input type="checkbox" checked={coverage} onChange={e=>setCoverage(e.target.checked)} required/>The office confirmed it handles assignments for this property’s county and will provide its required documents and secure payment process.</label>
 <label className="closing-attestation"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} required/>This choice agrees with the signed terms and the parties. I’m not replacing a different closer without approval.</label>
 <button className="fund-button" disabled={busy||!independent||!coverage||!agreed}>Confirm this closer</button></form>}
 </div>
 <div><strong>How you receive your proceeds</strong>{view.setup?.payout&&<p>{view.setup.payout.payeeName} · {{check_pickup:'Check pickup',check_mail:'Mailed check',wire:'Wire'}[view.setup.payout.method]}</p>}
 <button type="button" className="demo-button" disabled={busy} onClick={()=>{setPayout(view.setup?.payout??blankPayout);setEditing('payout');setError('');}}>{view.setup?.payout?'Review payment preference':'Set payment preference'}</button>
 {editing==='payout'&&<form onSubmit={e=>{e.preventDefault();void save('payout',payout);}}>
 <label>Legal payee name<input autoComplete="organization" value={payout.payeeName} required maxLength={200} onChange={e=>changePayout({payeeName:e.target.value})}/></label>
 <label>Payee type<select value={payout.payeeType} onChange={e=>changePayout({payeeType:e.target.value as PayoutPreference['payeeType']})}><option value="individual">Individual</option><option value="company">Company / LLC</option></select></label>
 <label>Preferred payment<select value={payout.method} onChange={e=>changePayout({method:e.target.value as PayoutPreference['method'],mailingAddress:''})}><option value="check_pickup">Pick up a check</option><option value="check_mail">Mail a check</option><option value="wire">Wire to my bank</option></select></label>
 {payout.method==='check_mail'&&<label>Check mailing address<textarea autoComplete="street-address" value={payout.mailingAddress} maxLength={500} required onChange={e=>changePayout({mailingAddress:e.target.value})}/></label>}
 {payout.method==='wire'&&<p>Give bank details directly to the verified closer through their secure process. Confirm by calling their independently verified number. Do not enter bank numbers here.</p>}
 {payout.payeeType==='company'&&<p>Title may request entity documents and proof that the signer can act for the company.</p>}
 <p>Title confirms the payee, ID or tax forms it needs, final amount and payment timing. Share IDs and tax documents directly with the closer.</p>
 <label className="closing-attestation"><input type="checkbox" checked={payout.detailsSharedWithTitle} onChange={e=>setPayout(p=>({...p,detailsSharedWithTitle:e.target.checked}))}/>I gave the payment details directly to title through its secure process.</label>
 <button className="fund-button" disabled={busy}>Save payment preference</button></form>}
 </div>
 <details><summary>Need a person to handle this?</summary><p>Take over for a buyer request, title rejection, payment change or a contract issue. New automated outreach pauses for the property. A call already in progress may finish. No live transfer or callback is booked.</p>
 <button className="demo-button" type="button" disabled={busy} onClick={()=>void save('takeover',{reason:view.setup?.review_reason&&view.setup.review_reason!=='setup'?view.setup.review_reason:'human_requested'})}>I’ll handle this property</button></details>
 {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 <small>Your payment preference goes only to the verified closing office. Changes after the opening request are queued as tracked updates in Closing tasks. Bank details stay with your closer.</small></section>;
}
