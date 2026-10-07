'use client';
import {useState} from 'react';
import {ArrowUpRight,Bot,Building2,Check,FileSignature,MessageSquare} from 'lucide-react';

const features=[
 {label:'Research',Icon:Building2,title:'See the opportunity.',description:'Property details, comparable sales and cash offer estimates. Get the context for your next move.',details:['Property research','Cash offer analysis']},
 {label:'Conversations',Icon:MessageSquare,title:'Keep the conversation moving.',description:'Seller calls, texts and follow-ups in one place. Pick up the conversation with the context right there.',details:['Calls & texts','Conversation history']},
 {label:'Deal tools',Icon:FileSignature,title:'Turn a next step into a plan.',description:'Keep contract tools, buyer matching and AI guidance together as you work through a deal.',details:['Contract tools','Buyer matching']},
];

export function PlanWorkspacePreview(){
 const [selected,setSelected]=useState(0);
 const feature=features[selected],Icon=feature.Icon;
 return <section className="wb-product-preview" aria-label="Interactive workspace preview">
  <div className="wb-preview-chrome"><span><i/><i/><i/></span><span>YOUR WORKSPACE</span><small>PREVIEW</small></div>
  <div className="wb-preview-bot"><div className="wb-preview-avatar"><Bot size={30} strokeWidth={1.4} aria-hidden="true"/></div><div><strong>You call the shots.</strong><p>Your AI does the groundwork.</p></div><ArrowUpRight size={20} aria-hidden="true"/></div>
  <div className="wb-preview-options" role="group" aria-label="Explore your workspace">{features.map(({label,Icon},index)=><button type="button" key={label} aria-pressed={selected===index} aria-controls="workspace-feature-preview" onClick={()=>setSelected(index)}><Icon size={15} aria-hidden="true"/>{label}</button>)}</div>
  <div className="wb-preview-detail" id="workspace-feature-preview" aria-live="polite">
   <span className="wb-preview-feature-icon"><Icon size={22} strokeWidth={1.5} aria-hidden="true"/></span>
   <h2>{feature.title}</h2><p>{feature.description}</p>
   <div className="wb-preview-tags">{feature.details.map(detail=><span key={detail}><Check size={12} aria-hidden="true"/>{detail}</span>)}</div>
  </div>
 </section>;
}
