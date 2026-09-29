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
