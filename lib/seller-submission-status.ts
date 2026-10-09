export type SellerSubmissionStatus = {
 phase: 'checking'|'matching'|'contacting'|'contact_started'|'address_review'|'review'|'scheduled';
 title: string;
 message: string;
 terminal: boolean;
};

/** Public progress only. Never disclose internal receipts, contact data or prices. */
export function sellerSubmissionStatus(state:string,responseState?:string,voiceOutcome?:string):SellerSubmissionStatus {
 if(state==='unmatched')return {phase:'address_review',title:'We couldn’t match your address.',message:'Your request is saved, but contact hasn’t started. Check the street, city and ZIP code below.',terminal:true};
 if(responseState==='contact_started')return {phase:'contact_started',title:'Your buyer is reaching out.',message:'A text has been sent and a call has been started. Keep your phone nearby.',terminal:true};
 if(state==='assigned'&&voiceOutcome==='outside_contact_hours')return {phase:'scheduled',title:'Your call is queued.',message:'Your request arrived outside calling hours. Your buyer will call during the next contact window.',terminal:true};
 if(['review','numbers_review'].includes(state)||['needs_setup','stopped'].includes(responseState??''))return {phase:'review',title:'Your request needs a closer look.',message:'Your property is saved. We’re reviewing the next step; you don’t need to submit it again.',terminal:true};
 if(state==='assigned')return {phase:'contacting',title:'You’ve been matched.',message:'Your buyer is preparing to contact you. Keep your phone nearby.',terminal:false};
 if(['qualified','market_review'].includes(state))return {phase:'matching',title:'Finding your buyer.',message:'Your property has been checked. We’re matching your request with an available buyer.',terminal:false};
 return {phase:'checking',title:'Checking your property.',message:'Your request is saved. We’re checking your address before matching you with a buyer.',terminal:false};
}
