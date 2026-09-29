// One-shot, privately authorized provider smoke test. Never uses a live API key.
const task='icash-signing-smoke-20260929-01';
const key=process.env.DOCUSEAL_TEST_API_KEY;
async function db(path,method='GET',body){
 const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`,{method,headers:{apikey:process.env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${process.env.SUPABASE_SECRET_KEY}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error('DATABASE_FAILED');return r.json();
}
if(key&&process.env.SUPABASE_URL&&process.env.SUPABASE_SECRET_KEY){
 try{
  const rows=await db(`icash_template_drafts?key=eq.${task}&state=eq.claimed`);
  const approved=rows?.[0]?.result;
  if(approved?.authorized===true&&approved?.mode==='test'&&typeof approved?.email==='string'){
   const template=await db('icash_template_drafts?key=eq.icash-x-test-purchase-v1-layout-v3');
   const templateId=template?.[0]?.result?.id;
   if(!Number.isSafeInteger(templateId))throw new Error('TEMPLATE_UNAVAILABLE');
   // Atomic claim before sending: duplicate builds cannot send another invitation.
   const claim=await db(`icash_template_drafts?key=eq.${task}&state=eq.claimed`,'PATCH',{state:'needs_review',updated_at:new Date().toISOString()});
   if(claim.length){
    const values={seller:'TEST SELLER - NO REAL TRANSACTION',buyer:'TEST CUSTOMER - NO REAL TRANSACTION',address:'TEST PROPERTY - NOT A REAL ADDRESS',state:'TX',priceCents:'$150,000.00',earnestCents:'$100.00',inspectionDays:'10',effectiveDate:'',closingDate:'',escrowAgent:'TEST ONLY - NO ESCROW OPENED',titleEmail:'',legalDescription:'TEST ONLY. No real parcel or property is identified. This agreement is for verifying the electronic-signing workflow only.',dealNotes:'SIMULATION ONLY. No purchase, assignment, payment, escrow, or obligation to buy or sell is created by this test. Both signing roles are operated by the account owner for testing.'};
    const payload={template_id:templateId,order:'preserved',send_email:true,send_sms:false,message:{subject:'iCash X - seller signature TEST',body:'This is your requested iCash X signing test. No real property or transaction is involved. Review the test document and sign the Seller role first. The Customer step follows afterward.'},submitters:['Seller','Customer'].map((role,i)=>({role,name:`Test ${role}`,email:approved.email,external_id:`${task}:${role}`,require_email_2fa:true,metadata:{test_only:true,authorization_task:task},fields:i===0?Object.entries(values).map(([name,default_value])=>({name,default_value,readonly:true})):[]}))};
    const r=await fetch('https://api.docuseal.com/submissions',{method:'POST',headers:{'X-Auth-Token':key,'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(45000)});
    if(!r.ok){await db(`icash_template_drafts?key=eq.${task}`,'PATCH',{result:{...approved,status:`provider_http_${r.status}`,error:(await r.text()).slice(0,1500)}});}
    else{
     const raw=await r.json();if(!Array.isArray(raw)||raw.length!==2)throw new Error('UNEXPECTED_RESPONSE');
     await db(`icash_template_drafts?key=eq.${task}`,'PATCH',{state:'created',result:{...approved,templateId,submitters:raw.map(s=>({id:s.id,submission_id:s.submission_id,role:s.role,email:s.email,status:s.status,sent_at:s.sent_at,slug:s.slug})),scope:'provider_smoke_test_only'},updated_at:new Date().toISOString()});
     console.log('Authorized test signing request created. No live transaction.');
    }
   }
  }
 }catch{console.log('Authorized signing test needs review; no automatic resend.');}
}
