import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {loadService} from './helpers/simulated-journey-services.mjs';
const pg=await PGlite.create();
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create table icash_accounts(owner_user_id uuid);
 create table icash_funding_orders(payer_email text,state text,mode text);
 create table icash_memberships(payer_email text,mode text,state text,paid_through timestamptz,account_id uuid);
 insert into icash_memberships values('new@example.invalid','live','active',now()+interval '30 days',null),('unpaid@example.invalid','live','pending',null,null),('expired@example.invalid','live','active',now()-interval '1 second',null),('refund@example.invalid','live','needs_review',now()+interval '30 days',null),('test@example.invalid','test','active',now()+interval '30 days',null);
 insert into auth.users values('00000000-0000-4000-8000-000000000001','returning@example.invalid',now());insert into icash_accounts values('00000000-0000-4000-8000-000000000001');`);
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261017150110_purchase_email_signin_eligibility.sql',import.meta.url),'utf8'));
 const eligible=async(email,mode='live')=>(await pg.query('select icash_can_sign_in($1,$2) as ok',[email,mode])).rows[0].ok;
 assert.equal(await eligible(' NEW@example.invalid '),true,'First subscription qualifies without credit purchase or prior account');
 assert.equal(await eligible('returning@example.invalid'),true);
 for(const email of ['unknown@example.invalid','unpaid@example.invalid','expired@example.invalid','refund@example.invalid','test@example.invalid'])assert.equal(await eligible(email),false,email);
 assert.equal(await eligible('test@example.invalid','test'),true);assert.equal(await eligible('new@example.invalid','fake'),false);
 let requests=[];process.env.ICASH_AUTH_EMAIL_READY='true';
 const {POST}=await loadService('app/api/auth/email/route.ts',{accountMode:()=> 'live',NextResponse:{json:Response.json},allowedOrigin:()=>true,normalizeEmail:s=>s.trim().toLowerCase(),limitRequest:async()=>{},authRequest:async(path,body)=>requests.push({path,body}),db:async(path,method,args)=>{assert.equal(path,'rpc/icash_can_sign_in');return eligible(args.p_email,args.p_mode);}});
 const post=email=>POST(new Request('https://www.geticashx.com/api/auth/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})}));
 const known=await (await post('new@example.invalid')).json();assert.deepEqual(requests,[{path:'otp',body:{email:'new@example.invalid',create_user:true}}],'Real auth route requests a sign-in code for a new buyer');
 const unknown=await (await post('unknown@example.invalid')).json();assert.deepEqual(unknown,known,'Unknown email remains non-enumerable');assert.equal(requests.length,1);
 await pg.exec('set role anon');await assert.rejects(()=>pg.query("select icash_can_sign_in('new@example.invalid','live')"));await pg.exec('reset role');
 console.log('PASS new-buyer sign-in: live subscription without credits/account, real auth route, existing accounts, mode, paid/expired/review gates and no email enumeration. No real OTP.');
}finally{await pg.close();}
