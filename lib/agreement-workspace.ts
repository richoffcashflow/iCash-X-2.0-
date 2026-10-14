type Envelope = {id:string;kind:string;state:string;test_mode:boolean};

/** Display saved signing evidence. Drafts and test signatures never advance a deal. */
export function agreementWorkspace(stage:string,envelopes:Envelope[]){
 const live=envelopes.filter(e=>!e.test_mode);
 const purchaseSigned=live.some(e=>e.kind==='purchase'&&e.state==='completed');
 const stopped=['cancellation_pending','canceled','cancelled'].includes(stage);
 const current=live.find(e=>e.state==='customer_signature_needed')
  ??live.find(e=>['awaiting_counterparty','creating','needs_review'].includes(e.state))
  ??envelopes.find(e=>e.test_mode&&e.state==='customer_signature_needed')
  ??live.find(e=>e.kind==='assignment'&&e.state==='completed')
  ??live.find(e=>e.kind==='purchase'&&e.state==='completed');
 const party=current?.kind==='assignment'?'buyer':'seller';
 if(stopped)return {purchaseSigned,signatureId:null,title:stage==='cancellation_pending'?'Cancellation needs review':'Deal stopped',detail:'Your saved agreements and signature history are in Documents.'};
 if(current?.test_mode)return {purchaseSigned,signatureId:current.id,title:'Review your test agreement',detail:'This is a test document. Signing it does not put the property under contract.'};
 if(current?.state==='customer_signature_needed')return {purchaseSigned,signatureId:current.id,title:'Your signature is next',detail:`The ${party} has signed. Read the full agreement before completing your signature.`};
 if(current?.state==='awaiting_counterparty')return {purchaseSigned,signatureId:null,title:`Waiting for ${party} signatures`,detail:'We’ll show you here when it’s your turn. No action is needed right now.'};
 if(current?.state==='creating')return {purchaseSigned,signatureId:null,title:'Preparing the agreement',detail:`The ${party}’s signing request is being prepared. Check its status in Documents.`};
 if(current?.state==='needs_review')return {purchaseSigned,signatureId:null,title:'Agreement needs attention',detail:'Open Documents to check the signing request.'};
 if(purchaseSigned)return {purchaseSigned,signatureId:null,title:current?.kind==='assignment'?'Buyer agreement signed':'Property under contract',detail:'Signed documents and signature history are in Documents.'};
 if(envelopes.some(e=>e.test_mode))return {purchaseSigned:false,signatureId:null,title:'Test agreement',detail:'Test signatures do not put this property under contract.'};
 return {purchaseSigned:false,signatureId:null,title:'Seller agreement not signed',detail:'Buyer tools appear after the purchase agreement is signed. Open Documents if you need to prepare it yourself.'};
}
