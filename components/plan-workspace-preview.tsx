'use client';
import {useState} from 'react';
import {ArrowUpRight,Building2,Check,FileSignature,House,MessageSquare,Phone,Users} from 'lucide-react';

const features=[
 {label:'Research',Icon:Building2},
 {label:'Conversations',Icon:MessageSquare},
 {label:'Deal tools',Icon:FileSignature},
];

export function PlanWorkspacePreview(){
 const [selected,setSelected]=useState(0);
 return <section className="wb-product-preview" aria-label="Interactive workspace preview">
  <div className="wb-preview-chrome"><span className="wb-preview-dots" aria-hidden="true"><i/><i/><i/></span><span>YOUR WORKSPACE</span><small>PREVIEW</small></div>
  <div className="wb-preview-heading"><div><strong>Less busywork. More progress.</strong><p>Explore what your bot can help with.</p></div><ArrowUpRight size={21} aria-hidden="true"/></div>
  <div className="wb-preview-options" role="group" aria-label="Explore your workspace">{features.map(({label,Icon},index)=><button type="button" key={label} aria-pressed={selected===index} aria-controls="workspace-feature-preview" onClick={()=>setSelected(index)}><Icon size={14} aria-hidden="true"/>{label}</button>)}</div>
  <div className="wb-preview-detail" id="workspace-feature-preview" aria-live="polite" aria-atomic="true">
   {selected===0?<>
    <div className="wb-preview-property"><span className="wb-preview-house"><House size={29} strokeWidth={1.4} aria-hidden="true"/></span><div><strong>Start with a property.</strong><p>Research → offer estimate</p></div><span className="wb-preview-example">Example</span></div>
    <dl className="wb-preview-research"><div><dt>Comparable sales</dt><dd>Compare</dd></div><div><dt>Repair details</dt><dd>Review</dd></div><div><dt>Cash offer estimate</dt><dd>Prepare</dd></div></dl>
   </>:selected===1?<>
    <div className="wb-preview-conversation-title"><strong>Keep the conversation moving.</strong><span className="wb-preview-example">Example</span></div>
    <div className="wb-preview-messages"><p><span>Your bot</span>Does the property need any repairs?</p><p><span>Seller</span>The kitchen needs updating.</p></div>
    <div className="wb-preview-call"><Phone size={14} aria-hidden="true"/><span>Calls, recordings &amp; replies in one place</span></div>
   </>:<>
    <div className="wb-preview-conversation-title"><strong>From offer to next steps.</strong><span className="wb-preview-example">Example</span></div>
    <ol className="wb-preview-deal-steps">
     <li><Check size={17} aria-hidden="true"/><div><strong>Prepare your offer</strong><span>Property research &amp; estimates</span></div></li>
     <li><FileSignature size={17} aria-hidden="true"/><div><strong>Send the agreement</strong><span>Contracts &amp; e-signatures</span></div></li>
     <li><Users size={17} aria-hidden="true"/><div><strong>Connect with buyers</strong><span>Matching, texts &amp; email</span></div></li>
    </ol>
   </>}
  </div>
 </section>;
}
