import assert from 'node:assert/strict';
import {db} from '../lib/stripe-test.ts';
const original=globalThis.fetch;
process.env.SUPABASE_URL='https://database.example.invalid';process.env.SUPABASE_SECRET_KEY='fixture';
try {
 globalThis.fetch=async()=>new Response(null,{status:204});
 assert.equal(await db('rpc/fixture','POST',{}),null);
 globalThis.fetch=async()=>Response.json({ok:true});assert.deepEqual(await db('fixture'),{ok:true});
 globalThis.fetch=async()=>new Response('private provider text',{status:400});
 await assert.rejects(()=>db('fixture'),{message:'Database request failed'});
} finally {globalThis.fetch=original;}
console.log('Void RPC, JSON response and safe database errors passed');
