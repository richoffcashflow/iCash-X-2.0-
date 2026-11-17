import type {SigningPdfSource} from './signing-service';
type Database=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Document={kind:'purchase'|'assignment';envelopeId:string;sourceHash:string;pdfSource:SigningPdfSource};
type Prepared={status:'ready';documents:Document[]}|{status:'covered_by_original_receipt'};
/** PDFs are loaded before the existing final claim, which recomputes the exact
 * source/documents. This helper never sends, claims or substitutes a document. */
export async function prepareTitleCopyDelivery(accountId:string,taskId:string,payload:unknown,
 d:{db:Database;pdf:(account:string,envelope:string,audit:boolean,expectedSource:SigningPdfSource)=>Promise<ArrayBuffer|Uint8Array>}){
 let prepared:Prepared|null;
 try{prepared=await d.db<Prepared|null>('rpc/icash_prepare_title_copy','POST',{p_account:accountId,p_task:taskId,p_payload:payload});}catch{return {status:'retry' as const};}
 if(!prepared)return {status:'held' as const};
 if(prepared.status==='covered_by_original_receipt')return {status:'covered' as const};
 if(prepared.status!=='ready'||!Array.isArray(prepared.documents)||prepared.documents.length<1||prepared.documents.length>2)throw Error('Title copy source required');
 const attachments:{filename:string;content:string}[]=[];let bytes=0;const kinds=new Set<string>();
 for(const doc of prepared.documents){
  if(!['purchase','assignment'].includes(doc.kind)||kinds.has(doc.kind)||!/^[0-9a-f-]{36}$/.test(doc.envelopeId)||!/^[0-9a-f]{64}$/.test(doc.sourceHash)
   ||!doc.pdfSource||doc.pdfSource.id!==doc.envelopeId||doc.pdfSource.accountId!==accountId||doc.pdfSource.kind!==doc.kind||doc.pdfSource.state!=='completed'||doc.pdfSource.testMode!==false)throw Error('Title copy document required');
  kinds.add(doc.kind);let pdf:ArrayBuffer|Uint8Array;
  try{pdf=await d.pdf(accountId,doc.envelopeId,false,doc.pdfSource);}catch{return {status:'retry' as const};}
  bytes+=pdf.byteLength;
  if(pdf.byteLength===0||bytes>20*1024*1024)throw Error('Title copy attachment requires review');
  attachments.push({filename:`executed-${doc.kind}-agreement.pdf`,content:Buffer.from(pdf instanceof Uint8Array?pdf:new Uint8Array(pdf)).toString('base64')});
 }
 return {status:'ready' as const,attachments,details:'Attached are the executed agreements requested in your verified reply. These are copies of the existing signed documents; their terms are unchanged. Please confirm receipt and identify any remaining requirements.'};
}
