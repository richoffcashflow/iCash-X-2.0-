/** Server-side, non-billable checks only. No property/contact retrieval is exposed. */
import { z } from 'zod';
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usageSchema = z.object({
 plan: z.object({ name: z.string(), is_paid: z.boolean() }),
 billing_cycle: z.object({ start: z.string().datetime({offset:true}), end: z.string().datetime({offset:true}) }),
 credits: z.object({ total_cap: count, total_available: count, used: count })
});
const estimateSchema = z.object({ estimated_credits: z.object({ this_page: count, total_all_pages: count }) });
const countSchema = z.object({ total_properties: count, total_people: count, total_results: count });
const querySchema = z.object({ zip: z.string().regex(/^\d{5}$/), perPage: z.number().int().min(1).max(25).default(10) }).strict();
export class DealMachinePreflightError extends Error {
 status: number;
 constructor(status:number) { super(`DealMachine preflight failed (${status || 'network or invalid response'}).`); this.name='DealMachinePreflightError'; this.status=status; }
}
export function createDealMachinePreflight(apiKey:string, transport:typeof fetch=fetch) {
 if(typeof window!=='undefined') throw new Error('DealMachine is server-only');
 if(!apiKey || !/^dm_sk_live_[A-Za-z0-9_-]+$/.test(apiKey)) throw new Error('A newer DealMachine API key is required');
 // Intentionally private: callers cannot supply a URL, endpoint or paid-search body.
 async function request(path:'/usage'|'/properties/search/count'|'/properties/search',body?:object):Promise<unknown> {
  let response:Response;
  try { response=await transport(`https://api.v2.dealmachine.com/v1${path}`,{
   method:body?'POST':'GET',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
   body:body?JSON.stringify(body):undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)
  }); } catch { throw new DealMachinePreflightError(0); }
  if(!response.ok) throw new DealMachinePreflightError(response.status);
  // Provider bodies and credentials are never put in error messages or logs.
  try { return await response.json(); } catch { throw new DealMachinePreflightError(0); }
 }
 function parse<T>(schema:z.ZodType<T>,value:unknown):T {
  const result=schema.safeParse(value);if(!result.success) throw new DealMachinePreflightError(0);return result.data;
 }
 return {
  async usage(){return parse(usageSchema,await request('/usage'));},
  async countProperties(zip:string){
   const q=querySchema.parse({zip});
   return parse(countSchema,await request('/properties/search/count',{locations:[{type:'zip_code',code:q.zip}],anchor:'properties'}));
  },
  async estimateProperties(input:{zip:string;perPage?:number}){
   const q=querySchema.parse(input);
   return parse(estimateSchema,await request('/properties/search',{
    locations:[{type:'zip_code',code:q.zip}],anchor:'properties',contact_audience:'none',page:1,per_page:q.perPage,estimate_cost:true
   }));
  }
 };
}
