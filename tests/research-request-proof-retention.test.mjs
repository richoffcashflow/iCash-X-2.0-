import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,proofs=['preview_rejection_recoveries','stalled_searches','owner_empty_preview_receipts','export_capacity_probes'];
try{
 await pg.exec(read('tests/fixtures/owner-preflight-foundation.sql'));await pg.exec(read('config/owner-export-preflight.sql'));await pg.exec(read('tests/fixtures/owner-preflight-quota.sql'));
 for(const name of proofs)await pg.exec(`create table icash_research_private.${name}(request_id uuid primary key references icash_research_private.requests(id));`);
 await pg.exec('create table icash_research_private.quota_feedback(id int primary key,request_id uuid references icash_research_private.requests(id) on delete set null)');
 for(let i=0;i<proofs.length;i++){await q("insert into icash_research_private.requests(id,kind,admitted,created_at) values($1,'owner_preview',true,now()-interval '40 days')",[id(100+i)]);await q(`insert into icash_research_private.${proofs[i]} values($1)`,[id(100+i)]);}
 await assert.rejects(v('select icash_prune_research_requests()'),/foreign key/,'Reproduce unrelated old diagnostic cleanup blocked by permanent source evidence');
 await pg.exec(read('config/owner-preflight-quota-recovery.sql'));
 await q('insert into icash_accounts values($1,false)',[id(1)]);
 await q("insert into icash_research_private.owner_export_preflights(id,account_id,fingerprint,items,request,state,list_name) values($1,$2,'retention-fixture','[]','{}','creating','retention-fixture')",[id(2),id(1)]);
 await q("insert into icash_research_private.requests(id,kind,admitted,created_at) values($1,'owner_preview',false,now()-interval '40 days')",[id(104)]);
 await q("insert into icash_research_private.owner_preflight_quota_deferrals(request_id,preflight_id,lease,step,started_at,receipts_hash) values($1,$2,$3,'create',now(),'retention-fixture')",[id(104),id(2),id(3)]);
 // More unreferenced diagnostics than the existing 10,000-row cap. Permanent
 // evidence is older, so exclusions must occur before LIMIT to avoid starvation.
 await pg.exec("insert into icash_research_private.requests(id,kind,admitted,created_at) select md5('unrelated-'||n)::uuid,'owner_preview',true,now()-interval '35 days'+n*interval '1 second' from generate_series(1,10002) n");
 await pg.exec("insert into icash_research_private.quota_feedback values(1,md5('unrelated-1')::uuid)");
 const expected=await v("select jsonb_agg(id order by created_at) from (select id,created_at from icash_research_private.requests where created_at>now()-interval '36 days' order by created_at desc limit 2) last_rows");
 assert.equal(await v('select icash_prune_research_requests()'),10000,'Preserve the existing bounded batch size');
 for(const n of [100,101,102,103,104])assert.equal(await v('select count(*)::int from icash_research_private.requests where id=$1',[id(n)]),1,'Each permanent proof keeps its source');
 assert.equal(await v('select request_id from icash_research_private.quota_feedback where id=1'),null,'Keep quota metadata ON DELETE SET NULL semantics');
 assert.deepEqual(await v("select jsonb_agg(id order by created_at) from icash_research_private.requests where created_at>now()-interval '36 days'"),expected,'Oldest unrelated diagnostics are removed first');
 assert.equal(await v('select icash_prune_research_requests()'),2);assert.equal(await v('select icash_prune_research_requests()'),0);
 assert.equal(await v('select count(*)::int from icash_research_private.requests'),5);
 console.log('PASS research diagnostic retention: all five permanent proof sources survive, unrelated old rows prune oldest-first within the unchanged 10,000 cap, nullable feedback still clears.');
}finally{await pg.close();}
