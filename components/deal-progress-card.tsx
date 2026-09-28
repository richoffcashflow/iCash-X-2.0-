"use client";
import { DEMO_PROPERTY } from "@/lib/demo-property";
import { PropertyMedia } from "./property-media";
import { SellerEvidence } from "./seller-evidence";
import { House, Check } from "lucide-react";
import { dealProgress, type DealSnapshot } from "@/lib/deal-operations";
export function DealProgressCard({snapshot,onInspect}:{snapshot:DealSnapshot;onInspect:()=>void}) {
  const view=dealProgress(snapshot,Date.now());
  const stages=[{label:"Seller signed",done:snapshot.sellerSigned},{label:"Buyer signed",done:snapshot.buyerSigned},{label:"Deposit confirmed",done:snapshot.depositConfirmedByEscrow},{label:"Closing scheduled",done:snapshot.closingScheduled},{label:"Closed",done:snapshot.closedByTitle}];
  return <section className="pinned-deal" aria-label="Sample deal through closing"><div className="pinned-deal-heading"><House size={20}/><div><strong>{DEMO_PROPERTY.address}</strong><span>{DEMO_PROPERTY.location}</span><span>{view.history ? "Sample closing complete" : "Under contract · sale not yet closed"}</span></div><span className="mode-badge">DEMO</span></div>
    <PropertyMedia photo={DEMO_PROPERTY.photo}/>
    {view.attention && <div className="deal-attention"><strong>Needs you</strong><p>{view.attention}</p></div>}
    <p className="deal-next"><span>NEXT</span>{view.next}</p>
    <details onToggle={event=>{if(event.currentTarget.open)onInspect();}}><summary>Closing checklist & numbers</summary><ol className="deal-stages">{stages.map(stage=><li key={stage.label} aria-label={`${stage.label}: ${stage.done ? "complete" : "pending"}`} className={stage.done?"done":""}><span>{stage.done?<Check size={11}/>:null}</span>{stage.label}</li>)}</ol><div className="deal-detail-body"><p>Illustrative sample only. No real buyer or title file.</p><dl><div><dt>Purchase price</dt><dd>$115,000 · sample</dd></div><div><dt>Buyer price</dt><dd>{snapshot.buyerSigned ? "$135,000 · sample" : "Not committed yet"}</dd></div><div><dt>Backup buyers</dt><dd>2 sample matches</dd></div><div><dt>Buyer funding & authority</dt><dd>{snapshot.buyerSigned ? "Assumed checked in demo" : "Needs verification"}</dd></div><div><dt>Escrow deposit</dt><dd>{snapshot.depositConfirmedByEscrow ? "Confirmed in sample" : "Not confirmed"}</dd></div><div><dt>Title file</dt><dd>{snapshot.titleOpened ? "Open in sample" : "Not opened yet"}</dd></div><div><dt>Next deadline</dt><dd>{snapshot.closedByTitle ? "Sample complete" : "No real deadline set"}</dd></div><div><dt>Payment received</dt><dd>{snapshot.proceedsConfirmed ? "Confirmed by closing record" : "None · demo only"}</dd></div></dl><p>Buyer interest alone does not secure a deal. Signed terms and confirmed funds are tracked separately.</p></div></details>
    <SellerEvidence available callbackBooked onInspect={onInspect}/>
  </section>;
}
