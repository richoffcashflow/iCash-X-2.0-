import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buyerPackageLink,buyerNetworkLink} from '../lib/buyer-links.ts';
import {renderBuyerPackage,buyerPackageText} from '../lib/buyer-disposition.ts';
const token='a'.repeat(32);
for(const host of ['propertymsgs.com','homeoffernetwork.com','www.geticashx.com']){
 const url=`https://${host}/d/${token}`;assert.equal(buyerPackageLink(url),url);assert(buyerPackageText(11200000,url).includes(url));
}
for(const url of [null,'',`http://propertymsgs.com/d/${token}`,`https://propertymsgs.com.evil.invalid/d/${token}`,`https://propertymsgs.com@evil.invalid/d/${token}`,`https://propertymsgs.com/d/${token}?next=https://evil.invalid`,`https://propertymsgs.com/d/${token}#secret`,`javascript:alert(1)`,`https://propertymsgs.com/d/${token.toUpperCase()}`])assert.equal(buyerPackageLink(url),null);
const html=renderBuyerPackage({address:'45 Fictional Way',principal:'Fixture',askingPriceCents:11200000,repairsCents:null,arvCents:null,closingDate:null,businessPhone:null,fetchedAt:null,reserved:true});
assert(html.includes(`href="${buyerNetworkLink}"`));assert(html.includes('Verify your email'));assert(!html.includes('sms:'));
const portal=readFileSync(new URL('../components/deal-journey-portal.tsx',import.meta.url),'utf8');
assert(portal.includes('buyerPackageLink(data?.packageUrl)'));assert(portal.includes('referrerPolicy="no-referrer"'));
console.log('Buyer intake links: current and historical hosts work; lookalike hosts, credentials and injected parameters rejected.');
