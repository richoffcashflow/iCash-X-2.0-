// CLI gates execute only in a temporary fictional Git checkout, with a backend
// import sentinel and a provider sentinel. No real environment credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const root=mkdtempSync(join(tmpdir(),'discovery-cli-fixture-'));
try{
 for(const dir of ['scripts','lib'])mkdirSync(join(root,dir));
 writeFileSync(join(root,'package.json'),' {"type":"module"}');
 writeFileSync(join(root,'scripts/discovery-opener-refresh.mjs'),readFileSync(new URL('../scripts/discovery-opener-refresh.mjs',import.meta.url)));
 writeFileSync(join(root,'lib/discovery-opener-refresh.ts'),`export async function processDiscoveryOpenerRefresh(){console.log('PROVIDER_SENTINEL');throw Error('must not run');}`);
 writeFileSync(join(root,'lib/stripe-test.ts'),`console.log('BACKEND_IMPORT_SENTINEL');export async function db(){return false;}`);
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init');git('add','.');git('-c','user.name=Fictional Fixture','-c','user.email=fixture@example.invalid','commit','-m','fictional fixture');
 const head=git('rev-parse','HEAD');
 const run=args=>spawnSync(process.execPath,['--experimental-strip-types',join(root,'scripts/discovery-opener-refresh.mjs'),...args],{cwd:root,encoding:'utf8',env:{PATH:process.env.PATH,HOME:root}});
 const full=sha=>['--renewal','00000000-0000-4000-8000-000000000001','--expected-release',sha,'--allow-provider-work'];
 test('help and invalid args never import backend',()=>{for(const args of [['--help'],[],['--renewal','bad']]){const r=run(args);assert.equal(r.status,args[0]==='--help'?0:2);assert(!r.stdout.includes('BACKEND_IMPORT_SENTINEL'));assert(!r.stdout.includes('PROVIDER_SENTINEL'));}});
 test('mismatched exact release blocks before backend import',()=>{const r=run(full('0'.repeat(40)));assert.equal(r.status,1);assert(!r.stdout.includes('BACKEND_IMPORT_SENTINEL'));assert(!r.stdout.includes('PROVIDER_SENTINEL'));});
 test('dirty exact release blocks before backend import',()=>{writeFileSync(join(root,'unreviewed.txt'),'fictional dirty source');const r=run(full(head));assert.equal(r.status,1);assert(!r.stdout.includes('BACKEND_IMPORT_SENTINEL'));assert(!r.stdout.includes('PROVIDER_SENTINEL'));rmSync(join(root,'unreviewed.txt'));});
 test('clean exact release still requires active backend release',()=>{const r=run(full(head));assert.equal(r.status,1);assert(r.stdout.includes('BACKEND_IMPORT_SENTINEL'));assert(!r.stdout.includes('PROVIDER_SENTINEL'));});
 // Node's registered tests run after module evaluation; keep fixture alive until
 // they have finished rather than cleaning it before their subprocesses start.
 process.once('exit',()=>rmSync(root,{recursive:true,force:true}));
}catch(e){rmSync(root,{recursive:true,force:true});throw e;}
