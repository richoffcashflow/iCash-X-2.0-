import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {summaryLines,type WorkSummary} from './work-summary.ts';
export async function workSummaryPdf(s:WorkSummary){
 const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 let page=pdf.addPage([612,792]),y=742;
 const heading=()=>{page.drawText('iCash X 2.0 | Work summary',{x:48,y,size:20,font:bold});y-=35;};heading();
 for(const raw of summaryLines(s)){
  const text=raw.normalize('NFKD').replace(/[^\x20-\x7E]/g,' ');const words=text.split(/\s+/);let line='';const lines:string[]=[];
  for(const word of words){if(font.widthOfTextAtSize(line+' '+word,10)>510&&line){lines.push(line);line=word;}else line+=(line?' ':'')+word;}lines.push(line);
  for(const line of lines){if(y<58){page=pdf.addPage([612,792]);y=742;heading();}page.drawText(line,{x:48,y,size:10,font:raw===raw.toUpperCase()&&raw.length>0?bold:font,color:rgb(.15,.15,.15)});y-=16;}
 }
 pdf.getPages().forEach((p,i)=>p.drawText(`${i+1} / ${pdf.getPageCount()}`,{x:525,y:28,size:9,font}));return pdf.save();
}
