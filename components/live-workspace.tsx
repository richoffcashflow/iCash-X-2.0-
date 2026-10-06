'use client';
import {Activity,useEffect,useRef,useState} from 'react';
import {Phone,MessageCircle,X} from 'lucide-react';
import {analysisMoney,propertyAnalysisView} from '@/lib/property-analysis-view';
import {mostPromisingProperty,propertyBotStatus,propertyNextMove} from '@/lib/workspace-guidance';
import {ManualCallOptions} from '@/components/manual-call-options';
import {PropertyAnalysisSummary} from '@/components/property-analysis-summary';
import {PropertyThumbnail} from '@/components/property-thumbnail';
import {showPropertyContract} from '@/lib/property-contract-visibility';
import {ContractReviewGuide} from '@/components/contract-review-guide';
import {BuyerQualificationPanel} from '@/components/buyer-qualification-panel';
import {fillEmptyTerms} from '@/lib/contract-preparation';
import {dealCardSummary} from '@/lib/deal-card-summary';
import {workMilestone} from '@/lib/work-milestone';
import {CallConversation} from '@/components/call-conversation';
import {PropertyMessages} from '@/components/property-messages';
import {FulfillmentDetails} from '@/components/fulfillment-details';
import {SigningControls,SigningAttention,type SigningEnvelope} from '@/components/signing-controls';
import {dealTermsSchema,type DealTerms,type DocumentKind} from '@/lib/deal-documents';
import {filterProperties,needsAttention,propertyAddressLines,propertyGroup,safeLocalTime,type WorkspaceFilter,type WorkspaceProperty} from './workspace-view';
type Property=WorkspaceProperty;
type Deal={id:string;screening_id:string;terms:DealTerms;stage:string};
type Handoff={address?:string|null;id:string;screening_id:string;party:string;reason:string;summary:string;next_action:string;state:string};
type Conversation={id:string;screening_id:string;party:string;summary?:string;completed_at?:string};
type TextAttention={address?:string|null;id:string;message_id:string;screening_id:string;deal_id:string;kind:string;party:string;quote:string;timezone:string};
type PurchasedLookup={screening_id:string;created_at?:string|null;fetchedAt?:string|null;source?:string;ownershipVerified?:false;outreachAuthorized?:false;contacts?:{name:string|null;phones:{number:string|null;type:string|null;doNotCall:boolean|null}[]}[]};
type Work={propertyAttentionIds?:string[];textAttention?:TextAttention[];callRequests?:{address?:string|null;id:string;screening_id:string;requested_at:string;state:string}[];signatureActions:{id:string;kind:string;test_mode:boolean;screening_id?:string|null;address?:string|null}[];signing:SigningEnvelope[];signingConfigured:boolean;handoffs:Handoff[];conversations:Conversation[];callbacks:{id:string;screening_id:string;due_at:string;timezone:string;state:string}[];properties:Property[];deals:Deal[];contacts:PurchasedLookup[];hasMore:boolean;controls:{property_id:string}[];attentionHasMore?:boolean;searchSupported?:boolean;retainedIds?:string[]};
function milestone(property:Property,work:Work){
 const deal=work.deals.find(d=>d.screening_id===property.id);
 const signatures=work.signing.filter(e=>e.deal_id===deal?.id&&!e.test_mode);
 return workMilestone({stage:deal?.stage,needsHuman:needsAttention(property.id,work),needsSignature:signatures.some(e=>e.state==='customer_signature_needed'),purchaseSigned:signatures.some(e=>e.kind==='purchase'&&e.state==='completed'),assignmentSigned:signatures.some(e=>e.kind==='assignment'&&e.state==='completed'),eligible:property.result.financialCheck.status==='eligible'});
}
function leaveDrafts(){return !document.querySelector('[data-unsaved-draft="true"]')||window.confirm('Leave this view? Unsent drafts and unsaved contract changes in this view will be lost.');}
async function post(path:string,data:unknown){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const out=await r.json();if(!r.ok)throw new Error(out.error||'Please retry.');return out;}
export function LiveWorkspace({principal,botPaused=false,botAvailable=false,accountStale=false,showCoach=true}:{principal:string;botPaused?:boolean;botAvailable?:boolean;accountStale?:boolean;showCoach?:boolean}){
 const [work,setWork]=useState<Work|null>(null),[error,setError]=useState(''),[page,setPage]=useState(0),[attentionPage,setAttentionPage]=useState(0),[activeId,setActiveId]=useState(''),[visited,setVisited]=useState<string[]>([]);
 const openPropertyId=useRef('');openPropertyId.current=activeId;
 const [filter,setFilter]=useState<WorkspaceFilter>('all'),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[focusedId,setFocusedId]=useState(''),[refresh,setRefresh]=useState(0),[loading,setLoading]=useState(true),[updated,setUpdated]=useState<Date|null>(null);
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(document.querySelector('[data-unsaved-draft="true"]'))event.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
 useEffect(()=>{const id=new URLSearchParams(window.location.search).get('screeningId');if(id&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)){setFocusedId(id);setActiveId(id);setVisited([id]);}},[]);
 useEffect(()=>{const timer=setTimeout(()=>{setSearch(query.trim());setPage(0);},300);return()=>clearTimeout(timer);},[query]);
 useEffect(()=>{let active=true,inFlight=false;const controller=new AbortController();async function load(){if(document.hidden||inFlight)return;inFlight=true;try{const params=new URLSearchParams({page:String(page),attentionPage:String(attentionPage),...(search?{query:search}:{}),...(focusedId?{screeningId:focusedId}:{})});const r=await fetch(`/api/work/activity?${params}`,{cache:'no-store',signal:controller.signal});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not refresh your work.');if(active){
 const heldIds=[...new Set([openPropertyId.current,...Array.from(document.querySelectorAll<HTMLElement>('.live-property')).filter(node=>node.querySelector('[data-unsaved-draft="true"]')).map(node=>node.id.replace('property-',''))])].filter(id=>id&&!d.properties.some((p:Property)=>p.id===id));
 if(heldIds.length){
  const held=await Promise.all(heldIds.slice(0,6).map(async id=>{const response=await fetch(`/api/work/activity?screeningId=${encodeURIComponent(id)}`,{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('Could not refresh an open property.');return response.json() as Promise<Work>;}));
  for(const extra of held)for(const key of ['properties','deals','signing','contacts','controls','conversations','callbacks'] as const)d[key].push(...extra[key]);
  d.propertyAttentionIds=[...(d.propertyAttentionIds??[]),...held.flatMap(item=>item.propertyAttentionIds??[])];d.retainedIds=heldIds;
 }
 if(active){setWork(d);setError('');setUpdated(new Date());}
}}catch(e){if(active)setError(`${e instanceof Error?e.message:'Could not refresh your work.'} The last loaded records and open drafts are still here.`);}finally{inFlight=false;if(active)setLoading(false);}}void load();const timer=setInterval(load,30000);document.addEventListener('visibilitychange',load);return()=>{active=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};},[page,attentionPage,search,focusedId,refresh]);
 useEffect(()=>{if(focusedId&&work?.properties.some(p=>p.id===focusedId))document.getElementById(`property-${focusedId}`)?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});},[focusedId,work?.properties[0]?.id]);
 const visible=work?filterProperties(work.properties,work,filter,work.searchSupported?'':search):[];
 const promisingId=work?mostPromisingProperty(visible,work):null;
 const coachProperty=work?.properties.find(p=>needsAttention(p.id,work))??work?.properties.find(p=>p.id===promisingId);
 function openProperty(id:string){if(!work?.properties.some(p=>p.id===id)&&!leaveDrafts())return;setFilter('all');setActiveId(id);setVisited(v=>v.includes(id)?v:[...v,id]);if(!work?.properties.some(p=>p.id===id)){setWork(null);setVisited([id]);setFocusedId(id);setQuery('');setSearch('');setLoading(true);}requestAnimationFrame(()=>document.getElementById(`property-${id}`)?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));}
 function changePage(next:number){if(!leaveDrafts())return;setPage(next);setWork(null);setActiveId('');setVisited([]);setLoading(true);}
 return <div className="live-work" id="workspace-properties">
  {showCoach&&work&&<section className="deal-coach" aria-label="Your next move"><span className="workspace-eyebrow">Your AI coach</span><h3>{coachProperty?needsAttention(coachProperty.id,work)?'One thing needs your attention.':'Start with your strongest prospect.':botPaused?'Your work is saved.':'Your next opportunity starts here.'}</h3><p>{coachProperty?propertyNextMove(coachProperty,work):botPaused?'Resume when you’re ready. Your property history and conversations stay here.':'Your bot’s saved research and conversations will appear below.'}</p>{coachProperty&&<button className="coach-action" onClick={()=>{if(needsAttention(coachProperty.id,work)){const queue=document.getElementById('workspace-attention') as HTMLDetailsElement|null;if(queue){queue.open=true;queue.scrollIntoView({block:'start'});return;}}openProperty(coachProperty.id);}}>{needsAttention(coachProperty.id,work)?'Review next step':'Open priority property'}</button>}</section>}
  <div className="workspace-section-heading"><h3>Your properties</h3></div>
  {error&&<div className="workspace-notice" role="alert"><p>{error}</p><button onClick={()=>{setLoading(true);setRefresh(v=>v+1);}}>Try again</button></div>}
  {!work&&loading&&<p className="workspace-empty" role="status">Loading your saved work…</p>}
  {work&&<WorkspaceAttention work={work} page={attentionPage} onPage={setAttentionPage} onOpen={openProperty} onRefresh={()=>setRefresh(v=>v+1)}/>}
  <section className="property-library" aria-labelledby="properties-heading">
   <div className="workspace-section-heading property-list-meta"><h4 className="sr-only" id="properties-heading">Properties</h4></div>
   <label className="workspace-search"><span className="sr-only">Search your properties</span><input type="search" placeholder="Street, city or ZIP code" value={query} maxLength={100} onChange={e=>{if(!leaveDrafts())return;setActiveId('');setVisited([]);setWork(null);setLoading(true);setQuery(e.target.value);setFocusedId('');}} /></label>
   {(filter!=='all'||work?.properties.some(p=>['attention','history'].includes(propertyGroup(p.id,work))))&&<div className="workspace-filters" aria-label="Filter properties on this page">{([['all','All'],['attention','Needs you'],['history','History']] as const).filter(([value])=>value==='all'||filter===value||work?.properties.some(p=>propertyGroup(p.id,work)===value)).map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}{work&&<span>{value==='all'?work.properties.length:work.properties.filter(p=>propertyGroup(p.id,work)===value).length}</span>}</button>)}</div>}
   {(page>0||work?.hasMore||filter!=='all')&&<p className="workspace-scope">Page {page+1} · {visible.length} shown · Filters apply to this page</p>}
   {focusedId&&<button className="workspace-quiet" onClick={()=>{if(!leaveDrafts())return;setFocusedId('');setActiveId('');setVisited([]);setWork(null);setLoading(true);}}>Back to all properties</button>}
   {work&&!visible.length&&<div className="workspace-empty"><strong>{query||filter!=='all'?'No matching properties in this view':'No properties to show yet'}</strong><p>{query||filter!=='all'?'Try another address or reset the filters. Your other saved work has not changed.':'Your properties will appear here.'}</p>{(query||filter!=='all')&&<button className="workspace-quiet" onClick={()=>{setQuery('');setFilter('all');}}>Clear filters</button>}</div>}
   <div className="property-list">{work&&work.properties.map(p=><PropertyCard hidden={!visible.some(v=>v.id===p.id)} key={p.id} photoRefresh={refresh} botPaused={botPaused} botAvailable={botAvailable} stale={accountStale||!!error} promising={p.id===promisingId} property={p} work={work} principal={principal} active={activeId===p.id} visited={visited.includes(p.id)} onToggle={open=>{if(open){setActiveId(p.id);setVisited(v=>v.includes(p.id)?v:[...v,p.id]);}else setActiveId(id=>id===p.id?'':id);}} onRefresh={()=>setRefresh(v=>v+1)}/>)}</div>
   {work&&!focusedId&&(page>0||work.hasMore)&&<nav className="live-pages" aria-label="Property pages"><button disabled={page===0} onClick={()=>changePage(page-1)}>Previous</button><span>Page {page+1}</span><button disabled={!work.hasMore} onClick={()=>changePage(page+1)}>Next properties</button></nav>}
  </section>
 </div>;
}
function PropertyCard({property:p,work,principal,active,visited,onToggle,onRefresh,hidden,photoRefresh=0,botPaused=false,botAvailable=false,stale=false,promising=false}:{botPaused?:boolean;botAvailable?:boolean;stale?:boolean;promising?:boolean;photoRefresh?:number;property:Property;work:Work;principal:string;hidden:boolean;active:boolean;visited:boolean;onToggle:(open:boolean)=>void;onRefresh:()=>void}){
 const initialManual=work.controls.some(c=>c.property_id===p.result.property.propertyId);
 const [manual,setManual]=useState(initialManual),[controlBusy,setControlBusy]=useState(false),[controlMessage,setControlMessage]=useState(''),[preparingContract,setPreparingContract]=useState(false),[contactView,setContactView]=useState<'texts'|'calls'|null>(null),[contactVisited,setContactVisited]=useState(false);
 const contactDialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=contactDialog.current;if(!dialog)return;if(contactView&&!hidden){if(!dialog.open)dialog.showModal();}else if(dialog.open)dialog.close();},[contactView,hidden]);
 useEffect(()=>setManual(initialManual),[initialManual]);
 const deal=work.deals.find(d=>d.screening_id===p.id),calls=work.conversations.filter(c=>c.screening_id===p.id);
 const lookups=work.contacts.filter(c=>c.screening_id===p.id);
 function openContact(view:'texts'|'calls'){setContactVisited(true);setContactView(view);}
 function tookOver(){setManual(true);setControlMessage('You’re handling this lead.');onRefresh();}
 const contractReady=showPropertyContract(deal,work.signing);
 useEffect(()=>{if(contractReady)setPreparingContract(true);},[contractReady]);
 const address=propertyAddressLines(p.result.property.address);
 const analysis=propertyAnalysisView(p.result);
 const dealSummary=dealCardSummary(deal,work.signing);
 const practice=p.result.property.propertyId.startsWith('practice_')||[true,'true'].includes((deal?.terms as (DealTerms&{practice?:boolean|string})|undefined)?.practice??false);
 const bot=propertyBotStatus({manual,paused:botPaused,available:botAvailable,stale,attention:needsAttention(p.id,work),stage:deal?.stage,practice});
 const phase=milestone(p,work).replace(/^[^A-Za-z]+/,'');
 const owner=lookups.flatMap(l=>l.contacts??[]).find(c=>c.name)?.name;
 const sellerSummary=calls.find(c=>c.party==='seller'&&c.summary)?.summary;
 async function control(){if(controlBusy)return;setControlBusy(true);setControlMessage('');try{await post('/api/work/control',{action:manual?'return_to_bot':'takeover',screeningId:p.id});setManual(!manual);setControlMessage(manual?'Bot control restored. Setup, credits and contact permissions still apply.':'You have control. New automatic work is paused for this property. Already-started work may finish.');onRefresh();}catch{setControlMessage('Could not confirm the control change. Refresh and check before continuing.');}finally{setControlBusy(false);}}
 return <article hidden={hidden} className="live-property" id={`property-${p.id}`} aria-labelledby={`property-address-${p.id}`} data-needs-attention={needsAttention(p.id,work)} data-expanded={active} data-promising={promising}>
  <div className="property-disclosure">
   <button type="button" className="property-summary" aria-expanded={active} aria-controls={`property-content-${p.id}`} onClick={()=>onToggle(!active)}>
    <PropertyThumbnail key={photoRefresh} screeningId={p.id} address={p.result.property.address} images={p.result.property.images}/>
    <span className="property-summary-main">
     <span className="property-address" id={`property-address-${p.id}`}><strong>{address.street}</strong>{address.location&&<span>{address.location}</span>}</span>
     {owner&&<span className="property-owner-name">{owner}</span>}
     <span className="property-summary-status">{(p.result.property.propertyId.startsWith('practice_')||[true,'true'].includes((deal?.terms as (DealTerms&{practice?:boolean|string})|undefined)?.practice??false))&&<span className="property-manual-label">Practice only · no real property</span>}<span className="property-status" hidden={phase===bot.label}>{phase}</span>{manual&&<span className="property-manual-label">Paused for this property</span>}</span>
     {calls.length>0&&<span className="property-recorded-meta">{calls.length} saved call{calls.length===1?'':'s'}</span>}
     <span className={`property-bot-status tone-${bot.tone}`}><span className="ai-status-dot" aria-hidden="true"/>{bot.label}</span>
    </span>
    <span className="property-cash-preview" aria-label={dealSummary?.priceCents!=null?'Purchase price':'Cash offer price'}><small>{dealSummary?.priceCents!=null?'Purchase price':'Cash offer price'}</small><strong>{analysisMoney(dealSummary?.priceCents??analysis.cashOfferCeilingCents)}</strong></span>
    <span className="property-open-control"><span>{active?'Close':'View details'}</span><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></span>
   </button>
   <div className="property-quick-actions"><button type="button" onClick={()=>openContact('calls')} aria-label={`Call ${address.street}`}><Phone size={16}/>Call</button><button type="button" onClick={()=>openContact('texts')} aria-label={`Text conversation for ${address.street}`}><MessageCircle size={16}/>Text</button></div>
   {visited&&<Activity mode={active&&!hidden?'visible':'hidden'}><div className="property-details" id={`property-content-${p.id}`}>
    {dealSummary?.contractSigned?<details className="contract-deal-estimates"><summary>Original deal estimates</summary><PropertyAnalysisSummary result={p.result}/></details>:<PropertyAnalysisSummary result={p.result}/>}
    <div className="property-control"><span><b className={`property-bot-status tone-${bot.tone}`}><span className="ai-status-dot" aria-hidden="true"/>{bot.label}</b><small>{bot.detail}</small></span><button className="takeover-button" title={manual?'Let the bot manage new work for this property':'Pause new automated work for this property and handle it yourself'} disabled={controlBusy} onClick={()=>void control()}>{controlBusy?'Saving…':manual?'Return to bot':'Take over'}</button></div>
    <small className="property-control-help">Take over pauses new work. Already-started work may finish.</small>
    {controlMessage&&<p className="control-result" role="status">{controlMessage}</p>}
    {sellerSummary&&<div className="seller-summary"><span className="workspace-eyebrow">Latest seller conversation</span><p>{sellerSummary}</p></div>}
    <PropertyNextStep property={p} work={work}/>
    <details className="property-owner-details"><summary>Home, owner & contact details</summary><PropertyFacts property={p} lookups={lookups}/></details>
    {work.handoffs.filter(h=>h.screening_id===p.id).map(h=><HandoffCard key={h.id} handoff={h}/>)}
    {work.callRequests?.filter(c=>c.screening_id===p.id).map(c=><CallRequest key={c.id} id={c.id}/>)}
    {work.callbacks.filter(c=>c.screening_id===p.id).map(c=><p key={c.id}>Requested callback: {safeLocalTime(c.due_at,c.timezone)} ({c.timezone}). {c.state==='held_for_human'?'Waiting for you.':c.state==='canceled'?'Canceled.':c.state==='missed'?'Time passed; needs review.':c.state==='dispatched'?'Call dispatched.':'Saved; automatic dialing is not confirmed.'}</p>)}
    <section className="property-resources" aria-label="Agreement tools">
    {manual&&!showPropertyContract(deal,work.signing)&&!preparingContract&&<button className="workspace-quiet" onClick={()=>setPreparingContract(true)}>Seller is ready for an agreement</button>}
    {(preparingContract||showPropertyContract(deal,work.signing))&&<DealTools signing={work.signing} signingConfigured={work.signingConfigured} property={p} principal={principal} initial={deal} manual={manual} onManual={()=>{setManual(true);onRefresh();}}/>}</section>
   </div></Activity>}
  </div>
  <dialog ref={contactDialog} className="property-contact-dialog" aria-labelledby={`contact-heading-${p.id}`} onClose={()=>setContactView(null)} onCancel={()=>setContactView(null)}>
   <div className="contact-dialog-heading"><div><span className="contact-dialog-kicker">CONVERSATIONS</span><h3 id={`contact-heading-${p.id}`}>{address.street}</h3><small>{owner?`${owner} · `:''}{address.location}</small></div><button className="contact-dialog-close" aria-label="Close conversation" onClick={()=>setContactView(null)}><X size={20}/></button></div>
   {contactVisited&&<Activity mode={contactView&&!hidden?'visible':'hidden'}>    <section className="property-conversations" id={`conversation-${p.id}`} aria-label="Property conversations"><div className="workspace-section-heading"><div className="conversation-switch"><button aria-pressed={contactView==='texts'} onClick={()=>setContactView('texts')}><MessageCircle size={16}/>Texts</button><button aria-pressed={contactView==='calls'} onClick={()=>setContactView('calls')}><Phone size={16}/>Calls{calls.length?` (${calls.length})`:''}</button></div><small>Saved to this property</small></div><div className="conversation-control"><span>{manual?'You’re handling this lead':'Bot manages this lead'}</span>{manual&&<button className="workspace-quiet" disabled={controlBusy} onClick={()=>void control()}>{controlBusy?'Saving…':'Return to bot'}</button>}</div>{controlMessage&&<p className="control-result" role="status">{controlMessage}</p>}
    <div className="contact-text-view" hidden={contactView!=='texts'}><PropertyMessages screeningId={p.id} active={contactView==='texts'&&!hidden} onTakeover={tookOver}/></div>
    {contactView==='calls'&&<div className="property-call-list"><ManualCallOptions screeningId={p.id} onTakeover={tookOver}/><h4 className="call-history-title">Call history</h4>{calls.length?calls.map(c=><CallConversation key={c.id} id={c.id} party={c.party} summary={c.summary} completedAt={c.completed_at}/>):<div className="conversation-empty"><Phone size={24}/><strong>No calls yet</strong><p>Saved bot calls, transcripts, and available recordings will appear here.</p></div>}</div>}
    </section>
</Activity>}
  </dialog>
 </article>;
}
function PropertyFacts({property:p,lookups}:{property:Property;lookups:PurchasedLookup[]}){
 const home=p.result.property,contacts=lookups.flatMap(l=>l.contacts??[]);
 const inboundLead=lookups.some(l=>l.source?.startsWith('HomeOffer')||l.source?.startsWith('Keypath'));
 const fact=(value:unknown,suffix='')=>typeof value==='number'&&Number.isFinite(value)&&value>=0?`${value.toLocaleString()}${suffix}`:'Not recorded';
 return <section className="property-facts" aria-label="Home and owner details">
  <dl className="home-facts"><div><dt>Beds</dt><dd>{fact(home.bedrooms)}</dd></div><div><dt>Baths</dt><dd>{fact(home.bathrooms)}</dd></div><div><dt>Square feet</dt><dd>{fact(home.livingAreaSqft)}</dd></div><div><dt>Built</dt><dd>{typeof home.yearBuilt==='number'?home.yearBuilt:'Not recorded'}</dd></div></dl>
  <div className="owner-facts"><h4>Owner & contact</h4>{contacts.length?<><small>Lookup matches · ownership not verified</small>{contacts.map((contact,i)=><div className="owner-contact" key={i}><strong>{contact.name||'Name not available'}</strong>{contact.phones.length?contact.phones.map((phone,j)=><div key={j}><span>{phone.number||'Phone not available'}</span><small>{phone.type??'Phone'} · {phone.doNotCall===true?'Do not contact':'Permission not verified'}</small></div>):<span>No phone number saved</span>}</div>)}</>:<p>Owner name and phone not available yet</p>}{lookups.length>0&&<details className="estimate-details"><summary>{inboundLead?'Contact source':'Contact source & date'}</summary>{lookups.map((l,i)=><p key={i}>{l.source?.startsWith('HomeOffer')||l.source?.startsWith('Keypath')?'HomeOffer Network · seller submission':<>Contact data · {l.fetchedAt?safeLocalTime(l.fetchedAt):l.created_at?safeLocalTime(l.created_at):'Lookup time unavailable'}. Source DNC flags are not legal clearance to call or text.</>}</p>)}</details>}</div>
 </section>;
}
function PropertyNextStep({property,work}:{property:Property;work:Work}){
 const deal=work.deals.find(d=>d.screening_id===property.id),summary=dealCardSummary(deal,work.signing);
 return <div className="property-next"><p><span>{summary?.contractSigned?summary.status:'Next step'}</span>{summary?.contractSigned?summary.nextAction:propertyNextMove(property,work)}</p>{summary?.contractSigned&&<><ol className="property-milestones" aria-label="Deal progress">{summary.steps.map(step=><li key={step.label} className={step.done?'complete':step.current?'current':''} aria-current={step.current?'step':undefined}><span aria-hidden="true">{step.done?'✓':'○'}</span>{step.label}<span className="sr-only">{step.done?' complete':step.current?' current':' upcoming'}</span></li>)}</ol>{deal?.terms.closingDate&&<small>Target closing · {deal.terms.closingDate}</small>}</>}</div>;
}
function WorkspaceAttention({work,page,onPage,onOpen,onRefresh}:{work:Work;page:number;onPage:(page:number)=>void;onOpen:(id:string)=>void;onRefresh:()=>void}){
 const [handled,setHandled]=useState<string[]>([]),[expanded,setExpanded]=useState(false);
 function done(id:string){setHandled(v=>[...v,id]);onPage(0);onRefresh();}
 const requests=[
  ...(work.textAttention??[]).map(a=>({id:'text:'+a.id+':'+a.message_id,propertyId:a.screening_id,address:a.address,priority:a.kind==='withdrawal'?0:a.kind==='human'?2:3,title:a.kind==='withdrawal'?'Review a change of plans':a.kind==='callback'?'Confirm a callback':'Review a message',node:<TextAttentionCard item={a} onHandled={()=>done('text:'+a.id+':'+a.message_id)}/>})),
  ...work.signatureActions.map(e=>({id:'sign:'+e.id,propertyId:e.screening_id??'',address:e.address,priority:1,title:'Review & sign an agreement',node:<SigningAttention envelope={e}/>})),
  ...work.handoffs.filter(h=>h.state==='open').map(h=>({id:'human:'+h.id,propertyId:h.screening_id,address:h.address,priority:2,title:'A person was requested',node:<HandoffCard handoff={h} onHandled={()=>done('human:'+h.id)}/>})),
  ...(work.callRequests??[]).filter(c=>c.state==='needs_review'&&!work.textAttention?.some(a=>a.screening_id===c.screening_id&&a.kind==='callback')).map(c=>({id:'call:'+c.id,propertyId:c.screening_id,address:c.address,priority:3,title:'Confirm a callback',node:<CallRequest id={c.id} onHandled={()=>done('call:'+c.id)}/>}))
 ].filter(r=>!handled.includes(r.id)).sort((a,b)=>a.priority-b.priority);
 if(!requests.length&&page===0&&!work.attentionHasMore)return null;
 return <details className="workspace-attention" id="workspace-attention" aria-labelledby="attention-title"><summary className="attention-heading"><div><h4 id="attention-title">Needs you</h4><p>{requests.length?`${requests.length} request${requests.length===1?'':'s'} shown${work.attentionHasMore?' · More available':''}`:'No open requests on this page'}</p></div><span className="attention-count" aria-hidden="true">{requests.length}</span></summary>
 {requests.length>0&&<div className="attention-list">{requests.slice(0,expanded?requests.length:3).map((r,index)=><details className="attention-item" key={r.id} open={index===0}><summary><strong>{r.title}</strong><span className="attention-address">{r.address??work.properties.find(p=>p.id===r.propertyId)?.result.property.address??(r.propertyId?'Property conversation':'Contract request')}</span></summary>{r.node}{r.propertyId&&<button className="attention-open" onClick={()=>onOpen(r.propertyId)}>Open property & conversations</button>}</details>)}</div>}
 {requests.length>3&&<button className="attention-more" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?'Show fewer requests':`Show ${requests.length-3} more on this page`}</button>}
 {(page>0||work.attentionHasMore)&&<nav className="live-pages" aria-label="Request pages"><button disabled={page===0} onClick={()=>{setExpanded(false);onPage(page-1);}}>Previous requests</button><span>Page {page+1}</span><button disabled={!work.attentionHasMore} onClick={()=>{setExpanded(false);onPage(page+1);}}>More requests</button></nav>}
 {requests.length>0&&<small>Marking a request seen does not restart the bot.</small>}</details>;
}
function TextAttentionCard({item,onHandled}:{item:TextAttention;onHandled:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const copy:Record<string,{title:string;next:string}>={
 withdrawal:{title:`${item.party==='buyer'?'Buyer':'Seller'} may be backing out`,next:'Check the signed agreement and closing deadline. Contact your closer before finding a replacement buyer. No contract or deposit has been changed.'},
 human:{title:'A person was requested',next:'Open the property messages and take over the conversation. Automatic work on this property is paused.'},
 callback:{title:'A callback was requested',next:`Confirm the date, time and timezone in messages. The thread timezone is ${item.timezone}; an appointment is not booked yet.`},
 campaign_reply:{title:'Seller reply needs review',next:'Review this SMS reply and decide the next permitted step. Check the conversation for the latest delivery and contact status. This message does not establish ownership or authorize an offer.'},
 declined:{title:'Outreach paused',next:'They declined or reported a wrong number. Review the message before doing any further work on this property.'}
 };
 const view=copy[item.kind]??{title:'Message needs review',next:'Open the property messages.'};
 return <article><strong>{view.title}</strong><blockquote className="reply-quote">{item.quote}</blockquote><p>{view.next}</p><button disabled={busy} onClick={async()=>{setBusy(true);try{await post('/api/work/text-attention',{id:item.id,messageId:item.message_id});onHandled();}catch(e){setError(e instanceof Error?e.message:'Could not save. Please refresh.');setBusy(false);}}}>I’ll handle this</button><small>{item.kind==='campaign_reply'?'Marking this seen does not send a message or change work controls.':'Marking this seen keeps automatic work paused.'}</small>{error&&<p role="alert">{error}</p>}</article>;
}
function DealTools({property,principal,initial,manual,onManual,signing,signingConfigured}:{property:Property;principal:string;initial?:Deal;manual:boolean;onManual:()=>void;signing:SigningEnvelope[];signingConfigured:boolean}){
 const [terms,setTerms]=useState<DealTerms>(()=>initial?.terms??dealTermsSchema.parse({address:property.result.property.address,buyer:principal,legalDescription:property.result.property.legalDescription??''}));
 const [dealId,setDealId]=useState(initial?.id??''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false);
 const edited=useRef(false);
 useEffect(()=>{if(initial?.terms&&!edited.current)setTerms(initial.terms);},[initial?.terms]);
 useEffect(()=>{if(initial?.id)setDealId(initial.id);},[initial?.id]);
 const [termEvidence,setTermEvidence]=useState<{field:string;quote:string}[]>([]);
 async function prepare(){setBusy(true);setMessage('');try{const r=await fetch(`/api/work/preparation?screeningId=${property.id}`,{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error);edited.current=true;setDirty(true);setTerms(t=>fillEmptyTerms(t,d.patch));setTermEvidence(d.evidence);setMessage(d.conflicts.length?'Different terms were mentioned. Confirm them before signing.':d.evidence.length?'Saved conversation details filled in. Review names, price and all owners before signing.':'No clear terms to fill yet. Existing entries are unchanged.');}catch(e){setMessage(e instanceof Error?e.message:'Could not prepare terms.');}finally{setBusy(false);}}
 const update=(key:keyof DealTerms,value:string|number|null)=>{edited.current=true;setDirty(true);setTerms(t=>({...t,[key]:value}));};
 async function save(){const d=await post('/api/work/deals',{screeningId:property.id,terms});setDealId(d.id);setTerms(d.terms);edited.current=false;setDirty(false);return d.id as string;}
 async function document(kind:DocumentKind){setBusy(true);setMessage('');try{const id=!initial||['draft','under_contract','title_open','closing'].includes(initial.stage)?await save():initial.id;const d=await post('/api/work/documents',{dealId:id,kind});const url=URL.createObjectURL(new Blob([d.html],{type:'text/html'}));const a=window.document.createElement('a');a.href=url;a.download=d.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('Unsigned draft downloaded. Review the terms and required state addenda before signing.');}catch(e){setMessage(e instanceof Error?e.message:'Please retry.');}finally{setBusy(false);}}
 async function handleMyself(){setBusy(true);setMessage('');try{await post('/api/work/control',{action:'takeover',screeningId:property.id});onManual();for(const e of signing.filter(e=>e.deal_id===dealId&&!['completed','test_completed'].includes(e.state))){await post('/api/work/signing',{action:'revoke_auto',id:e.id});}setMessage('You have control. Property automation is paused and pending auto-sign authorizations are off. Already-started work may finish. Existing contracts are unchanged.');}catch{setMessage('Could not confirm every control. Check pending auto-sign authorizations below before continuing.');}finally{setBusy(false);}}
 const amount=(key:'priceCents'|'assignmentFeeCents'|'earnestCents'|'assignmentDepositCents',label:string,help?:string)=><label>{label}<input inputMode="decimal" type="number" min="0" step="0.01" value={terms[key]===null?'':terms[key]!/100} onChange={e=>update(key,e.target.value===''?null:Math.round(Number(e.target.value)*100))}/>{help&&<small>{help}</small>}</label>;
 return <div className="deal-tools" data-unsaved-draft={dirty?'true':undefined}><details className="deal-contract-tools"><summary>Review contracts & documents</summary><ContractReviewGuide terms={terms} stage={initial?.stage??'draft'} manual={manual} busy={busy} onManual={()=>void handleMyself()} onDraft={()=>void document(initial&&initial.stage!=='draft'?'assignment':'purchase')}/><button disabled={busy} onClick={()=>void prepare()}>Fill from saved conversations</button>{termEvidence.length>0&&<details><summary>Where these details came from</summary>{termEvidence.map((e,i)=><blockquote className="reply-quote" key={i}>{e.quote}</blockquote>)}<small>Statements are for draft preparation. They do not verify ownership or authorize signing.</small></details>}<p><strong>Contract name:</strong> {principal||'Add your company or full name in Account details.'}</p><div className="deal-fields"><label>Seller’s full legal name(s)<input value={terms.seller} onChange={e=>update('seller',e.target.value)}/></label>{amount('priceCents','Purchase price ($)')}</div><details><summary>Contract terms</summary><div className="deal-fields"><label>Price status<select value={terms.priceSource} onChange={e=>update('priceSource',e.target.value)}><option value="proposed">Proposed—not yet agreed</option><option value="seller_reported">Seller agreed, reported by me</option></select></label><label>State (e.g. TX)<input maxLength={2} value={terms.state} onChange={e=>update('state',e.target.value.toUpperCase())}/></label><label>Agreed special terms / tenants / access<textarea value={terms.dealNotes} onChange={e=>update('dealNotes',e.target.value)}/></label><label>Legal description<textarea value={terms.legalDescription} onChange={e=>update('legalDescription',e.target.value)}/></label><label>Inspection days (proposed)<input type="number" min="0" max="90" value={terms.inspectionDays} onChange={e=>update('inspectionDays',Number(e.target.value))}/></label><label>Contract effective date<input type="date" value={terms.effectiveDate} onChange={e=>update('effectiveDate',e.target.value)}/><small>For the purchase agreement, leaving this blank uses the date of the last required signature.</small></label><label>Closing date<input type="date" value={terms.closingDate} onChange={e=>update('closingDate',e.target.value)}/><small>Leave blank to keep the draft’s proposed closing within 30 calendar days after the effective date, subject to agreement.</small></label>{amount('earnestCents','Seller-contract earnest money ($)','Enter the agreed amount. Blank means missing; enter 0 only if no earnest money is intended.')}<label>Cash buyer’s legal name<input value={terms.assignee} onChange={e=>update('assignee',e.target.value)}/></label>{amount('assignmentFeeCents','Assignment fee ($)')}{amount('assignmentDepositCents','Buyer deposit ($)')}<label>Title / escrow company<input value={terms.escrowAgent} onChange={e=>update('escrowAgent',e.target.value)}/><small>Required when earnest money is payable, and for an assignment agreement. Use the agreed title or escrow company.</small></label><label>Title email<input type="email" value={terms.titleEmail} onChange={e=>update('titleEmail',e.target.value)}/></label><label>Preferred proceeds method<select value={terms.payoutMethod} onChange={e=>update('payoutMethod',e.target.value)}><option value="wire">Wire transfer</option><option value="ach">ACH</option><option value="check">Check</option><option value="zelle">Zelle, if closing agent supports it</option><option value="cash_app">Cash App, if closing agent supports it</option></select></label></div><small>Buyer-paid closing charges are included, with required exceptions. Deposit release follows the signed agreement and escrow instructions. Never enter bank details here.</small></details>
 <div className="deal-actions">{(['purchase','assignment','buyer_package','title_packet'] as DocumentKind[]).map((kind,i)=><button key={kind} disabled={busy||!principal} onClick={()=>void document(kind)}>{['Purchase draft','Assignment draft','Buyer package','Title request'][i]}</button>)}</div><small>Documents are unsigned drafts. Required addenda may add pages. Nothing is sent automatically.</small>
 <SigningControls dealId={dealId} save={save} envelopes={signing.filter(e=>e.deal_id===dealId)} configured={signingConfigured} reviewVersion={JSON.stringify(terms)} stage={initial?.stage??'draft'}/></details>{dealId&&signing.some(e=>e.deal_id===dealId&&e.kind==='purchase'&&e.state==='completed'&&!e.test_mode)&&<BuyerQualificationPanel dealId={dealId}/>} {initial&&initial.stage!=='draft'&&<FulfillmentDetails dealId={initial.id}/>}{message&&<p role="status">{message}</p>}</div>;
}

function HandoffCard({handoff:h,onHandled}:{handoff:Handoff;onHandled?:()=>void}){
 const [state,setState]=useState(h.state),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <article className="handoff-card"><strong>{h.party==='buyer'?'Buyer':'Seller'} needs a person</strong><p>{h.reason}</p><details><summary>See summary & next step</summary><p>{h.summary}</p><p>{h.next_action}</p><small>Automation is paused for this property. Return control from the property only when you are ready.</small></details>{state==='open'&&<button disabled={busy} onClick={async()=>{setBusy(true);try{await post('/api/work/handoffs',{id:h.id});setState('acknowledged');onHandled?.();}catch{setError('Could not save. Please retry.');}finally{setBusy(false);}}}>I’ll handle this</button>}{state==='acknowledged'&&<small>You’re handling this. Bot stays paused.</small>}{error&&<p role="alert">{error}</p>}</article>;
}

function CallRequest({id,onHandled}:{id:string;onHandled?:()=>void}){
 const [done,setDone]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 if(done)return <p>Call request marked handled.</p>;
 return <div><p>☎️ Seller asked for a call. Time needs confirmation; no call is booked.</p><button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await post('/api/work/call-requests',{id});setDone(true);onHandled?.();}catch{setError('Could not save. Please retry.');}finally{setBusy(false);}}}>I’ve handled this</button>{error&&<p role="alert">{error}</p>}</div>;
}
