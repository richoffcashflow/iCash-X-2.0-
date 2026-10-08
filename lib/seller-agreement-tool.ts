import {canonical,object} from './required-call-recording.ts';
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
/** Reject endpoint, header, schema or dynamic-variable changes independently of agent fingerprints. */
export function sellerAgreementToolMatches(raw:unknown,id?:string){
 const r=object(raw),c=object(r.tool_config),a=object(c.api_schema);
 const empty=(v:unknown)=>v==null||Array.isArray(v)&&v.length===0||typeof v==='object'&&Object.keys(v).length===0;
 const normalizeSchema=(v:unknown):unknown=>Array.isArray(v)?v.map(normalizeSchema):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k,x])=>!(x===null&&['dynamic_variable','constant_value','enum','items'].includes(k))).map(([k,x])=>[k,normalizeSchema(x)])):v;
 return /^tool_[A-Za-z0-9]+$/.test(String(r.id))&&(!id||r.id===id)&&c.type==='webhook'&&c.name===sellerAgreementToolName&&c.follow_redirects===false&&a.url===sellerAgreementToolUrl&&a.method==='POST'
  &&JSON.stringify(canonical(a.request_headers))===JSON.stringify(canonical(sellerAgreementToolConfig.api_schema.request_headers))
  &&JSON.stringify(canonical(normalizeSchema(a.request_body_schema)))===JSON.stringify(canonical(normalizeSchema(sellerAgreementToolConfig.api_schema.request_body_schema)))
  &&a.auth_connection==null&&empty(a.path_params_schema)&&empty(a.query_params_schema)&&empty(r.response_mocks)&&empty(c.response_mocks)&&empty(c.dynamic_variables);
}
