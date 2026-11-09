/** Only the current package host and previously issued, supported hosts. */
export function buyerPackageLink(value:unknown):string|null{
 return typeof value==='string'&&/^https:\/\/(propertymsgs\.com|homeoffernetwork\.com|www\.geticashx\.com)\/d\/[a-f0-9]{32}$/.test(value)?value:null;
}
export const buyerNetworkLink='https://homeoffernetwork.com/buyers';
