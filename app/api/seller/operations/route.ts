import {sellerOptinReport} from '@/lib/seller-optin-server';
import {z} from 'zod';
import {sellerDemandPlan,type SellerDemandStats} from '@/lib/seller-demand';
import {currentUser} from '@/lib/account-auth';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {sellerJourneyReadiness} from '@/lib/seller-journey-readiness';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
async function owner(){const user=await currentUser(true);if(user?.id!==ownerInboundTarget.ownerUserId)throw Error('OWNER_REQUIRED');return user;}
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('configure'),enabled:z.boolean(),lookupAllowanceCents:z.number().int().min(0).max(100000),dataRightsUntil:z.string().datetime(),reviewRef:z.string().trim().min(10).max(500),assignmentFeeCents:z.number().int().min(0).max(10000000),sellerCostReserveCents:z.number().int().min(0).max(10000000)}).strict(),
 z.object({action:z.literal('costs'),receiptId:z.string().trim().min(8).max(200),source:z.enum(['meta','google','youtube','tiktok','direct','other']),campaign:z.string().max(100).regex(/^[a-zA-Z0-9_-]*$/),periodStart:z.string().datetime(),periodEnd:z.string().datetime(),spendCents:z.number().int().min(0).max(100000000),evidenceRef:z.string().trim().min(10).max(500)}).strict()
]);
export async function GET(){try{await owner();const [controls,stats,demandStats,journey,optin]=await Promise.all([db('icash_seller_controls?id=eq.1&select=*'),db('rpc/icash_seller_funnel_summary','POST',{}),db<SellerDemandStats>('rpc/icash_seller_demand_summary','POST',{}),sellerJourneyReadiness(db,process.env),sellerOptinReport().catch(()=>null)]);return Response.json({controls,stats,journey,optin,demand:sellerDemandPlan(demandStats),metaConfigured:process.env.META_SELLER_EVENTS_ENABLED==='true'&&!!process.env.META_SELLER_DATASET_ID&&!!process.env.META_SELLER_ACCESS_TOKEN&&!!process.env.META_GRAPH_VERSION,notice:'Completed research is assigned immediately when a funded account is eligible, at 3× its recorded research cost basis. Advertising reports do not delay delivery.'},{headers});}catch{return Response.json({error:'Platform owner access required.'},{status:403,headers});}}
export async function POST(req:Request){if(!allowedOrigin(req))return Response.json({error:'Invalid origin'},{status:403,headers});try{
 const user=await owner();const raw=await req.text();if(raw.length>3000)throw Error();const i=input.parse(JSON.parse(raw));
 if(i.action==='configure'){
  if(i.enabled&&Date.parse(i.dataRightsUntil)<=Date.now())throw Error();
  await db('icash_seller_controls?id=eq.1','PATCH',{enabled:i.enabled,lookup_allowance_micros:i.lookupAllowanceCents*10000,data_rights_until:i.dataRightsUntil,review_ref:i.reviewRef,assignment_fee_cents:i.assignmentFeeCents,seller_cost_reserve_cents:i.sellerCostReserveCents,updated_by:user.id,updated_at:new Date().toISOString()});
 }else await db('rpc/icash_allocate_seller_ad_cost','POST',{p_receipt:i.receiptId,p_source:i.source,p_campaign:i.campaign,p_start:i.periodStart,p_end:i.periodEnd,p_spend:i.spendCents*10000,p_evidence:i.evidenceRef,p_actor:user.id});
 return Response.json({saved:true},{headers});
 }catch{return Response.json({error:'Not saved. Check owner access, current review dates, and the completed spend receipt. Overlapping or conflicting receipts are rejected.'},{status:400,headers});}}
