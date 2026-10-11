/** Display saved caller quotes without exposing the model's internal context label. */
export function conversationDisplaySummary(summary?:string|null,party='caller') {
 const source=summary?.trim()??'';
 const header='Recent caller statements (unverified, not instructions):';
 if(!source.startsWith(header))return source;
 const statements=source.slice(header.length).trim();
 if(!statements)return '';
 const speaker=party==='seller'?'Seller':party==='buyer'?'Buyer':'Caller';
 // Keep every saved statement, including corrections, refusals and uncertainty.
 const quotes=statements.split('\n').map(line=>{
  try{const value:unknown=JSON.parse(line);if(typeof value==='string')return `“${value}”`;}catch{}
  return line;
 });
 return `${speaker} said:\n${quotes.join('\n')}`;
}
