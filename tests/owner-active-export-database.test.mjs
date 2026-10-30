// Real isolated PostgreSQL engine; synthetic accounts and explicit financial
// admission fixtures. No provider requests, credentials or production writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {ownerBatchAudience} from '../lib/owner-batch.ts';
import {activeOwnerColumns,activeOwnerExportRequest,parseOwnerExportCsv,allocateActiveOwnerExport} from '../lib/owner-active-export.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),db=new PGlite();
const q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,account=id(1),other=id(2),rate=id(3),batch=id(4),screen=id(5),second=id(6);
const rpc=(name,args)=>v('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args);
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema icash_research_private;
 create table public.icash_accounts(id uuid primary key,bot_paused boolean default false);
 create table public.icash_operating_budget(id integer primary key);
 create table public.icash_discovery_configs(account_id uuid primary key,research_version integer,contact_rate_id uuid,contact_credit_cap integer,property_credit_micros bigint,data_rights_until timestamptz,contacts_enabled boolean default true);
 create table public.icash_operation_rates(id uuid primary key,costs_micros jsonb);
 create table public.icash_operation_spend(operation_key text primary key,account_id uuid,rate_id uuid,state text default 'reserved',settled_used numeric);
 create table public.icash_screening_jobs(id uuid primary key,account_id uuid,state text,snapshot jsonb);
 create table public.icash_automation_tickets(screening_id uuid);
 create table public.icash_owner_contacts(screening_id uuid primary key,account_id uuid,operation_key text,result jsonb,created_at timestamptz default now());
 create table public.icash_cost_observations(provider text,event_key text primary key,source_ref text,amount numeric,units text);
 create table icash_research_private.owner_batches(id uuid primary key,account_id uuid,primary_screening uuid,created_at timestamptz default now(),state text default 'claimed',items jsonb,preview_receipt jsonb,paid_receipt jsonb,results jsonb);
 create table icash_research_private.owner_batch_items(screening_id uuid primary key,batch_id uuid,operation_key text);
 create table icash_research_private.requests(id uuid primary key,kind text,account_id uuid,operation_key text,admitted boolean);
 create table fixture_quota(available boolean);insert into fixture_quota values(true);
 create function public.icash_membership_work_allowed(uuid) returns boolean language sql as $$select true$$;
 create function public.icash_take_dealmachine_request(text,uuid,text,uuid) returns boolean language plpgsql as $$declare ok boolean;begin select available into ok from public.fixture_quota;insert into icash_research_private.requests values($4,$1,$2,$3,ok);return ok;end$$;
 create function public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean) returns void language sql as $$insert into public.icash_operation_spend(operation_key,account_id,rate_id) values($2,$1,$3)$$;
 create function public.icash_claim_owner_enrichment(uuid,uuid,text,jsonb,uuid,integer,bigint,bigint,timestamptz) returns boolean language plpgsql as $$begin update public.icash_operation_spend set state='dispatched' where operation_key=$3 and account_id=$1 and exists(select 1 from public.icash_screening_jobs where id=$2 and account_id=$1 and snapshot=$4 and state='complete');return found;end$$;
 create function public.icash_record_cost_observation(text,text,text,numeric,text) returns void language sql as $$insert into public.icash_cost_observations values($1,$2,$3,$4,$5) on conflict do nothing$$;
 create function public.icash_settle_dealmachine_usage(text) returns boolean language plpgsql as $$begin update public.icash_operation_spend o set state='settled',settled_used=(select amount from public.icash_cost_observations where event_key=$1) where operation_key=$1 and exists(select 1 from public.icash_cost_observations where event_key=$1);return found;end$$;
 create function public.icash_dealmachine_request_started_at(jsonb) returns timestamptz language sql immutable as $$select ($1->>'fetchedAt')::timestamptz$$;
 `);
 for(const d of JSON.parse(read('tests/fixtures/owner-export-before.json')))await db.exec(d.definition);
 const source=read('config/research-request-efficiency.sql');
 await db.exec(source.match(/create function public.icash_record_owner_batch_receipt[\s\S]*?end \$\$;/)[0]);
 await db.exec(read('config/owner-batch-quota-admission.sql').match(/create function public.icash_admit_owner_batch[\s\S]*?end \$\$;/)[0]);
 await db.exec(JSON.parse(read('tests/fixtures/research-efficiency-before.json')).find(x=>x.proname==='icash_save_contacts').definition);
 await db.exec(read('config/owner-active-export.sql'));
 // Exercise the production migration against the exact previous guard, and
 // require it to produce the same function as a clean installation.
 const currentDefinition=await v("select pg_get_functiondef('public.icash_save_owner_active_export(uuid,uuid,jsonb,jsonb)'::regprocedure)");
 const migration=read('supabase/migrations/20261030004249_owner_export_filtered_credits.sql');
 const oldGuard=migration.match(/\$old\$([\s\S]*?)\$old\$/)[1],newGuard=migration.match(/\$new\$([\s\S]*?)\$new\$/)[1];
 assert(currentDefinition.includes(newGuard));await db.exec(currentDefinition.replace(newGuard,oldGuard));
 await db.exec(migration);assert.equal(await v("select pg_get_functiondef('public.icash_save_owner_active_export(uuid,uuid,jsonb,jsonb)'::regprocedure)"),currentDefinition);
 // Apply the exact targeting export additions on top of PR488/489, then run
 // both mobile cases and every original active-pool/billing regression below.
 await db.exec(`create table icash_research_private.targeting_settings(id int,mobile_verified boolean);insert into icash_research_private.targeting_settings values(1,false);
 create table icash_discovery_filter_attribution(account_id uuid,screening_id uuid,operation_key text);
 create table icash_discovery_filter_pages(account_id uuid,operation_key text,plan jsonb);`);
 const targeting=read('config/dealmachine-targeting-experiments.sql');
 await db.exec(targeting.match(/create function public.icash_owner_targeting_pool\([\s\S]*?end \$patch\$;/)[0]);
 await q('insert into icash_accounts(id) values($1),($2)',[account,other]);await q('insert into icash_operating_budget values(1)');
 await q('insert into icash_operation_rates values($1,$2)',[rate,{dealmachine:250000}]);
 for(const a of [account,other])await q('insert into icash_discovery_configs values($1,2,$2,25,10000,$3,true)',[a,rate,'2099-01-01']);
 const items=[screen,second].map((s,i)=>({screeningId:s,snapshot:{propertyId:'prop_'+(i+1)},ids:i===0?['per_9007199254740993123']:['per_9007199254740993123','per_2','per_3','per_4']}));
 const preview={data:items.map(i=>({dm_property_id:i.snapshot.propertyId,found:true,contacts:i.ids.map(dm_person_id=>({dm_person_id,contact_type:'owner',availability:{phones:3}}))})),totals:{submitted:2,found:2,not_found:0},credits:{used:0,people:0,properties:0,deduplicated:0}};
 for(const i of items)await q('insert into icash_screening_jobs values($1,$2,\'complete\',$3)',[i.screeningId,account,i.snapshot]);
 const config={rateId:rate,creditCap:25,unitCostMicros:10000,rightsUntil:'2099-01-01'},request=activeOwnerExportRequest([...new Set(items.flatMap(i=>i.ids))]);
 const admit=(b=batch,a=account,its=items,pr=preview,req=request)=>rpc('icash_admit_owner_active_export',[a,its[0].screeningId,b,its,pr,config,req]);
 assert.equal(await admit(),'held');assert.equal(Number(await v('select count(*) from icash_operation_spend')),0);
 await db.exec('update icash_research_private.owner_export_settings set enabled=true');
 for(const returned of [0,1]){
  await db.exec('begin;');
  await q("insert into icash_discovery_filter_pages values($1,'mobile',$2)",[account,{version:'seller-targeting-v1',targeting:{segment:'mobile'}}]);
  await q("insert into icash_discovery_filter_attribution values($1,$2,'mobile')",[account,screen]);
  const mobileRequest=activeOwnerExportRequest(request.people_ids,true);
  assert.equal(await admit(batch,account,items,preview,mobileRequest),'held','Unverified mobile option stays inactive');
  await db.exec('update icash_research_private.targeting_settings set mobile_verified=true');
  assert.equal(await admit(batch,account,items,preview,mobileRequest),'held','Mixed active/mobile cohorts cannot share a paid batch');
  await q("insert into icash_discovery_filter_attribution values($1,$2,'mobile')",[account,second]);
  assert.equal(await admit(),'held','A mobile cohort cannot silently switch back to active phones');
  assert.equal(await admit(batch,account,items,preview,mobileRequest),'claimed');
  const raw={export_id:'mobile-fixture',record_count:returned,file_count:1,credits:{used:returned,people:4}};
  await rpc('icash_record_owner_export_receipt',[account,batch,{httpStatus:200,raw,rawText:JSON.stringify(raw)}]);
  const saved=await rpc('icash_claim_owner_export_recovery',[batch]);
  await rpc('icash_record_owner_export_recovery',[batch,saved.lease,{httpStatus:200,raw:{data:{...raw,status:'completed'}}}]);
  const rows=returned?[Object.fromEntries(activeOwnerColumns.map(k=>[k,({internal_person_id:'9007199254740993123',person_full_name:'Synthetic Owner',phone_1:'2145550100',is_phone_1_dnc:'No',people_phone_1_type_id:'Wireless',has_active_phone_number:'Yes'})[k]??'']))]:[];
  const csv=[activeOwnerColumns,...rows.map(r=>activeOwnerColumns.map(k=>r[k]))].map(r=>r.join(',')).join('\n')+'\n';
  if(returned){
   await db.exec('savepoint invalid_mobile;');
   const invalidRows=rows.map(r=>({...r,people_phone_1_type_id:'Landline'})),invalidCsv=csv.replace('Wireless','Landline');
   await rpc('icash_record_owner_export_artifact',[batch,saved.lease,invalidCsv]);
   const proposed=allocateActiveOwnerExport(saved,csv,ownerBatchAudience(preview,items,25));
   await assert.rejects(rpc('icash_save_owner_active_export',[batch,saved.lease,proposed,invalidRows]),/non-wireless/);
   await db.exec('rollback to invalid_mobile;');
  }
  await rpc('icash_record_owner_export_artifact',[batch,saved.lease,csv]);
  const allocated=allocateActiveOwnerExport(saved,csv,ownerBatchAudience(preview,items,25));
  assert.equal(await rpc('icash_save_owner_active_export',[batch,saved.lease,allocated,rows]),true);
  assert.equal(Number(await v('select sum(settled_used) from icash_operation_spend')),returned,'Only actual used credits settle, including an empty mobile export');
  assert.equal(await rpc('icash_claim_owner_export_recovery',[batch]),null,'No fallback purchase after mobile filtering');
  assert.equal(await rpc('icash_owner_targeting_pool',[other,screen]),'active','Attribution cannot cross accounts');
  await db.exec('rollback;');
 }
 await db.exec('begin;update icash_discovery_configs set research_version=0;');
 assert.equal(await admit(),'held','Legacy single-property path cannot acquire a batch');
 assert.equal(await admit(batch,account,[items[0]],preview,activeOwnerExportRequest(items[0].ids)),'claimed');
 await db.exec('rollback;');
 for(const change of [r=>{r.scrub_dnc=false;},r=>{r.active_phones_only=false;},r=>{r.fields.push('property_address');},r=>{r.people_ids.push('per_999');},r=>{r.anchor='phone';}]){const r=structuredClone(request);change(r);assert.equal(await admit(batch,account,items,preview,r),'held');}
 const weak=structuredClone(preview);weak.data[0].contacts[0].contact_type='renter';assert.equal(await admit(batch,account,items,weak),'held');
 await db.exec('update fixture_quota set available=false');assert.equal(await admit(),'quota_wait');assert.equal(Number(await v('select count(*) from icash_operation_spend')),0);await db.exec('update fixture_quota set available=true;delete from icash_research_private.requests;');
 assert.equal(await admit(),'claimed');assert.equal(await admit(id(7),other),'export_busy');assert.equal(Number(await v('select count(*) from icash_research_private.requests')),1);
 // Pending unknown operations do not become replayable with time or a lease.
 assert.equal(await rpc('icash_claim_owner_export_recovery',[batch]),null);assert.equal(await admit(),'export_busy');
 await db.exec('begin;');
 const failure={httpStatus:500,raw:{error:'Synthetic unknown provider error'},rawText:JSON.stringify({error:'Synthetic unknown provider error'})};
 assert.equal(await rpc('icash_record_owner_export_receipt',[account,batch,failure]),true);
 assert.equal(await rpc('icash_claim_owner_export_recovery',[batch]),null);
 assert.equal(await admit(id(7),other),'export_busy');
 assert.equal(Number(await v('select count(*) from icash_cost_observations')),0,'Missing cost never becomes zero');
 await db.exec('rollback;');
 // Four evaluated owners can yield one active owner. Preserve raw people=4,
 // settle only used=1, and save no contacts/charge for the filtered property.
 const filteredRows=[Object.fromEntries(activeOwnerColumns.map(k=>[k,({internal_person_id:'2',person_full_name:'Synthetic Owner',phone_1:'2145550102',is_phone_1_dnc:'No',people_phone_1_type_id:'Wireless',has_active_phone_number:'Yes'})[k]??'']))];
 const filteredCsv=[activeOwnerColumns,...filteredRows.map(r=>activeOwnerColumns.map(k=>r[k]))].map(r=>r.join(',')).join('\n')+'\n';
 for(const credits of [{used:1,people:4},{used:2,people:4},{used:1,people:0},{used:1,people:5},{used:1,people:'4'},{used:1,people:1.5},{used:1}]){
  await db.exec('begin;');
  const raw={export_id:'filtered-fixture',record_count:1,file_count:1,credits};
  assert.equal(await rpc('icash_record_owner_export_receipt',[account,batch,{httpStatus:200,raw,rawText:JSON.stringify(raw)}]),true);
  const saved=await rpc('icash_claim_owner_export_recovery',[batch]);assert(saved?.lease);
  assert.equal(await rpc('icash_record_owner_export_recovery',[batch,saved.lease,{httpStatus:200,raw:{data:{...raw,status:'completed'}}}]),true);
  assert.equal(await rpc('icash_record_owner_export_artifact',[batch,saved.lease,filteredCsv]),true);
  const validSaved=structuredClone(saved);validSaved.receipt.raw.credits={used:1,people:4};
  const allocated=allocateActiveOwnerExport(validSaved,filteredCsv,ownerBatchAudience(preview,items,25));
  if(credits.people===4&&credits.used===1){
   assert.equal(await rpc('icash_save_owner_active_export',[batch,saved.lease,allocated,filteredRows]),true);
   assert.deepEqual(allocated.map(a=>[a.result.contacts.length,a.result.creditsUsed]),[[0,0],[1,1]]);
   assert.equal(Number(await v('select sum(settled_used) from icash_operation_spend')),1);
   assert.deepEqual(await v('select result->\'providerCredits\' from icash_owner_contacts where screening_id=$1',[second]),credits);
   assert.deepEqual(await v('select receipt->\'raw\'->\'credits\' from icash_research_private.owner_exports where id=$1',[batch]),credits);
  }else{
   await assert.rejects(rpc('icash_save_owner_active_export',[batch,saved.lease,allocated,filteredRows]));
   await db.exec('rollback;');continue;
  }
  await db.exec('rollback;');
 }
 const raw={export_id:'export-fixture',record_count:2,file_count:1,credits:{used:1,people:2}},receipt={httpStatus:200,raw,rawText:JSON.stringify(raw)};
 assert.equal(await rpc('icash_record_owner_export_receipt',[other,batch,receipt]),false);
 assert.equal(await rpc('icash_record_owner_export_receipt',[account,batch,receipt]),true);
 assert.equal(await rpc('icash_record_owner_export_receipt',[account,batch,{...receipt,httpStatus:500}]),false);
 const saved=await rpc('icash_claim_owner_export_recovery',[batch]);assert(saved?.lease);assert.equal(await rpc('icash_claim_owner_export_recovery',[batch]),null);
 assert.equal(await rpc('icash_record_owner_export_recovery',[batch,id(99),{httpStatus:200,raw:{data:raw}}]),false);
 assert.equal(await rpc('icash_record_owner_export_recovery',[batch,saved.lease,{httpStatus:200,raw:{data:{...raw,status:'completed'}}}]),true);
 const rows=['9007199254740993123','2'].map((n,i)=>Object.fromEntries(activeOwnerColumns.map(k=>[k,({internal_person_id:n,person_full_name:'Synthetic Owner',phone_1:'214555010'+i,is_phone_1_dnc:'No',people_phone_1_type_id:'Wireless',has_active_phone_number:'Yes'})[k]??''])));
 const csv=[activeOwnerColumns,...rows.map(r=>activeOwnerColumns.map(k=>r[k]))].map(r=>r.join(',')).join('\n')+'\n';
 assert.equal(await rpc('icash_record_owner_export_artifact',[batch,saved.lease,csv]),true);
 const allocated=allocateActiveOwnerExport(saved,csv,ownerBatchAudience(preview,items,25));
 const changed=structuredClone(allocated);changed[1].result.creditsUsed=1;
 await assert.rejects(rpc('icash_save_owner_active_export',[batch,saved.lease,changed,rows]),/allocation or source/);assert.equal(Number(await v('select count(*) from icash_owner_contacts')),0);
 const fabricated=structuredClone(allocated);fabricated[0].result.providerCredits.deduplicated=1;
 await assert.rejects(rpc('icash_save_owner_active_export',[batch,saved.lease,fabricated,rows]),/allocation or source/);
 assert.equal(await rpc('icash_save_owner_active_export',[batch,saved.lease,allocated,parseOwnerExportCsv(csv)]),true);
 assert.equal(await rpc('icash_save_owner_active_export',[batch,saved.lease,allocated,rows]),true);
 assert.equal(Number(await v('select sum(settled_used) from icash_operation_spend')),1);
 assert.equal(Number(await v('select count(*) from icash_cost_observations')),2,'Only actual allocated used credits, no invented dedup observations');
 assert.equal(await rpc('icash_dealmachine_saved_owner_result_valid',[allocated[1].result]),true);
 assert(await rpc('icash_dealmachine_owner_source_started_at',[account,second]));
 assert.equal(await rpc('icash_dealmachine_owner_source_started_at',[other,second]),null);
 await assert.rejects(q('update icash_research_private.owner_exports set csv=\'changed\' where id=$1',[batch]),/immutable/);
 await assert.rejects(q('delete from icash_research_private.owner_exports where id=$1',[batch]),/immutable/);
 assert.equal(await rpc('icash_claim_owner_export_recovery',[batch]),null);
 for(const role of ['anon','authenticated'])for(const sig of ['icash_admit_owner_active_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)','icash_claim_owner_export_recovery(uuid)','icash_save_owner_active_export(uuid,uuid,jsonb,jsonb)'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,'public.'+sig]),false);
 assert.equal(await v("select has_table_privilege('service_role','icash_research_private.owner_exports','select')"),false);
 console.log('Owner export SQL: disabled rollout, exact scope, quota-before-money, global serialization, immutable receipts, original recovery leases, raw-credit allocation, tenant-bound source, atomic settlement and restricted grants passed.');
}finally{await db.close();}
