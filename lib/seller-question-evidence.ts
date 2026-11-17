import {object} from './required-call-recording.ts';

/** A short answer belongs to the final actual question, not an earlier topic
 * acknowledged in the same turn. Monetary readbacks retain their full text. */
export function sellerQuestion(message:string):string{
 const sentences=message.match(/[^.!?;\n]+(?:[.!?;]|$)/g)??[];
 const sentence=sentences.findLast(part=>part.trim().endsWith('?'))??sentences.at(-1)??'';
 const clauses=sentence.split(/,\s*(?=(?:is|are|do|does|did|have|has|can|could|would|will|what|when|where|why|who|how|tell me)\b)|\b(?:and|also)\s+(?=(?:is|are|do|does|did|can|could|would|will|what|when|where|why|who|how)\s+(?:you|it|anyone|anybody|the|your|this|that|much|many|soon)\b)/i);
 return clauses.at(-1)?.trim()??'';
}

/** Typed missing receipt context stays missing in every contextual extractor. */
export function canonicalSellerTranscript(value:unknown){
 const source=object(value),rows=source.transcript;if(!Array.isArray(rows))return value;
 let questionIndex=-1;
 const transcript:Record<string,unknown>[]=[];
 for(const raw of rows){
  const row=object(raw);
  if(row.role==='agent'&&typeof row.message==='string'){
   questionIndex=transcript.length;transcript.push({...row,message:sellerQuestion(row.message)});
  }else{
   if(row.role==='user'&&row.questionUnverified===true&&questionIndex>=0)transcript[questionIndex]={...transcript[questionIndex],message:''};
   transcript.push({...row});
  }
 }
 return {...source,transcript};
}
