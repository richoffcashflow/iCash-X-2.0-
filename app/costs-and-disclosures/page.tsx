import Image from "next/image";
import Link from "next/link";

export const metadata = { title: "Costs & disclosures | iCash X", description: "Understand iCash X credits, spending controls, and the risks of real estate wholesaling." };

export default function CostsAndDisclosures() {
  return <main className="legal-page">
    <nav className="legal-nav"><Link href="/" aria-label="iCash X home"><Image src="/icash-x-logo.png" alt="iCash X" width={116} height={65} /></Link><Link href="/">← Back to app</Link></nav>
    <div className="legal-content"><span className="eyebrow"><span className="eyebrow-line" /> CLEAR BEFORE YOU FUND</span><h1>Costs &<br /><em>disclosures.</em></h1><p className="legal-intro">This is an early access explanation. Purchases and outbound work are off in the preview. The final checkout will show the actual rates and terms before you pay.</p>
      <section><h2>What you pay</h2><p>Free access lets you explore iCash X. Proposed initial credit packs are $100, $250, $500, and $1,000 or more, with a smaller $20 replenishment option under consideration. Credits fund eligible property research, contact attempts, conversations, and follow-up. Each operation will show its iCash X credit charge in your usage history. Vendor costs are paid by iCash X and may differ from that charge.</p><p>Exact per-operation charges and any starter allowance are still being calculated. They will be displayed before purchases are enabled. Credits are not an investment or a promise of a deal.</p></section>
      <section><h2>How spending stays in control</h2><p>You set a daily limit before work begins. iCash X also paces spending and keeps capacity for active seller and closing work. You can pause work. Auto-reload is off unless you explicitly turn it on, choose its threshold and amount, and authorize the payment method. The app will show charges, usage, and remaining balance.</p></section>
      <section><h2>Deal and income risks</h2><p>Finding a property, getting a seller response, signing a contract, finding a buyer, closing, and receiving proceeds are separate outcomes. None is guaranteed. Offers, property values, repair estimates, title issues, buyer financing, and closing dates may change. Check documents and material facts independently before making a commitment.</p></section>
      <section><h2>AI and outreach</h2><p>iCash X contacts owners as a prospective buyer of property; it is not selling them a product. AI can misunderstand a seller, property, or legal term. Buying property does not itself exempt AI voice calls from rules for artificial or prerecorded voices. Outbound calls and messages will only be enabled where the applicable consent or exemption, suppression, calling time, identification, and recording rules have been reviewed and enforced. A request not to be contacted must stop further outreach.</p></section>
      <section><h2>Contracts and local rules</h2><p>Real estate licensing, assignment, equitable-interest disclosures, contract forms, advertising, and closing rules vary by state and transaction. The app must use the approved rules for the property’s location. For example, Texas has written disclosure requirements for certain equitable-interest transactions. A qualified local attorney should review the final forms and outreach process before live launch.</p></section>
      <div className="legal-draft">Draft for product and legal review · Updated September 27, 2026</div>
    </div>
  </main>;
}
