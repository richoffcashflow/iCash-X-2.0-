import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const pg=await PGlite.create(),q=(sql,args=[])=>pg.query(sql,args),one=async(sql,args=[])=>(await q(sql,args)).rows[0];
const guest=()=>createHash('sha256').update(randomUUID()).digest('hex');
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table public.icash_seller_intakes(id uuid primary key default gen_random_uuid(),state text default 'received',numbers_passed boolean default false,market_qualified boolean default false,checked_at timestamptz,created_at timestamptz default now(),attribution jsonb default '{}');`);
 await pg.exec(readFileSync(new URL('../config/homeoffer-optin-conversion.sql',import.meta.url),'utf8'));
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261017200212_homeoffer_ad_links.sql',import.meta.url),'utf8'));
 const visit=async(g,slug='hon-i01',legacy='')=>(await one('select icash_visit_seller_ad($1,$2,$3) ok',[g,slug,legacy])).ok;
 const lead=async(g,patch={},state='received')=>(await one('insert into icash_seller_intakes(attribution,state) values($1,$2) returning id',[{optinGuest:g,...patch},state])).id;
 const report=async()=>(await one('select icash_seller_ad_report() r')).r;
 assert.equal((await report()).length,10);assert((await report()).every(r=>r.visitors===0&&r.responses===0),'Seed links never invent performance');
 const g=guest();assert.equal(await visit(g),true);await visit(g);assert.equal((await report())[0].visitors,1,'Reloads count once per creative');
 await visit(g,'hon-v01');const l=await lead(g);
 let rows=await report();assert.equal(rows.find(r=>r.slug==='hon-i01').responses,0);assert.equal(rows.find(r=>r.slug==='hon-v01').responses,1,'Only last ad receives conversion');
 await lead(g);assert.equal((await report()).find(r=>r.slug==='hon-v01').responses,1,'A second form request cannot inflate visitor response rate');
 assert.equal((await one('select count(*)::int n from icash_seller_ad_visits where lead_id=$1',[l])).n,1);
 await q("update icash_seller_intakes set state='qualified',numbers_passed=true,market_qualified=true,checked_at=now() where id=$1",[l]);assert.equal((await report()).find(r=>r.slug==='hon-v01').qualified,1);
 const legacy=guest();assert.equal(await visit(legacy,'','hon_image_02_sell_as_is_20261016'),true);await lead(legacy);assert.equal((await report()).find(r=>r.slug==='hon-i02').responses,1,'Existing ad-pack URLs remain attributable');
 assert.equal(await visit(guest(),'does-not-exist','hon_image_02_sell_as_is_20261016'),false);assert.equal(await visit('bad'),false);assert.equal(await visit(guest(),''),false);
 const dup=guest(),privateGuest=guest(),expired=guest(),unseen=guest();await visit(dup,'hon-i03');await lead(dup,{},'duplicate');await visit(privateGuest,'hon-i03');await lead(privateGuest,{measurementOptOut:true});await lead(unseen);
 await visit(expired,'hon-i03');await q("update icash_seller_ad_visits set first_seen_at=now()-interval '32 days',last_seen_at=now()-interval '31 days' where guest_hash=$1",[expired]);await lead(expired);
 assert.equal((await report()).find(r=>r.slug==='hon-i03').responses,0,'Duplicates, privacy opt-outs, unseen visitors and expired touches do not convert');
 // The existing landing-page experiment and the creative report remain independent.
 const both=guest();await q("select icash_open_seller_optin($1,'ready','meta','fixture','mobile')",[both]);await q("select icash_record_seller_optin_event($1,'view')",[both]);await visit(both,'hon-i04');await lead(both);
 assert.equal((await one('select icash_seller_optin_report() r')).r[0].submissions,1);assert.equal((await report()).find(r=>r.slug==='hon-i04').responses,1);
 for(const role of ['anon','authenticated']){
  for(const table of ['icash_seller_ad_links','icash_seller_ad_visits'])assert.equal((await one('select has_table_privilege($1,$2,\'select\') ok',[role,table])).ok,false);
  for(const fn of ['icash_seller_ad_report()','icash_visit_seller_ad(text,text,text)'])assert.equal((await one('select has_function_privilege($1,$2,\'execute\') ok',[role,fn])).ok,false);
 }
 assert.equal((await one("select count(*)::int n from pg_class where relname in ('icash_seller_ad_links','icash_seller_ad_visits') and relrowsecurity")).n,2);
 console.log('PASS ad attribution: ten empty links, repeat-visit dedup, last touch, one response per visitor/ad, legacy URLs, qualification, exclusions, existing experiment, and owner-only data.');
}finally{await pg.close();}
