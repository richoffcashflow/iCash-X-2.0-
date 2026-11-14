import {callFirstName} from './call-contact-name.ts';

/** A candidate for a question, never a claim about who answered. The caller
 * must fetch these contacts using the same account and screening as the dial. */
export function sellerGreetingName(contacts:unknown,phone:string):string|null{
 if(!Array.isArray(contacts)||!/^\+1[2-9][0-9]{9}$/.test(phone))return null;
 const matches=contacts.filter(c=>c&&typeof c==='object'&&c.phone===phone);
 if(matches.length!==1||matches[0].blocked!==false)return null;
 const name=matches[0].name;
 if(typeof name!=='string'||/\b(?:saved contact|unknown|and|or|estate|et al|instructions?|system|assistant)\b/i.test(name))return null;
 return callFirstName(name);
}
