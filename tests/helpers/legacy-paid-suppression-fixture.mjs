import {readFileSync} from 'node:fs';
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const migration=read('config/legacy-paid-suppression-scope.sql');
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export async function install(db){
 const exec=s=>db.exec?db.exec(s):db.query(s);
 const original=read('tests/legacy-customer-launch.test.mjs');
 const setup=original.split('await pg.exec(`')[1].split('`);')[0];
 await exec(setup.replace('create role anon;create role authenticated;create role service_role;',''));
 for(const p of ['legacy-customer-launch','legacy-customer-phone-stop','legacy-launch-checkout-binding'])await exec(read('config/'+p+'.sql'));
 await exec('create index icash_membership_invoice_member on icash_membership_invoices(membership_id);create index billing_review_payment on icash_billing_reviews(payment_id)');
}
export async function seed(db){
 await db.query(`insert into icash_legacy_launches(id,slug,title,state) values($1,'fixture','Fixture','paused'),($2,'other','Other','paused')`,[id(1),id(2)]);
 await db.query(`insert into icash_legacy_contacts(id,launch_id,email,phone) values($1,$2,'buyer@example.invalid','+12125550101'),($3,$4,'buyer@example.invalid',null),($5,$2,'bound@example.invalid',null)`,[id(10),id(1),id(11),id(2),id(12)]);
 await db.query(`insert into icash_legacy_contacts(launch_id,email) select $1,'unrelated'||n||'@example.invalid' from generate_series(1,5000)n`,[id(1)]);
 await db.query(`insert into icash_memberships(id,mode,payer_email,payer_phone) values($1,'live',' BUYER@example.invalid ','+12125550101'),($2,'live',null,null),($3,'test','buyer@example.invalid',null)`,[id(100),id(101),id(102)]);
 await db.query('insert into icash_legacy_checkouts(contact_id,membership_id) values($1,$2)',[id(12),id(101)]);
 for(const state of ['queued','sending','uncertain','accepted','delivered','failed','cancelled'])await db.query(`insert into icash_legacy_outbox(launch_id,contact_id,step_id,channel,recipient,state,due_at,body,revision) select launch_id,id,$1,'email',email,$1,now(),'fixture',1 from icash_legacy_contacts where id=any($2::uuid[])`,[state,[id(10),id(11),id(12)]]);
}
export const receipt=(db,member,name,at='2026-01-02T00:00:00Z')=>db.query('insert into icash_membership_invoices values($1,$2,$3,$4) on conflict do nothing',[name,member,'payment_'+name,at]);
export const value=async(db,s,a=[])=>(await db.query(s,a)).rows[0]?.v;
