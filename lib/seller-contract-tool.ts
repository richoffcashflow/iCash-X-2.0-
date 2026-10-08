import {object} from './required-call-recording.ts';
import {sellerAgreementToolMatches} from './seller-agreement-tool.ts';
export const sellerContractToolId='tool_1801m4a9p7fjfc99sekbasj4g58z';
/** Call-scoped delivery only: no model-selected phone, URL, envelope or terms. */
export function sellerContractToolMatches(raw:unknown,id=sellerContractToolId){
 if(sellerAgreementToolMatches(raw,id))return true;
 const r=object(raw),c=object(r.tool_config),a=object(c.api_schema),h=object(a.request_headers),auth=object(h.Authorization),b=object(a.request_body_schema),p=object(b.properties),conversation=object(p.conversationId),price=object(p.agreedPriceCents);
 const empty=(v:unknown)=>v==null||Array.isArray(v)&&v.length===0||typeof v==='object'&&Object.keys(v).length===0;
 return r.id===id&&c.type==='webhook'&&c.name==='icash_text_contract'&&a.url==='https://www.geticashx.com/api/internal/voice/contract-text'&&a.method==='POST'&&c.follow_redirects===false&&Object.keys(h).length===1&&Object.keys(auth).length===1&&auth.variable_name==='secret__icash_call_token'&&b.type==='object'&&Array.isArray(b.required)&&b.required.length===2&&b.required.includes('conversationId')&&b.required.includes('agreedPriceCents')&&Object.keys(p).length===2&&conversation.type==='string'&&conversation.dynamic_variable==='system__conversation_id'&&price.type==='number'&&!price.dynamic_variable&&a.auth_connection==null&&empty(a.path_params_schema)&&empty(a.query_params_schema)&&empty(r.response_mocks)&&empty(c.response_mocks);
}
