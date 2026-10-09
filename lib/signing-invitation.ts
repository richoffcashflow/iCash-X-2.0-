import {conversationStreet} from './conversation-address.ts';

// DocuSeal accepts Markdown/HTML and template variables: escape tenant text so
// a business name cannot introduce links, markup, or provider placeholders.
const plain = (value:string) => value.replace(/[\r\n\t]+/g,' ').replace(/[<>&{}\[\]()*_`!\\]/g,'').trim();
export function signatureRequestMessage(principal:string,address:string,customer:boolean) {
  const business=plain(principal).slice(0,120)||'iCash X';
  const street=plain(conversationStreet(address)).slice(0,160);
  return {
    subject:customer?`Urgent deal review: ${street}`:`${business}: review your agreement`,
    body:customer
      ? `The other party has signed the agreement for ${street}. Review the terms and add your signature.\n\n[Review & sign]({{submitter.link}})\n\n${business} · sent through iCash X`
      : `${business} has sent your agreement for ${street}. Review the terms and sign when you are ready.\n\n[Review & sign]({{submitter.link}})\n\n${business} · sent through iCash X`,
  };
}
