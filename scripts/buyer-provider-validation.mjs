// Only validation metadata is retained, never request input, headers or tokens.
export function buyerProviderValidation(body,secret){
 const clean=value=>typeof value==='string'?value.replaceAll(secret||'\u0000','[redacted]').replace(/(?:sk_|Bearer\s+)[A-Za-z0-9_.-]+/gi,'[redacted]').slice(0,1200):null;
 const detail=body?.detail;
 if(Array.isArray(detail))return detail.slice(0,8).map(row=>({location:Array.isArray(row?.loc)?row.loc.slice(0,12).map(v=>typeof v==='number'?v:clean(v)):null,type:clean(row?.type),message:clean(row?.msg)}));
 return {status:clean(detail?.status),message:clean(detail?.message??(typeof detail==='string'?detail:null))};
}
