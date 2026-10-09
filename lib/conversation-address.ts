// Presentation only. Canonical property records and contract addresses stay intact.
const stateNames:Record<string,string>={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',AS:'American Samoa',GU:'Guam',MP:'Northern Mariana Islands',PR:'Puerto Rico',VI:'United States Virgin Islands'};
const unit=/^(?:apt\.?|apartment|unit|suite|ste\.?|#)\s*[\p{L}\p{N}-]+$/iu;
export function conversationStreet(address:string){
 const parts=address.trim().split(/\s*,\s*/);
 return parts[0]+(parts[1]&&unit.test(parts[1])?' '+parts[1]:'');
}
export function conversationAddressFields(address:string){
 const parts=address.trim().split(/\s*,\s*/).filter(Boolean);
 if(/^(?:USA|US|United States(?: of America)?)$/i.test(parts.at(-1)??''))parts.pop();
 const region=parts.at(-1)?.match(/^([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/i);
 const state=region?stateNames[region[1].toUpperCase()]:undefined;
 const city=state&&parts.length>2&&!unit.test(parts.at(-2)!)?parts.at(-2):undefined;
 return {address:conversationStreet(address),...(city?{city}:{}),...(state?{state}: {})};
}
export const conversationAddressInstructions='ADDRESS WORDING: Refer to the property by its street number, street name and any unit. Do not routinely read its city, state or ZIP code. Add the city only when clarification is needed. If a state is needed, say its full name, such as Texas or New York, never postal letters such as TX or NY. Read a ZIP code only when specifically requested. Keep the exact complete address in property records and agreements.';
