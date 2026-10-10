// Template scenarios only: no recipients, providers or network requests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const pg=await PGlite.create();
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('NETWORK BLOCKED');};
try{
 const segmentSql=readFileSync('supabase/migrations/20261005215816_contract_text_delivery.sql','utf8');
 await pg.exec(segmentSql.slice(segmentSql.indexOf('create function public.icash_sms_single_segment'),segmentSql.indexOf('do $patch$')));
 const sql=readFileSync('supabase/migrations/20261010221252_buyer_outreach_copy.sql','utf8');
 assert.equal(sql,readFileSync('config/buyer-outreach-copy.sql','utf8'));
 await pg.exec(sql.slice(sql.indexOf('create or replace function public.icash_buyer_outreach_money'),sql.indexOf('create or replace function public.icash_buyer_outreach_content')));
 const url='https://www.geticashx.com/d/'+'a'.repeat(32);
 const data={market:'DALLAS',principal:'Clear Path Homes',address:'327 LEVANT AVE, DALLAS, TX 75217',askingPriceCents:12600000,arvCents:20300000,repairsCents:2390500,depositCents:212670,closingDate:'2026-11-10',latitude:32.707537,longitude:-96.64655,purchasePriceCents:11536650,assignmentFeeCents:1063350,seller:'PRIVATE SELLER'};
 const copy=async(p=data,link=url)=>(await pg.query('select public.icash_buyer_outreach_copy($1::jsonb,$2) value',[JSON.stringify(p),link])).rows[0].value;
 const current=await copy();
 assert.equal(current.sms,`Clear Path Homes: Buying in Dallas? $126k + closing costs. Buyer package: ${url}`);
 assert.equal((await pg.query('select public.icash_sms_single_segment($1) ok',[current.sms])).rows[0].ok,true);
 assert.equal(current.subject,'Buying in Dallas? $126k | '+data.address);
 assert(current.email.includes('Are you buying in Dallas right now?'));assert(current.email.includes('Does this fit what you are buying?'));assert(current.email.includes(url));assert(current.email.includes(data.address));
 assert(current.email.includes('Estimated ARV: about $203k'));assert(current.email.includes('Estimated repairs: about $24k'));assert(current.email.includes('Closing date: November 10, 2026'));assert(current.email.includes('Non-refundable deposit: $2,126.70'));assert(current.email.includes('without a viewing'));
 assert(!JSON.stringify(current).match(/115,366|10,633|PRIVATE SELLER|20%|20 percent|source images|AI assistant/i));
 const rounded=await copy({...data,askingPriceCents:12500000,depositCents:200000});assert(rounded.email.includes('deposit: $2k'));assert(rounded.sms.includes('$125k'));
 const legacy=await copy({...data,askingPriceCents:16227050});assert(legacy.sms.includes('$162,270.50'),'issued legacy amount cannot be rounded into a different offer');
 const missing=await copy({...data,latitude:null,longitude:null,arvCents:null,repairsCents:null,closingDate:null,depositCents:null});
 assert(missing.sms.includes('Buyer package:'));assert(missing.email.includes('Buyer package (property details):'));assert(!missing.email.includes('Estimated ARV'));assert(!missing.email.includes('Estimated repairs'));assert(missing.email.includes('Closing date: To be confirmed'));assert(missing.email.includes('Deposit amount: confirm'));assert(!/photos & details|undefined|NaN/.test(missing.email));
 assert.equal(await copy({...data,reserved:true}),null);assert.equal(await copy({...data,askingPriceCents:-1}),null);assert.equal(await copy(data,'https://unrelated.example/'),null);
 assert(!(await copy({...data,depositCents:500001})).email.includes('$5,000.01'));
 const photos=await copy({...data,latitude:null,longitude:null,sellerPhotos:[{url:'https://api.contiguity.com/attachments/test.jpg',mime:'image/jpeg'}]});assert(photos.email.includes('Buyer package (photos & details):'));
 const headers=await copy({...data,address:'123 Main\r\nBcc: invalid',principal:'Fixture\nBusiness'});assert(!/[\r\n]/.test(headers.subject));assert(headers.sms.includes('Fixture Business'));
 const noMarket=await copy({...data,market:null});assert(noMarket.sms.includes('Buying properties right now?'));
 const zipMarket=await copy({...data,market:'75217'});assert(zipMarket.sms.includes('Buying in ZIP 75217?'));
 const longMarket=await copy({...data,market:'A'.repeat(80)});assert(longMarket.sms.includes('Buying now?'));assert(longMarket.sms.includes(url));
 assert.equal(await copy({...data,principal:'B'.repeat(200)}),null,'unfit sender identity is held without truncating it or charging more segments');
 assert.equal(await copy({...data,principal:'会社'}),null,'Unicode copy must obey the real one-segment limit');
 console.log('PASS outreach copy: buying question with immediate package, exact price/link/CTA, real SMS segment limit, exact legacy terms, rounded estimates, optional viewing, photo availability, missing-data handling, privacy and header sanitation. Zero provider calls.');
 console.log(JSON.stringify({sms:current.sms,subject:current.subject,email:current.email}));
}catch(error){console.error(error.message,error.where??'');process.exitCode=1;}finally{await pg.close();globalThis.fetch=originalFetch;}
