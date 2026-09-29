export function DealExplainer({compact=false}:{compact?:boolean}){
 if(compact)return <div className="deal-steps-simple" aria-label="The four steps of a wholesale deal"><span><b>1</b> Find a seller</span><span><b>2</b> Agree on a price</span><span><b>3</b> Find a buyer</span><span><b>4</b> Complete closing</span></div>;
 return <section className="deal-explainer" aria-label="How a wholesale deal works"><ol>
 <li><b>1</b><div><strong>Find a seller</strong><span>Research properties. Contact eligible owners.</span></div></li>
 <li><b>2</b><div><strong>Agree on a deal</strong><span>Discuss a price. Get a purchase agreement signed.</span></div></li>
 <li><b>3</b><div><strong>Find a cash buyer</strong><span>Offer the signed contract to a buyer for a fee.</span></div></li>
 <li><b>4</b><div><strong>Close with title</strong><span>The closing company handles the transaction.</span></div></li>
 </ol><p>Your assignment fee is what you earn for transferring the contract to the buyer if the deal closes. Costs reduce what you keep.</p></section>;
}
