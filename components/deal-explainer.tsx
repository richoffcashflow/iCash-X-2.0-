export function DealExplainer({compact=false}:{compact?:boolean}){
 if(compact)return <div className="deal-steps-simple" aria-label="The four steps of a wholesale deal"><span>1. Find a seller</span><span>2. Agree on a deal</span><span>3. Find a buyer</span><span>4. Close with title</span></div>;
 return <section className="deal-explainer" aria-label="How a wholesale deal works"><ol>
 <li><b>1</b><div><strong>Find a seller</strong><span>Research properties. Contact eligible owners.</span></div></li>
 <li><b>2</b><div><strong>Agree on a deal</strong><span>Discuss a price. Get a purchase agreement signed.</span></div></li>
 <li><b>3</b><div><strong>Find a cash buyer</strong><span>Offer the signed contract to a buyer for a fee.</span></div></li>
 <li><b>4</b><div><strong>Close with title</strong><span>The closing company handles the transaction.</span></div></li>
 </ol><p>Your assignment fee is what you earn for transferring the contract to the buyer if the deal closes. Costs reduce what you keep.</p></section>;
}
