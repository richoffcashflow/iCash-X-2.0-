import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {testAutomaticOfferProvider} from '../scripts/test-automatic-offer-provider.mjs';
import {prepareSellerAgreement} from '../scripts/prepare-seller-agreement.mjs';

const disabled={code:'PAID_PROVIDER_SIMULATIONS_DISABLED_BY_OWNER'};
const scripts=[
 'test-buyer-speaking-provider-20261009.mjs',
 'test-buyer-terms-provider-20261009.mjs',
 'test-conditional-offer-provider.mjs',
 'test-buyer-confidence-title-provider-20261009.mjs',
 'test-buyer-viewing-followup-provider-20261009.mjs',
 'test-buyer-scenarios-provider-20261009.mjs',
];

test('shared paid executor refuses before invoking any provider callback',async()=>{
 let requests=0;
 await assert.rejects(testAutomaticOfferProvider(async()=>{requests++;},[], 'tool_fixture'),disabled);
 assert.equal(requests,0);
});

test('every live simulation command stops before fetch even in production',()=>{
 for(const script of scripts){
  const url=new URL('../scripts/'+script,import.meta.url).href;
  const source=`
   let requests=0;
   globalThis.fetch=async()=>{requests++;throw Error('UNEXPECTED_NETWORK');};
   try{await import(${JSON.stringify(url)});process.exitCode=2;}
   catch(error){
    if(error.code!=='PAID_PROVIDER_SIMULATIONS_DISABLED_BY_OWNER'||requests!==0){console.error(error);process.exitCode=3;}
    else console.log('blocked with zero requests');
   }
  `;
  const run=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',source],{
   encoding:'utf8',timeout:15000,
   env:{PATH:process.env.PATH,VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'main',ELEVENLABS_API_KEY:'fixture-not-a-real-key',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SECRET_KEY:'fixture-not-a-real-key'},
  });
  assert.equal(run.status,0,script+': '+run.stderr);
  assert.match(run.stdout,/blocked with zero requests/,script);
 }
});

test('automatic seller staging stops before provider mutations when paid verification is needed',async()=>{
 const requests=[];
 const env={VERCEL_ENV:'production',ICASH_DIRECT_CALLS_PREPARE:'true',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SECRET_KEY:'fixture-key',ELEVENLABS_API_KEY:'fixture-key'};
 const fetcher=async(url)=>{
  requests.push(url);
  assert.equal(url,'https://fixture.invalid/rest/v1/rpc/icash_get_recorded_reception_config');
  return new Response(JSON.stringify({context_policy:'automatic_offer_v8'}));
 };
 await assert.rejects(prepareSellerAgreement(env,fetcher,false,true),disabled);
 assert.equal(requests.length,1);
 assert.deepEqual(await prepareSellerAgreement({VERCEL_ENV:'preview'},fetcher,false,true),{status:'not_requested'});
 assert.equal(requests.length,1);
});

test('deployments cannot invoke paid simulation, search or owner-delivery test commands',()=>{
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 for(const name of [...scripts,'run-corporate-buyer-search-20261009.mjs','run-owner-buyer-delivery-test.mjs']){
  assert(!pkg.scripts['build:verified'].includes(name),name);
 }
 assert(pkg.scripts['build:verified'].includes('verify-buyer-privacy-release.mjs'));
 assert(pkg.scripts['build:verified'].endsWith('pnpm build'));
});
