'use client';
import {webinarRequest as workspaceRequest} from '@/lib/webinar-client';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {BuyerOverview,type BuyerNetworkProgress,type BuyerSelection} from './buyer-overview';
import {ClosingSetup} from './closing-setup';
import type {ClosingSetupView} from '@/lib/closing-setup';
import {ClosingProgress} from './closing-progress';
import type {ProceedsReceipt} from '@/lib/deal-completion';
import type {ClosingUpdate} from '@/lib/closing-progress';
import {TitleTasks,type TitleTask} from './title-tasks';
import {revealWorkspaceSection} from '@/lib/workspace-navigation';
import {WorkspacePanel} from './workspace-panel';
import {BuyerResponseDetails} from './buyer-response-details';
import {BuyerQualificationPanel} from './buyer-qualification-panel';
import {PropertyDebtSummary} from './property-debt-summary';
import {WorkspaceLoadStatus} from './workspace-load-status';
import {TitleCompanyMessages} from './title-company-messages';
import {recordWorkspaceExperience,type WorkspaceExperienceStage} from '@/lib/workspace-experience-client';
type Progress={proceedsReceipt?:ProceedsReceipt|null;dealStage?:string;buyerPricingReview?:string|null;buyerOutreachHeld?:boolean;closingSetup?:ClosingSetupView;buyerPackage?:{url:string;askingPriceCents:number;purchasePriceCents:number;assignmentFeeCents:number}|null;closingUpdates?:ClosingUpdate[];titleTasks?:TitleTask[];titleReplies?:{id:string;sender:string;subject:string;body_text:string;received_at:string;needs_review:boolean}[];title?:string|null;titleReady?:boolean;candidates?:{id:string;name:string}[];job?:{state:string;updated_at:string;result?:{buyerStatus:string;buyerCount:number;buyerDiscovery?:{status:string;canContinue:boolean};buyerTexts?:{status:string;accepted:number;held?:number};buyerEmail?:{status:string;accepted:number}}};documents:{id:string;kind:string}[];buyers:{buyer_id:string;name:string;rank:number;ready:boolean}[]};
type FulfillmentProgress=Progress&{buyerNetwork?:BuyerNetworkProgress|null};
export function FulfillmentDetails({dealId,buyerReviewAvailable=false,coordination,propertyResult}:{dealId:string;buyerReviewAvailable?:boolean;coordination?:ReactNode;propertyResult?:unknown}){
 const [refresh,setRefresh]=useState(0),[selected,setSelected]=useState<BuyerSelection|null>(null);
 const [data,setData]=useState<FulfillmentProgress|null>(null),[error,setError]=useState(''),[sending,setSending]=useState(false),[titleMessage,setTitleMessage]=useState('');
 const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState(false),[updatedAt,setUpdatedAt]=useState<string|null>(null);
 const panelStage=useRef<WorkspaceExperienceStage>('buyers');
 const retry=useCallback(()=>{recordWorkspaceExperience({event:'panel_retry',stage:panelStage.current});setRefresh(value=>value+1);},[]);
 const refreshBuyerOnOpen=useCallback((open:boolean)=>{if(open){panelStage.current='buyer_details';setRefresh(value=>value+1);}},[]);
 const refreshClosingOnOpen=useCallback((open:boolean)=>{if(open){panelStage.current='closing';setRefresh(value=>value+1);}},[]);
 useEffect(()=>{const abort=new AbortController();let inFlight=false;
 async function load(){if(document.hidden||inFlight)return;inFlight=true;setLoading(true);try{const next=await workspaceRequest<FulfillmentProgress>(`/api/work/fulfillment?dealId=${dealId}`,{signal:abort.signal,cache:'no-store'});if(!abort.signal.aborted){setData(next);setSelected(current=>{if(!current)return null;if(current.kind==='response'){const buyer=next.buyerNetwork?.buyers?.find(buyer=>buyer.id===current.buyer.id);return buyer?{kind:'response',buyer}:null;}const buyer=next.buyers.find(buyer=>buyer.buyer_id===current.buyer.buyer_id);return buyer?{kind:'match',buyer}:null;});setLoadError(false);setUpdatedAt(new Date().toISOString());}}catch{if(!abort.signal.aborted){setLoadError(true);recordWorkspaceExperience({event:'panel_error',stage:panelStage.current});}}finally{inFlight=false;if(!abort.signal.aborted)setLoading(false);}}
 void load();const timer=setInterval(load,30000);document.addEventListener('visibilitychange',load);return()=>{abort.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};},[dealId,refresh]);
 async function download(doc:Progress['documents'][number]){try{const file=await workspaceRequest<{html:string;filename:string}>(`/api/work/documents?id=${doc.id}`,{cache:'no-store'});const url=URL.createObjectURL(new Blob([file.html],{type:'text/html'}));const a=document.createElement('a');a.href=url;a.download=file.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{setError('Could not open the document. Please retry.');}}

 function openBuyer(buyer:BuyerSelection|null){setSelected(buyer);revealWorkspaceSection(document.getElementById(`buyer-details-${dealId}`));}
 function openPanel(id:string){revealWorkspaceSection(document.getElementById(`${id}-${dealId}`));}
 const closing=['title_open','closing','closed'].includes(data?.dealStage??'');
 const count=(data?.buyers.length??0)+(data?.buyerNetwork?.buyers?.length??0);
 const loadStatus=(label:'buyer'|'closing'|'deal')=><WorkspaceLoadStatus label={label} loading={loading} error={loadError} hasData={!!data} updatedAt={updatedAt} onRetry={retry}/>;
 return <section className="buyer-workspace" aria-label="Buyers">
  {error&&<p role="alert">{error} <button type="button" onClick={()=>setRefresh(v=>v+1)}>Try again</button></p>}
  {(loadError||!data)&&loadStatus('deal')}
  {data&&!closing&&<>
   <BuyerOverview buyers={data.buyers} network={data.buyerNetwork} buyerPackage={data.buyerPackage} pricingReview={data.buyerPricingReview} held={data.buyerOutreachHeld} researchContinuing={data.job?.result?.buyerDiscovery?.canContinue} onBuyer={openBuyer} onAllBuyers={count>3?()=>openBuyer(null):undefined}/>
   {!data.buyerPackage&&data.documents.filter(doc=>doc.kind==='buyer_package').map(doc=><button key={doc.id} type="button" onClick={()=>void download(doc)}>View prepared buyer package</button>)}
   {!!data.job?.result?.buyerTexts?.held&&<p>Some buyer texts are waiting for current contact eligibility or the calling window.</p>}
  </>}
  <WorkspacePanel id={`buyer-details-${dealId}`} title={selected?.buyer.name??'Buyers'} section="fulfillment" onOpenChange={refreshBuyerOnOpen}>
   {loadStatus('buyer')}
   {data&&<>
    {selected?<>
     <p>{selected.kind==='response'?(selected.buyer.state==='interested'?'Interested buyer':'Buyer reply'):(selected.buyer.ready?'Funds & signing authority verified at last check.':'Funds & signing authority need review.')}</p>
     {selected.kind==='response'&&<><blockquote className="reply-quote">{selected.buyer.reply??'This buyer marked the property as interesting.'}</blockquote><BuyerResponseDetails key={selected.buyer.id} dealId={dealId} matchId={selected.buyer.id} onHandled={()=>setRefresh(v=>v+1)}/><p>Interest does not reserve the property. Funds and signing authority still need review.</p></>}
     {count>1&&<button type="button" className="workspace-quiet" onClick={()=>setSelected(null)}>All buyers</button>}
    </>:<BuyerOverview buyers={data.buyers} network={data.buyerNetwork} buyerPackage={data.buyerPackage} onBuyer={setSelected} showAll/>}
    <div className="panel-shortcuts">{buyerReviewAvailable&&<button type="button" className="workspace-quiet" onClick={()=>openPanel('buyer-review')}>Review buyer funds</button>}{coordination&&<button type="button" className="workspace-quiet" onClick={()=>openPanel('buyer-visits')}>Viewing times & deposit</button>}</div>
    {!selected&&!!data.candidates?.length&&<details><summary>Other buyers being researched ({data.candidates.length})</summary><p>These buyers have not confirmed interest, funds or contact permission.</p><ul>{data.candidates.map(c=><li key={c.id}>{c.name}</li>)}</ul></details>}
   </>}
  </WorkspacePanel>
  {buyerReviewAvailable&&<WorkspacePanel id={`buyer-review-${dealId}`} title="Buyer funds & signing authority"><BuyerQualificationPanel dealId={dealId} embedded/></WorkspacePanel>}
  {coordination&&<WorkspacePanel id={`buyer-visits-${dealId}`} title="Visits & buyer deposit" section="coordination">{coordination}</WorkspacePanel>}
  <WorkspacePanel title="Closing" section="closing" onOpenChange={refreshClosingOnOpen}>
  {loadStatus('closing')}
  {error&&<p role="alert">{error}</p>}
  {data&&<>
   <TitleCompanyMessages replies={data.titleReplies??[]}/>
   <fieldset className="workspace-confirmed-controls" disabled={loadError||loading}>
   <legend className="sr-only">Closing actions</legend>
   {data.titleTasks?.some(t=>t.state==='needs_review')&&<div className="closing-owner-task"><strong>Closing tasks need your review</strong><p>Confirm requested dates and review any title delivery issues.</p><button type="button" className="demo-button" onClick={()=>revealWorkspaceSection(document.getElementById(`closing-tasks-${dealId}`)?.querySelector('details')??null)}>Review closing tasks</button></div>}
   {data.closingSetup&&!['closed','canceled','cancelled','cancellation_pending'].includes(data.dealStage??'')&&<ClosingSetup dealId={dealId} view={data.closingSetup} onSaved={()=>setRefresh(v=>v+1)}/>}
 {data.title==='sent'?<p>Closing file requested. Waiting for the closing office’s confirmation.</p>:data.titleReady&&(!data.title||data.title==='ready')?<button disabled={sending} onClick={async()=>{setSending(true);try{const d=await workspaceRequest<{status:string}>('/api/work/title',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dealId,confirmed:true})},45000);setTitleMessage(d.status==='title_request_sent'?'Title request sent. Awaiting confirmation.':'Request held for review.');}catch(e){setTitleMessage(e instanceof Error?e.message:'Request needs review.');}finally{setSending(false);setRefresh(v=>v+1);}}}>{sending?'Sending…':'Send signed agreement to verified title contact'}</button>:data.title&&<p>Title request needs review.</p>}
 {data.closingSetup?.verifiedContact&&!data.titleReady&&!data.title&&<p>Title delivery needs setup. Open Help so the saved contact can receive the signed documents.</p>}
 <ClosingProgress receipt={data.proceedsReceipt??null} dealId={dealId} updates={data.closingUpdates??[]} replies={data.titleReplies??[]} onSaved={()=>setRefresh(v=>v+1)}/>
 {data.titleTasks&&<div id={`closing-tasks-${dealId}`}><TitleTasks key={dealId+data.titleTasks.map(t=>`${t.id}:${t.state}:${t.email_state}`).join(',')} initialTasks={data.titleTasks} onChanged={()=>setRefresh(v=>v+1)}/></div>}
   </fieldset>
   {!!propertyResult&&!['closed','cancelled','canceled'].includes(data.dealStage??'')&&<PropertyDebtSummary result={propertyResult} closing/>}

   {data.documents.filter(doc=>doc.kind!=='buyer_package').map(doc=><button key={doc.id} type="button" onClick={()=>void download(doc)}>View title request</button>)}
   <details className="closing-roles"><summary>Who handles what?</summary><dl><div><dt>You</dt><dd>Review and sign agreements, confirm property visits, choose a closing office and verify received deposits.</dd></div><div><dt>iCash X</dt><dd>Prepares buyer documents, records replies and coordinates eligible follow-ups when the bot is running.</dd></div><div><dt>Title company / closing office</dt><dd>Checks who owns the property and handles the final paperwork and payments.</dd></div></dl></details>
   {data.documents.length>0&&<small>Downloaded packages are drafts. Closing and deposit status require confirmation from the closing office.</small>}
  </>}
  {titleMessage&&<p role="status">{titleMessage}</p>}
  </WorkspacePanel>
 </section>;
}
