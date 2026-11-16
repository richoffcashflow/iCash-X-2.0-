import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {dealMachinePhoto} from '../lib/property-photo.ts';
import {savedPropertyPhoto} from '../lib/persistent-property-photo.ts';
import {cachedPropertyPhoto} from '../lib/property-photo-cache.ts';
const id='00000000-0000-4000-8000-000000000001',url='https://img.dealmachine.com/sv/1,2.jpg';
let authorized=true,rows=[],paths=[],lookups=[],cache=[],saved=null,reads=[],readFails=false,claims=0,now=1000000;
const dependencies={savedPropertyPhoto,persistentPropertyPhoto:async(_db,_account,_screening,load)=>{claims++;return load();},NextResponse:{json:(body,opts)=>({body,...opts})},z,workAccount:async()=>{if(!authorized)throw Error();return {accountId:'account-a'};},db:async(path,method,body)=>{if(path==='rpc/icash_read_photo_cache'){assert.equal(method,'POST');reads.push(body);if(readFails)throw Error('Cache unavailable');return saved;}paths.push(path);return rows;},dealMachinePhoto,loadPropertyPhoto:async propertyId=>{lookups.push(propertyId);return dealMachinePhoto({street_view:url});},cachedPropertyPhoto:async(account,screening,load)=>{cache.push({account,screening});return cachedPropertyPhoto(account,screening,load,now);}};
const source=readFileSync(new URL('../app/api/work/property-photo/route.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};new Function('require','module','exports',compiled)(()=>dependencies,mod,mod.exports);
const get=()=>mod.exports.GET(new Request('https://fixture.test/api/work/property-photo?screeningId='+id+'&propertyId=prop_other'));
let r=await get();assert.equal(r.status,404);assert.equal(lookups.length,0);
rows=[{snapshot:{raw:{data:{dm_property_id:'prop_123',images:{street_view:url}}}},result:{property:{propertyId:'prop_123'}}}];
r=await get();assert.equal(r.body.photo.url,url);assert.equal(lookups.length,0);assert(paths.every(path=>path.includes('account_id=eq.account-a')&&path.includes('state=eq.complete')));
rows[0].snapshot.raw.data.dm_property_id='prop_other';r=await get();assert.deepEqual(lookups,['prop_123'],'Only authenticated stored property ID is used');assert.deepEqual(cache,[{account:'account-a',screening:id}]);
// The persisted read remains useful after the lookup lease/cache TTL expires.
// Its valid public CDN URL needs no new metadata request or claim.
saved=dealMachinePhoto({street_view:url});lookups=[];cache=[];reads=[];claims=0;now+=15*60000+1;
const concurrent=await Promise.all([get(),get()]);assert(concurrent.every(response=>response.body.photo.url===url));
assert.deepEqual(lookups,[],'Previously fetched image avoids another provider request');assert.equal(claims,0,'Saved image does not take a persistent lookup lease');assert.deepEqual(reads,[{p_account:'account-a',p_screening:id}],'Concurrent reads coalesce through the real memory cache');
r=await get();assert.equal(r.body.photo.url,url);assert.equal(reads.length,1,'Repeated GET reuses the memory cache without another database metadata read');assert.equal(claims,0);
for(const invalid of [null,{...saved,url:'https://evil.invalid/sv/image.jpg'},{...saved,source:'other'}]){
 saved=invalid;lookups=[];now+=15*60000+1;r=await get();assert.deepEqual(lookups,['prop_123'],'Missing or untrusted saved metadata uses ordinary bounded lookup');
}
readFails=true;lookups=[];cache=[];claims=0;now+=15*60000+1;r=await get();assert.equal(r.body.photo,null);assert.deepEqual(lookups,[]);assert.equal(claims,0,'Unavailable persisted metadata cannot open a provider path');readFails=false;saved=null;
lookups=['prop_123'];reads=[];
rows[0].result.property.images={street_view:url};r=await get();assert.equal(lookups.length,1,'Stored normalized photos skip provider lookup');assert.deepEqual(reads,[],'Stored normalized image needs no cache read');
authorized=false;paths=[];lookups=[];r=await get();assert.equal(r.status,503);assert.equal(paths.length,0);assert.equal(lookups.length,0);
assert.equal(r.headers['Cache-Control'],'private, no-store');
authorized=true;paths=[];lookups=[];r=await mod.exports.GET(new Request('https://fixture.test/api/work/property-photo?screeningId=invalid'));assert.equal(r.status,503);assert.equal(paths.length,0);assert.equal(lookups.length,0);
console.log('Property photo route: authenticated tenant-bound stored property ID, raw mismatch rejection, stored-first lookup, no raw data and private caching passed');
