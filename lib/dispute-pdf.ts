import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {disputeMoney,disputeTime,type EvidencePacket} from './disputes.ts';
/** PDF uses a standard font; unsupported Unicode is shown as an explicit code, never silently discarded. */
export function evidencePdfText(input:string){return input.replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2013\u2014]/g,'-').replace(/[^\x20-\x7e\n]/gu,c=>'\\u{'+c.codePointAt(0)!.toString(16)+'}');}
export async function disputePdf(packet:EvidencePacket){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Courier),bold=await doc.embedFont(StandardFonts.CourierBold);
 doc.setTitle(`iCash X dispute evidence - ${packet.dispute.id}`);doc.setAuthor('iCash X');
 let page=doc.addPage([612,792]),y=738;
 function next(){if(doc.getPageCount()>=18)throw Error('Evidence exceeds PDF page limit. Review the JSON record and select relevant evidence.');page=doc.addPage([612,792]);y=738;}
 function paragraph(raw:string,heading=false){
  const selected=heading?bold:font,size=heading?14:12,lineHeight=heading?20:17;
  const words=evidencePdfText(raw).split(/\s+/),lines:string[]=[];let line='';
  const flush=()=>{lines.push(line);line='';};
  for(const word of words){let chunk='';for(const letter of word){if(selected.widthOfTextAtSize(chunk+letter,size)>510){if(line)flush();line=chunk;flush();chunk='';}chunk+=letter;}if(selected.widthOfTextAtSize(line+(line?' ':'')+chunk,size)>528)flush();line+=(line?' ':'')+chunk;}
  if(line)flush();
  if(lines.length<=6&&y-lines.length*lineHeight<58)next();
  for(const text of lines){if(y<58)next();page.drawText(text,{x:42,y,font:selected,size,color:rgb(.08,.08,.08)});y-=lineHeight;}y-=8;
 }
 paragraph('iCash X | Dispute evidence',true);
 paragraph(`Review draft - not submitted. ${packet.dispute.id}`);
 paragraph(`Disputed: ${disputeMoney(packet.dispute.amountCents,packet.dispute.currency)} | Reason: ${packet.dispute.reason} | Status: ${packet.dispute.status}`);
 paragraph(`Response due: ${disputeTime(packet.dispute.dueAt)} | Prepared: ${disputeTime(packet.generatedAt)}`);
 paragraph(packet.guidance);
 paragraph('Review before submission',true);
 paragraph('This packet reports available records and does not assert that the dispute is invalid. Confirm the claim, include relevant context, and submit the appropriate evidence in Stripe before the deadline. Unsupported characters appear as Unicode codes; original text is preserved in the JSON download.');
 for(const gap of packet.gaps)paragraph('- '+gap);
 for(const section of packet.sections){if(!section.lines.length)continue;if(y<110)next();paragraph(section.title,true);if(!section.lines.length)paragraph('No records in this selection.');for(const line of section.lines)paragraph(line);}
 for(const [i,p] of doc.getPages().entries())p.drawText(`iCash X | ${packet.dispute.id} | ${i+1} of ${doc.getPageCount()}`,{x:42,y:30,size:9,font,color:rgb(.4,.4,.4)});
 const bytes=await doc.save();if(bytes.length>4_000_000)throw Error('Evidence exceeds the attachment limit');return bytes;
}
