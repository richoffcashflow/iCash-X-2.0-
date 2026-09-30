import {readContractCoverage} from '@/lib/contract-coverage-service';
import {contractCapability} from '@/lib/contract-coverage';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {authorityReviewStatus} from '@/lib/authority-review-status';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{
 const {accountId}=await workAccount(),screeningId=z.string().uuid().parse(new URL(req.url).searchParams.get('screeningId'));
 const [screening]=await db<{id:string}[]>(`icash_screening_jobs?account_id=eq.${accountId}&id=eq.${screeningId}&state=eq.complete&select=id`);
 if(!screening)return NextResponse.json({error:'Property not found.'},{status:404,headers});
 const [identities,accounts,wallets,permissions,offers,deals]=await Promise.all([
 db<{principal:string}[]>(`icash_customer_identities?account_id=eq.${accountId}&select=principal`),
 db<{bot_paused:boolean}[]>(`icash_accounts?id=eq.${accountId}&select=bot_paused`),
 db<{balance_cents:number;reserved_cents:number}[]>(`icash_wallets?account_id=eq.${accountId}&select=balance_cents,reserved_cents`),
 db<{phone:string;contact_key:string;permission_until:string;dnc_checked_at:string;dnc_clear:boolean;revoked_at:string|null}[]>(`icash_contact_permissions?account_id=eq.${accountId}&screening_id=eq.${screeningId}&party=eq.seller&select=phone,contact_key,permission_until,dnc_checked_at,dnc_clear,revoked_at&order=permission_until.desc&limit=100`),
 db<{max_offer_cents:number;expires_at:string}[]>(`icash_offer_authorities?account_id=eq.${accountId}&screening_id=eq.${screeningId}&select=max_offer_cents,expires_at`),
 db<{id:string;terms:{priceCents?:number;assignmentFeeCents?:number;state?:string}}[]>(`icash_deal_files?account_id=eq.${accountId}&screening_id=eq.${screeningId}&select=id,terms`)
 ]);
 const phoneList=permissions.map(p=>p.phone).join(','),keyList=permissions.map(p=>p.contact_key).join(',');
 const [textSuppression,voiceSuppression]=permissions.length?await Promise.all([
 db<{phone:string}[]>(`icash_text_suppressions?phone=in.(${encodeURIComponent(phoneList)})&select=phone`),
 db<{contact_key:string}[]>(`icash_contact_suppressions?contact_key=in.(${keyList})&select=contact_key`)
 ]):[[],[]];
 const deal=deals[0];
 const [purchases,marketing]=deal?await Promise.all([
 db<{id:string}[]>(`icash_signing_envelopes?account_id=eq.${accountId}&deal_id=eq.${deal.id}&kind=eq.purchase&state=eq.completed&test_mode=eq.false&select=id`),
 db<{purchase_envelope_id:string;asking_price_cents:number;expires_at:string}[]>(`icash_disposition_authorities?account_id=eq.${accountId}&deal_id=eq.${deal.id}&select=purchase_envelope_id,asking_price_cents,expires_at`)
 ]):[[],[]];
 const authority=marketing[0],wallet=wallets[0];
 const items=authorityReviewStatus({identity:!!identities[0]?.principal,availableCents:wallet?wallet.balance_cents-wallet.reserved_cents:0,paused:accounts[0]?.bot_paused!==false,permissions:permissions.map(p=>({...p,suppressed:textSuppression.some(s=>s.phone===p.phone)||voiceSuppression.some(s=>s.contact_key===p.contact_key)})),offer:offers[0]??null,purchaseSigned:purchases.length>0,marketing:authority?{expires_at:authority.expires_at,purchaseMatches:purchases.some(p=>p.id===authority.purchase_envelope_id),priceMatches:Number.isSafeInteger(deal.terms.priceCents)&&Number.isSafeInteger(deal.terms.assignmentFeeCents)&&authority.asking_price_cents===deal.terms.priceCents!+deal.terms.assignmentFeeCents!}:null,now:Date.now()});
 const contractCoverage=await readContractCoverage();
 const capability=contractCapability(contractCoverage,deal?.terms.state??null,1);
 items.push({key:'contract_templates',title:'Contract market coverage',status:capability.supported?'recorded':'review_required',detail:capability.reason+' This check covers one required seller; additional owners need the matching reviewed documents.',action:capability.supported?'none':'operator_review'});
 // Expose customer next steps, never raw phone numbers, suppression evidence or operator records.
 return NextResponse.json({screeningId,items,contractCoverage,notice:'These are saved review records. They do not replace legal review or guarantee that a task can run.'},{headers});
 }catch{return NextResponse.json({error:'Review status is unavailable. Your saved work is unchanged.'},{status:503,headers});}
}
