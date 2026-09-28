import {mkdir,writeFile} from 'node:fs/promises';
const results=[];
for(const path of ['/numbers/leased','/entitlements/']){
 let result={endpoint:path,scheme:'Token',status:'unavailable'};
 try{
  const key=process.env.CONTIGUITY_API_KEY;
  if(!key) throw Error('missing');
  const r=await fetch('https://api.contiguity.com'+path,{headers:{Authorization:'Token '+key,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  result.status=r.status;
  const raw=await r.text();let body;try{body=JSON.parse(raw)}catch{}
  result.json=!!body;
  // Only allowlisted classification/counts; never expose raw provider error strings.
  result.reason=/invalid.{0,20}(token|key)|unauthoriz/i.test(raw)?'authentication_rejected':/entitlement|permission|forbidden/i.test(raw)?'access_denied':'unspecified';
  if(r.ok&&Array.isArray(body?.data?.numbers)){result.leasedNumbers=body.data.numbers.length;result.activeIMessageNumbers=body.data.numbers.filter(n=>n.lease_status==='active'&&n.capabilities?.channels?.includes('imessage')).length;}
  if(r.ok&&Array.isArray(body?.data?.entitlements)){result.grantedEntitlements=body.data.entitlements.filter(e=>e.status==='granted').length;}
 }catch{}
 results.push(result);
}
await mkdir('public',{recursive:true});
await writeFile('public/contiguity-auth-check.json',JSON.stringify({results,messagesSent:0}));
