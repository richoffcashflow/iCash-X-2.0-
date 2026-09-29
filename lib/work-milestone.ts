/** Status comes from persisted evidence, never a timed animation or model claim. */
export function workMilestone(i:{stage?:string;needsHuman:boolean;needsSignature:boolean;purchaseSigned:boolean;assignmentSigned:boolean;eligible:boolean}){
 if(i.needsHuman||i.needsSignature)return '🙋 Needs you';
 if(i.stage==='canceled')return 'Deal canceled';
 if(i.stage==='closed')return '✅ Deal closed';
 if(i.stage==='closing')return '🏁 Closing in progress';
 if(i.stage==='title_open')return '📄 Title opened';
 if(i.assignmentSigned)return '🤝 Buyer agreement signed';
 if(i.purchaseSigned)return '📝 Under contract';
 return i.eligible?'🏠 Property found':'🔎 Property reviewed';
}

export function explainMilestone(status:string){
 switch(status){
 case '🙋 Needs you':return 'Your help is needed. Open the request below to see what to do.';
 case 'Deal canceled':return 'This deal was canceled. Review any remaining contract obligations before taking another step.';
 case '✅ Deal closed':return 'Closing is recorded. Check the closing statement for your fee and payment details.';
 case '🏁 Closing in progress':return 'The deal is in the closing stage. Funds and documents still need to be confirmed.';
 case '📄 Title opened':return 'The closing company has the file. Ownership, debts, and closing requirements need to be checked.';
 case '🤝 Buyer agreement signed':return 'A buyer signed the assignment agreement. Next comes deposit confirmation and closing coordination.';
 case '📝 Under contract':return 'The seller and buyer signed the purchase agreement. Next: match a cash buyer to the contract.';
 case '🏠 Property found':return 'The initial numbers may work. Next: confirm the owner’s interest, condition, and price. No contract is signed yet.';
 default:return 'The property was reviewed. Check the numbers below to see whether it is worth pursuing.';
 }
}
