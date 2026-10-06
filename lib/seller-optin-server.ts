import {unstable_cache} from 'next/cache';
import {db} from '@/lib/stripe-test';
import {sellerOptinPlan, type SellerOptinRow} from '@/lib/seller-optin';

export async function sellerOptinReport() {
  const rows = await db<SellerOptinRow[]>('rpc/icash_seller_optin_report', 'POST', {});
  const groups = [...new Set(rows.map(r => `${r.source}:${r.device}`))].map(key => {
    const [source, device] = key.split(':');
    return {source, device, ...sellerOptinPlan(rows.filter(r => r.source === source && r.device === device))};
  });
  return {rows, groups};
}

// Aggregate-only cache. No cookies or visitor identifiers are cached.
export const sellerOptinRoutingRows = unstable_cache(
  () => db<SellerOptinRow[]>('rpc/icash_seller_optin_report', 'POST', {}),
  ['homeoffer-optin-v1-routing'],
  {revalidate: 300},
);
