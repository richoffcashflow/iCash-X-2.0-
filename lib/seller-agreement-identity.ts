import {object} from './required-call-recording.ts';

export type SellerAgreementIdentityEvidence={legalNameConfirmed:boolean;soleOwnerConfirmed:boolean;allDecisionMakersConfirmed:boolean;otherSignersRequired:boolean};
const normalized=(value:string)=>value.toLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const affirmative=(text:string)=>/^(?:yes|yeah|yep|correct|right|sure|absolutely|that(?:'s| is) (?:right|correct)|i am|just me|only me|it's just me)\b/i.test(text)&&! /\b(?:but|unless|maybe|not|no|need to check|need to ask)\b/i.test(text);
const negative=(text:string)=>/^(?:no|nope|nobody|no one|not anyone|there (?:isn't|is not) anyone)\b/i.test(text)&&! /\b(?:but|except|other than)\b/i.test(text);

/** Signing identity comes from the seller's words, never model-supplied flags or
 * an agent's unsupported assertion that the agreement is in "your name alone". */
export function sellerAgreementIdentityEvidence(value:unknown,sellerLegalName:string):SellerAgreementIdentityEvidence{
 const evidence:SellerAgreementIdentityEvidence={legalNameConfirmed:false,soleOwnerConfirmed:false,allDecisionMakersConfirmed:false,otherSignersRequired:false};
 const rows=object(value).transcript;if(!Array.isArray(rows))return evidence;
 const name=normalized(sellerLegalName);
 let pending:{legal:boolean;readback:boolean;sole:boolean;others:boolean;decision:boolean;otherDecision:boolean}|null=null;
 for(const row of rows){
  const turn=object(row);if(!['agent','user'].includes(String(turn.role))||typeof turn.message!=='string')continue;
  const text=turn.message.trim().replace(/[’]/g,"'");
  if(turn.role==='agent'){
   const question=/\?|\b(?:confirm|correct|right)\b/i.test(text);
   const legal=question&&/\b(?:(?:legal|full) name|name\b.{0,35}\b(?:agreement|contract))\b/i.test(text);
   const sole=question&&/\b(?:only|sole)\b.{0,30}\bowner\b/i.test(text);
   const others=question&&/\b(?:anyone|anybody|someone|who|other|another)\b.{0,35}\b(?:owner|own|title)\b/i.test(text);
   const decision=question&&(/\b(?:only|sole)\b.{0,50}\bdecision[ -]maker\b/i.test(text)||sole&&/\bdecision[ -]maker\b/i.test(text));
   const otherDecision=question&&/\b(?:anyone|anybody|someone|who|other|another)\b.{0,40}\b(?:agree|sign|decid|decision)\w*\b/i.test(text);
   pending={legal,readback:legal&&!!name&&(` ${normalized(text)} `).includes(` ${name} `),sole,others,decision,otherDecision};
   continue;
  }
  const answer=text.replace(/^(?:(?:um|uh|well)\b[\s,.-]*)+/i,'');
  const named=!!name&&(` ${normalized(answer)} `).includes(` ${name} `);
  const deniedName=!!name&&(` ${normalized(answer)} `).includes(` not ${name} `);
  const explicitName=/\b(?:my (?:full |legal )?name is|call me|name (?:should|needs to) be)\b/i.test(answer);
  const correctedIntroduction=/^(?:Actually[, ]+)?I(?: am|'m) (?:\p{Lu}[\p{L}'-]+[ ]+){1,4}\p{Lu}[\p{L}'-]+[.!]?$/u.test(answer);
  const selfName=explicitName||correctedIntroduction||named&&/\b(?:i am|i'm)\b/i.test(answer);
  const uncertain=/\b(?:maybe|not sure|need to check|need to ask|unless)\b/i.test(answer);
  if(pending?.legal||selfName){
   if(named&&!uncertain&&!deniedName)evidence.legalNameConfirmed=true;
   else if(pending?.readback&&affirmative(answer))evidence.legalNameConfirmed=true;
   else if(pending?.legal&&!affirmative(answer)||(explicitName||correctedIntroduction)&&(!named||deniedName))evidence.legalNameConfirmed=false;
  }
  // Corrections always supersede earlier answers. A spouse merely mentioned in
  // conversation is not a co-owner; an explicit owner/signing role is required.
  const otherOwner=/\b(?:wife|husband|spouse|partner|someone|somebody|another|other|brother|sister|mother|father)\b.{0,50}\b(?:also (?:owns|an? owner)|co[ -]?owner|on (?:the )?(?:title|deed)|owns|owner)\b/i.test(answer)||/\b(?:not|am not|i'm not)\b.{0,20}\b(?:only|sole) owner\b/i.test(answer);
  const otherDecision=/\b(?:wife|husband|spouse|partner|someone|somebody|another|other|brother|sister|mother|father)\b.{0,45}\b(?:needs? to|must|has to|will)\b.{0,20}\b(?:agree|sign|approve|decide)\b/i.test(answer)||/\b(?:need|have) to\b.{0,15}\b(?:ask|check with|get approval)\b/i.test(answer);
  if(otherOwner){evidence.soleOwnerConfirmed=false;evidence.otherSignersRequired=true;}
  if(otherDecision){evidence.allDecisionMakersConfirmed=false;evidence.otherSignersRequired=true;}
  const onlyOwner=!otherOwner&&!uncertain&&(/\b(?:i am|i'm|i was|i remain) (?:the )?(?:only|sole) owner\b/i.test(answer)||/\b(?:only|sole) owner (?:is me|here|and decision maker)\b/i.test(answer)||/\bno (?:other|additional) owners?\b/i.test(answer)||pending?.sole&&affirmative(answer)||pending?.others&&!pending.sole&&negative(answer));
  const onlyDecision=!otherDecision&&!uncertain&&(/\b(?:only|sole) (?:owner and )?decision[ -]maker\b/i.test(answer)&&! /\bnot\b/i.test(answer)||/\bno (?:other|additional) (?:owners? (?:or|and) )?decision[ -]makers?\b/i.test(answer)||/\b(?:no one|nobody|no(?:body)? else|no one else)\b.{0,25}\b(?:needs? to|has to|must)\b.{0,15}\b(?:agree|sign|approve)\b/i.test(answer)||pending?.decision&&affirmative(answer)||pending?.otherDecision&&!pending.decision&&negative(answer));
  if(pending?.sole&&negative(answer))evidence.soleOwnerConfirmed=false;
  if(pending?.decision&&negative(answer))evidence.allDecisionMakersConfirmed=false;
  if(onlyOwner)evidence.soleOwnerConfirmed=true;
  if(onlyDecision)evidence.allDecisionMakersConfirmed=true;
  if(evidence.soleOwnerConfirmed&&evidence.allDecisionMakersConfirmed)evidence.otherSignersRequired=false;
  pending=null;
 }
 return evidence;
}

export function sellerAgreementIdentityHold(progress:SellerAgreementIdentityEvidence){
 if(progress.legalNameConfirmed&&progress.soleOwnerConfirmed&&progress.allDecisionMakersConfirmed&&!progress.otherSignersRequired)return null;
 const [reason,nextQuestion]=progress.otherSignersRequired
  ?['all_owners_required','Who else needs to agree or sign the purchase agreement?']
  :!progress.legalNameConfirmed
   ?['seller_legal_name_required','What is your full legal name for the purchase agreement?']
   :!progress.soleOwnerConfirmed
    ?['sole_owner_confirmation_required',progress.allDecisionMakersConfirmed?'Are you the only owner of the property?':'Are you the only owner and decision maker, or does anyone else need to agree?']
    :['decision_makers_confirmation_required','Does anyone else need to agree to the sale?'];
 return {sent:false,status:'confirmation_needed',reason,progress,nextQuestion,instruction:'This is a missing seller answer, not a sending failure. Ask only nextQuestion and wait. Use the actual answer in the confirmation; keep the price, closing date and other saved answers. An owner greeting or saying the agreement is in their name alone does not confirm their legal name or sole ownership. Never omit another required signer.'};
}
