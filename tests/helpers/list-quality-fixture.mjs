import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as targeting from './targeting-query-binding-fixture.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const before=JSON.parse(read('tests/fixtures/dealmachine-list-quality-before.json'));
export const migration=read('supabase/migrations/20261109015640_dealmachine_list_quality.sql');
export const core=read('config/dealmachine-list-quality-core.sql');
export const account='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',screen='00000000-0000-4000-8000-000000000030';
export const coreSetup=`
 create schema icash_research_private;
 create table icash_operating_budget(id int primary key);insert into icash_operating_budget values(1);
 create table icash_owner_contacts(account_id uuid,screening_id uuid primary key,result jsonb);
 create table icash_text_threads(id uuid primary key,account_id uuid,recipient text,party text);
 create table icash_text_messages(id uuid primary key,account_id uuid,thread_id uuid,direction text,state text,provider_id text,event_id uuid,created_at timestamptz);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,state text,dispatched_at timestamptz);
`;
export const helpers=`
 create function icash_operational_phone(text) returns text language sql immutable as $$select case when $1 ~ '^[0-9]{10}$' then '+1'||$1 when $1 ~ '^\\+1[0-9]{10}$' then $1 end$$;
`+read('config/seller-response-policy.sql').match(/create function public.icash_seller_direct_response_match[\s\S]*?end \$fn\$;/)[0];
export const setup=targeting.setupSql+targeting.migration+`
 create table icash_operational_contacts(id uuid);
 create table icash_dnc_verification_receipts(id uuid);
 create table icash_dnc_verification_sources(id uuid);
`+helpers+before.map(d=>d.definition+';').join('\n');
export const person={personId:'per_1',likelyOwner:true,phones:[
 {number:'2145550101',type:'Landline',doNotCall:false,matchConfidence:99},
 {number:'2145550102',type:'Wireless',doNotCall:false,usage2Months:'Minimal'},
 {number:'2145550103',type:'Wireless',doNotCall:false,usage2Months:'Heavy'},
]};
export const source={requestedPersonIds:['per_1'],contacts:[person]};
export const seed=`insert into icash_owner_contacts(account_id,screening_id,result) values('${account}','${screen}','${JSON.stringify(source)}');update icash_research_private.list_quality_settings set enabled=true;`;
if(process.argv[1]===fileURLToPath(import.meta.url))process.stdout.write(JSON.stringify({coreSetup,helpers,core,seed,account,other,screen}));
