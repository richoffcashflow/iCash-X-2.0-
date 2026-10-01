import {isDeepStrictEqual} from 'node:util';
import {dealTermsSchema} from './deal-documents.ts';

/** Customer edits may echo, but never create, change or erase stored provenance. */
export function mergeStoredDealTerms(input:Record<string,unknown>,stored:Record<string,unknown>|null){
 const editable=new Set(Object.keys(dealTermsSchema.shape));
 const fields:Record<string,unknown>={},provenance:Record<string,unknown>={};
 for(const [key,value] of Object.entries(stored??{}))if(!editable.has(key))provenance[key]=value;
 for(const [key,value] of Object.entries(input)){
  if(editable.has(key))fields[key]=value;
  else if(!Object.hasOwn(provenance,key)||!isDeepStrictEqual(value,provenance[key]))throw Error('Stored deal provenance cannot change');
 }
 return {...provenance,...dealTermsSchema.parse(fields)};
}
