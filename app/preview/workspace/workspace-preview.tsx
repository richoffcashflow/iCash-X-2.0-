'use client';
import {useRef,useState} from 'react';
import {House,MessageCircle,Phone,X} from 'lucide-react';
import {PropertyCardHeader} from '@/components/property-card-header';
import {PropertyFocus} from '@/components/property-focus';
import {WorkspacePanel} from '@/components/workspace-panel';
import {BuyerOverview,type BuyerNetworkProgress,type BuyerSelection} from '@/components/buyer-overview';
import {PropertyAnalysisSummary} from '@/components/property-analysis-summary';
import {agreementWorkspace} from '@/lib/agreement-workspace';
import {dealCardSummary} from '@/lib/deal-card-summary';
import {revealWorkspaceSection} from '@/lib/workspace-navigation';
import styles from '../../workspace-easy.module.css';
import '../../icash-brand.css';

const property={id:'sample-property',completed_at:'2026-10-14T15:00:00Z',result:{property:{propertyId:'sample',address:'128 Sample Lane, Dallas, TX 75201',bedrooms:3,bathrooms:2,livingAreaSqft:1420,yearBuilt:1982,arvEstimate:{cents:19000000},repairs:{baselineCents:4500000}},financialCheck:{status:'eligible',reason:'Sample property'},preliminarySellerCeilingCents:9000000}};
const buyers=[{buyer_id:'sample-buyer-1',name:'Cedar Ridge Homes',rank:1,ready:true}];
const network:BuyerNetworkProgress={matches:8,emailed:6,responses:2,buyers:[{id:'sample-response-1',name:'Avery Morgan',state:'replied',reply:'I’m interested. Is the property available to view this Thursday afternoon?'},{id:'sample-response-2',name:'Jordan Ellis',state:'interested',reply:null}]};
const scenarios=[['lead','New lead'],['waiting','Waiting for seller'],['buyers','Buyers interested'],['closing','Closing']] as const;
type Scenario=typeof scenarios[number][0];

/** Fixture-only presentation. Uses the production cards without account or work APIs. */
export function WorkspacePreview(){
 const [scenario,setScenario]=useState<Scenario>('buyers'),[active,setActive]=useState(true),[contact,setContact]=useState<'texts'|'calls'|'package'|null>(null);
 const dialog=useRef<HTMLDialogElement>(null);
 const [selected,setSelected]=useState<BuyerSelection|null>(null);
 const contracted=['buyers','closing'].includes(scenario);
 const stage=scenario==='closing'?'closing':contracted?'under_contract':'draft';
 const envelopes=scenario==='lead'?[]:[{id:'sample-purchase',deal_id:'sample-deal',kind:'purchase',state:contracted?'completed':'awaiting_counterparty',test_mode:false},...(scenario==='closing'?[{id:'sample-assignment',deal_id:'sample-deal',kind:'assignment',state:'completed',test_mode:false}]:[])];
 const deal=scenario==='lead'?undefined:{id:'sample-deal',stage,terms:{priceCents:9000000}};
 const summary=dealCardSummary(deal,envelopes),agreement=agreementWorkspace(stage,envelopes);
 function panel(id:string){revealWorkspaceSection(document.getElementById(`sample-${id}`));}
 function openBuyer(buyer:BuyerSelection){setSelected(buyer);panel('buyer');}
 function show(view:typeof contact){setContact(view);dialog.current?.showModal();}
 return <div className={`console-shell personalized-workspace minimal-workspace assistant-workspace icash-brand-workspace workspace-preview ${styles.workspace}`}>
  <header className="console-header"><span className="preview-brand">iCash X</span><span className="workspace-preview-label">Workspace preview</span></header>
  <main className="console-main">
   <section className="workspace-preview-banner" aria-label="Preview controls"><div><span className="workspace-preview-label">Interactive preview · Sample data</span><h1>One property. One clear next step.</h1><p>Fictional people and property. No messages, signatures or payments are sent.</p></div><label className="workspace-preview-stage">Preview a stage<select value={scenario} onChange={e=>{setScenario(e.target.value as Scenario);setActive(true);}}>{scenarios.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label></section>
   {contracted&&<WorkspacePanel id="platform-buyer-network" title="Buyer network" label="Buyer network · 2 replies"><BuyerOverview buyers={[]} network={network} onBuyer={openBuyer}/><p>Sample VIP network. You can open each buyer from their property.</p></WorkspacePanel>}
   <section className="operation-panel" aria-label="Sample workspace"><div className="live-work"><div className="workspace-section-heading leads-heading"><h3>Your leads</h3><small>1 sample lead</small></div>
    <div className="property-list"><article className="live-property" data-expanded={active} id="property-sample-property" aria-labelledby="property-address-sample-property"><div className="property-disclosure">
     <PropertyCardHeader property={property} owner="Taylor Parker" bot={{label:'Preview',tone:'gray',detail:'Sample workspace'}} dealSummary={summary} phase={scenario==='closing'?'Closing':'Under contract'} active={active} sellerSummary={scenario==='lead'?'Seller is interested in learning more about an offer.':scenario==='waiting'?'Seller is reviewing the purchase agreement.':'Purchase agreement signed. Buyer activity is now available.'} thumbnail={<span className="property-thumbnail"><span className="property-thumbnail-empty"><House size={24} aria-hidden="true"/><span>Sample home</span></span></span>} onToggle={()=>setActive(v=>!v)} onContact={show}/>
     <div className="property-details" id="property-content-sample-property" hidden={!active}>
      {scenario==='lead'&&<PropertyFocus title="Latest from the seller" detail="The seller wants to learn more about an offer. Their conversations are saved in Calls and Texts."/>}
      {scenario==='waiting'&&<PropertyFocus title={agreement.title} detail="No action needed. We’ll show you here when it’s your turn."/>}
      {scenario==='closing'&&<PropertyFocus title="Closing in progress" detail="Example Title has opened the file. Target closing: October 30, 2026. Payment has not been received."><button type="button" className="demo-button" onClick={()=>panel('closing')}>Review closing</button></PropertyFocus>}
      {scenario==='buyers'&&<section className="buyer-workspace" aria-label="Buyers"><BuyerOverview buyers={buyers} network={network} buyerPackage={{askingPriceCents:10000000,url:'#sample-package'}} onOpenPackage={()=>show('package')} onBuyer={openBuyer}/></section>}
      <div className="property-secondary-actions">
       <WorkspacePanel title="Property details" label="Property details"><h4>Price & repair estimates</h4><PropertyAnalysisSummary result={property.result}/><h4>Property & owner</h4><p>3 beds · 2 baths · 1,420 sq. ft.</p><p>Taylor Parker · fictional seller</p><h4>Bot controls</h4><p>In your workspace you can pause or resume the bot for this lead here.</p></WorkspacePanel>
       {scenario!=='lead'&&<WorkspacePanel id="sample-agreements" title="Agreements" label="Documents"><h4>Purchase agreement</h4><p>{contracted?'All signatures verified.':'Waiting for the seller’s signature.'}</p>{scenario==='closing'&&<><h4>Buyer agreement</h4><p>All signatures verified.</p></>}<dl className="home-facts"><div><dt>Seller</dt><dd>Taylor Parker</dd></div><div><dt>Purchase price</dt><dd>$90,000</dd></div></dl>{contracted&&<div className="panel-shortcuts"><button type="button" className="workspace-quiet" onClick={()=>panel('closing')}>Closing office & payment</button><button type="button" className="workspace-quiet" onClick={()=>panel('visits')}>Visits & buyer deposit</button></div>}<p>Sample agreement history. Your workspace also keeps manual document tools here.</p></WorkspacePanel>}
      </div>
      <WorkspacePanel id="sample-buyer" title={selected?.buyer.name??'Buyer'}>
       {selected?.kind==='response'?<><p>{selected.buyer.state==='replied'?'Buyer reply':'Interested buyer'}</p><blockquote className="reply-quote">{selected.buyer.reply??'This buyer marked the property as interesting.'}</blockquote><p>Funds & signing authority need review before an agreement. Interest does not reserve the property.</p><p className="preview-sample-note">In your workspace, this is where you can email the buyer or mark their reply handled.</p></>:<><p>Funds & signing authority verified at last check.</p><p>This is a recorded match. No commitment to buy has been recorded.</p></>}
       <div className="panel-shortcuts"><button type="button" className="workspace-quiet" onClick={()=>panel('funds')}>Review buyer funds</button><button type="button" className="workspace-quiet" onClick={()=>panel('visits')}>Viewing times & deposit</button></div>
      </WorkspacePanel>
      <WorkspacePanel id="sample-funds" title="Buyer funds & signing authority"><p>Cedar Ridge Homes has reviewed funds and signing authority in this example. Avery Morgan and Jordan Ellis still need review.</p><p>In your workspace, you can submit dated buyer evidence for a qualified reviewer here.</p></WorkspacePanel>
      <WorkspacePanel id="sample-visits" title="Visits & buyer deposit"><h4>Seller availability</h4><p>Thursday, October 15 · 2:00 PM – 4:00 PM Central.</p><p>Avery asked to visit. A specific appointment still needs confirmation from the seller and buyer.</p>{scenario==='closing'&&<><h4>Buyer deposit</h4><p>Sample deposit: $2,000 received and cleared.</p></>}</WorkspacePanel>
      <WorkspacePanel id="sample-closing" title="Closing"><h4>{scenario==='closing'?'Closing in progress':'Choose your closing office'}</h4><p>{scenario==='closing'?'Example Title has opened the file. Target closing: October 30, 2026. Funds have not been received.':'When you’re ready, choose a title company and save how you want to receive your proceeds.'}</p><p>This is sample closing information.</p></WorkspacePanel>
     </div>
    </div></article></div>
   </div></section>
  </main>
  <dialog ref={dialog} className="property-contact-dialog" aria-labelledby="sample-dialog-heading" onClose={()=>setContact(null)}><div className="contact-dialog-heading"><div><h3 id="sample-dialog-heading">{contact==='package'?'Sample buyer package':'128 Sample Lane'}</h3><small>Fictional preview</small></div><button type="button" className="contact-dialog-close" aria-label="Close preview panel" onClick={()=>dialog.current?.close()}><X size={20}/></button></div>
   {contact==='package'?<div className="preview-dialog-body"><h4>128 Sample Lane</h4><p>Dallas, TX 75201 · 3 beds · 2 baths · 1,420 sq. ft.</p><p><strong>Buyer asking price: $100,000</strong></p><p>Buyer pays closing costs in addition. The property is available for a confirmed viewing.</p><p>Sample package only. No contact information or live agreement is included.</p></div>:<div className="property-conversations"><div className="workspace-section-heading"><div className="conversation-switch"><button type="button" aria-pressed={contact==='texts'} onClick={()=>setContact('texts')}><MessageCircle size={16}/>Texts</button><button type="button" aria-pressed={contact==='calls'} onClick={()=>setContact('calls')}><Phone size={16}/>Calls (1)</button></div></div><div className="preview-dialog-body">{contact==='texts'?<div className="message-history"><div className="message-bubble message-incoming"><span className="message-speaker">Seller · sample message</span><p>{contracted?'I signed the agreement. Thursday afternoon works for a viewing.':'I’d like to learn more about your offer.'}</p><small>October 14 · 10:15 AM</small></div><div className="message-bubble message-outgoing"><span className="message-speaker">Bot · sample message</span><p>{contracted?'Thank you. We’ll confirm a specific visit with you before anyone comes by.':'Thank you. What timeline would work best for you?'}</p><small>October 14 · 10:16 AM</small></div></div>:<><h4>Call history</h4><p><strong>Seller conversation · 3 min 12 sec</strong></p><p>October 14, 2026 · 9:45 AM Central</p><p>The seller discussed their timeline and the property’s condition.</p><details><summary>Read sample transcript</summary><p>Seller: I’m hoping to sell within the next month.</p><p>Bot: What repairs do you think the property needs?</p></details></>}</div></div>}
  </dialog>
 </div>;
}
