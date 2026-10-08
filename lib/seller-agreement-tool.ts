import {canonical,object} from './required-call-recording.ts';
import {automaticOfferToolName} from './automatic-offer-policy.ts';
export const sellerAgreementToolName='icash_seller_agreement';
export const sellerAgreementToolUrl='https://www.geticashx.com/api/internal/voice/seller-agreement';
const field=(type:string,description:string,extra:Record<string,unknown>={})=>({type,description,...extra});
export const sellerAgreementToolConfig={
 type:'webhook',name:sellerAgreementToolName,
 description:'Prepare and text the exact seller purchase agreement only after confirming price, closing date, all owners and decision makers, inspection preference and prepared terms. Check actual signing status after the seller says they signed. Never invent confirmations.',
 response_timeout_secs:30,disable_interruptions:false,force_pre_tool_speech:false,follow_redirects:false,
 api_schema:{url:sellerAgreementToolUrl,method:'POST',request_headers:{Authorization:{variable_name:'secret__icash_call_token'}},
  request_body_schema:{type:'object',description:'Call-bound seller agreement action.',required:['action','conversationId'],properties:{
   action:field('string','Use confirm_and_send to prepare/text after confirmation; status to verify the signature.',{enum:['confirm_and_send','status']}),
   conversationId:{type:'string',dynamic_variable:'system__conversation_id'},
   confirmation:{type:'object',description:'Required only for confirm_and_send. Omit for status. Use only the seller\'s explicit answers.',required:['sellerLegalName','agreedPriceCents','closingDate','soleOwner','allDecisionMakersAgree','inspectionAccess','priceAndDateConfirmed','termsConfirmed','sendTextRequested','materialFactsChanged'],properties:{
    sellerLegalName:field('string','Full legal name confirmed by this seller.'),agreedPriceCents:field('number','Exact agreed cash purchase price in cents, within the supplied authority.'),closingDate:field('string','Exact closing date confirmed aloud, YYYY-MM-DD.'),
    soleOwner:field('boolean','True only if the seller explicitly confirms no other owners must sign.'),allDecisionMakersAgree:field('boolean','True only after the seller confirms all required decision makers agree.'),
    inspectionAccess:field('string','Their answer to the inspection visit question; no is allowed and does not by itself reject the deal.',{enum:['yes','no']}),
    priceAndDateConfirmed:field('boolean','Seller explicitly confirmed the read-back price and date.'),termsConfirmed:field('boolean','Seller confirmed the actual prepared terms, including earnest money and inspection days.'),sendTextRequested:field('boolean','Seller asked or agreed to receive the agreement by text now.'),materialFactsChanged:field('boolean','True when new property, ownership or payoff facts conflict with the saved research.'),
   }},
  }},
 },
};
export const noEmdAgreementToolName='icash_seller_agreement_no_emd';
export const noEmdAgreementToolConfig=structuredClone(sellerAgreementToolConfig);
noEmdAgreementToolConfig.name=noEmdAgreementToolName;
noEmdAgreementToolConfig.api_schema.request_body_schema.properties.confirmation.properties.termsConfirmed.description='Seller confirmed the actual prepared terms and inspection days. The seller purchase agreement has no earnest-money deposit requirement; do not request or hold for an EMD amount.';
export const legacyAutomaticOfferToolConfig={...structuredClone(noEmdAgreementToolConfig),name:automaticOfferToolName,
 description:'Get the exact server-calculated seller offer or authorized buyer price before saying any price. Save acceptance, recalculate from a seller-stated total repair estimate, or record changed facts. Then prepare/text the no-EMD seller agreement and verify signatures after closing confirmations.',
 api_schema:{...structuredClone(noEmdAgreementToolConfig.api_schema),url:'https://www.geticashx.com/api/internal/voice/cash-offer',request_body_schema:{...structuredClone(noEmdAgreementToolConfig.api_schema.request_body_schema),properties:{
  ...structuredClone(noEmdAgreementToolConfig.api_schema.request_body_schema.properties),
  action:field('string','get_offer before any price; accept_offer after acceptance; update_repairs for condition; report_change for ownership/payoff; confirm_and_send after closing confirmations; status after signing.',{enum:['get_offer','accept_offer','update_repairs','report_change','confirm_and_send','status']}),
  priceCents:field('number','accept_offer only: exact priceCents from the most recent successful get_offer result.'),
  quoteRevision:field('string','accept_offer only: exact quoteRevision from that get_offer result.'),
  sellerStatement:field('string','update_repairs/report_change only: the seller\'s full statement verbatim.'),
  repairEstimateCents:field('number','update_repairs only: optional seller-stated estimated TOTAL repair budget in cents. Omit unless supplied; never infer it from condition or sale price.'),
 }}}};
export const automaticOfferToolConfig={...structuredClone(legacyAutomaticOfferToolConfig),
 api_schema:{...structuredClone(legacyAutomaticOfferToolConfig.api_schema),request_body_schema:{...structuredClone(legacyAutomaticOfferToolConfig.api_schema.request_body_schema),
 required:[...legacyAutomaticOfferToolConfig.api_schema.request_body_schema.required,'conversationHistory'],
 properties:{...structuredClone(legacyAutomaticOfferToolConfig.api_schema.request_body_schema.properties),conversationHistory:{type:'string',dynamic_variable:'system__conversation_history'}}}}
};
/** Reject endpoint, header, schema or dynamic-variable changes independently of agent fingerprints. */
export function sellerAgreementToolMatches(raw:unknown,id?:string,policy?:unknown){
 const r=object(raw),c=object(r.tool_config),a=object(c.api_schema);
 const expected=c.name===automaticOfferToolName?(policy&&policy!=='automatic_offer_v9'?legacyAutomaticOfferToolConfig:automaticOfferToolConfig):c.name===noEmdAgreementToolName?noEmdAgreementToolConfig:sellerAgreementToolConfig;
 const empty=(v:unknown)=>v==null||Array.isArray(v)&&v.length===0||typeof v==='object'&&Object.keys(v).length===0;
 // ElevenLabs serializes inactive value sources as empty strings/false/null.
 // Remove only those neutral defaults; any active source or omitted field fails.
 const neutral=(k:string,x:unknown)=>x===null&&['dynamic_variable','constant_value','enum','items','allowed_values','allowed_values_dynamic_variable'].includes(k)
  ||x===''&&['description','dynamic_variable','constant_value','allowed_values_dynamic_variable'].includes(k)
  ||x===false&&['is_system_provided','is_omitted'].includes(k);
 const normalizeSchema=(v:unknown):unknown=>Array.isArray(v)?v.map(normalizeSchema):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k,x])=>!neutral(k,x)).map(([k,x])=>[k,normalizeSchema(x)])):v;
 const variables=object(c.dynamic_variables),noVariables=empty(c.dynamic_variables)||Object.keys(variables).length===1&&Object.hasOwn(variables,'dynamic_variable_placeholders')&&empty(variables.dynamic_variable_placeholders);
 return /^tool_[A-Za-z0-9]+$/.test(String(r.id))&&(!id||r.id===id)&&c.type==='webhook'&&c.name===expected.name&&c.follow_redirects===false&&a.url===expected.api_schema.url&&a.method==='POST'
  &&JSON.stringify(canonical(a.request_headers))===JSON.stringify(canonical(expected.api_schema.request_headers))
  &&JSON.stringify(canonical(normalizeSchema(a.request_body_schema)))===JSON.stringify(canonical(normalizeSchema(expected.api_schema.request_body_schema)))
  &&a.auth_connection==null&&empty(a.path_params_schema)&&empty(a.query_params_schema)&&empty(r.response_mocks)&&empty(c.response_mocks)&&noVariables;
}
