// Presentation only. Canonical property records and contract addresses stay intact.
const stateNames:Record<string,string>={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',AS:'American Samoa',GU:'Guam',MP:'Northern Mariana Islands',PR:'Puerto Rico',VI:'United States Virgin Islands'};
const unit=/^(?:apt\.?|apartment|unit|suite|ste\.?|#)\s*[\p{L}\p{N}-]+$/iu;
export function conversationStreet(address:string){
 const parts=address.trim().split(/\s*,\s*/);
 return parts[0]+(parts[1]&&unit.test(parts[1])?' '+parts[1]:'');
}
const streetSuffixes:Record<string,string>={st:'Street',ln:'Lane',rd:'Road',dr:'Drive',ave:'Avenue',av:'Avenue',blvd:'Boulevard',ct:'Court',cir:'Circle',pl:'Place',pkwy:'Parkway',hwy:'Highway',ter:'Terrace',terr:'Terrace',trl:'Trail',sq:'Square',aly:'Alley',cv:'Cove',expy:'Expressway',fwy:'Freeway',pt:'Point',plz:'Plaza',ctr:'Center',trce:'Trace'};
const directions:Record<string,string>={n:'North',s:'South',e:'East',w:'West',ne:'Northeast',nw:'Northwest',se:'Southeast',sw:'Southwest'};
const unitNames:Record<string,string>={apt:'Apartment',apartment:'Apartment',ste:'Suite',suite:'Suite',unit:'Unit',bldg:'Building',building:'Building',fl:'Floor',floor:'Floor','#':'Unit'};
const tokenKey=(value:string)=>value.toLowerCase().replaceAll('.','');
const lookup=(table:Record<string,string>,value:string)=>Object.hasOwn(table,tokenKey(value))?table[tokenKey(value)]:undefined;
const suffixWords=new Set([...Object.keys(streetSuffixes),...Object.values(streetSuffixes).map(value=>value.toLowerCase()),'way','loop']);
/** Speech only: expand suffixes in address positions, not words within proper
 * names (St. Charles, Dr. Martin Luther King) or arbitrary conversation text. */
export function spokenStreet(address:string){
 let street=conversationStreet(address);const units:string[]=[];
 // Peel secondary-unit labels before identifying the street suffix.
 for(let count=0;count<3;count++){
  const match=street.match(/(?:\s+(apt\.?|apartment|ste\.?|suite|unit|bldg\.?|building|fl\.?|floor)\s+|\s*(#)\s*)([\p{L}\p{N}][\p{L}\p{N}/-]*)$/iu);
  if(!match||match.index===undefined)break;
  units.unshift(unitNames[tokenKey(match[1]??match[2])]+' '+match[3]);street=street.slice(0,match.index).trimEnd();
 }
 const words=street.split(/\s+/);let suffixIndex=words.length-1;
 if(words.length>=3&&lookup(directions,words[suffixIndex])&&suffixWords.has(tokenKey(words[suffixIndex-1]))){
  words[suffixIndex]=lookup(directions,words[suffixIndex])!;suffixIndex--;
 }
 if(suffixIndex>=1){
  const suffix=tokenKey(words[suffixIndex]);
  if(lookup(streetSuffixes,suffix))words[suffixIndex]=lookup(streetSuffixes,suffix)!;
  // A direction needs a separate street name: N St remains the letter N.
  const prefixIndex=/^\d+[\p{L}]?(?:-\d+[\p{L}]?)?$/iu.test(words[0])?1:0;
  if(suffixWords.has(suffix)&&prefixIndex+1<suffixIndex&&lookup(directions,words[prefixIndex]))words[prefixIndex]=lookup(directions,words[prefixIndex])!;
 }
 return [...words,...units].join(' ').replace(/\bHwy\.?\s+(?=\d)/gi,'Highway ');
}
export function conversationAddressFields(address:string){
 const parts=address.trim().split(/\s*,\s*/).filter(Boolean);
 if(/^(?:USA|US|United States(?: of America)?)$/i.test(parts.at(-1)??''))parts.pop();
 const region=parts.at(-1)?.match(/^([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/i);
 const state=region?stateNames[region[1].toUpperCase()]:undefined;
 const city=state&&parts.length>2&&!unit.test(parts.at(-2)!)?parts.at(-2):undefined;
 return {address:spokenStreet(address),...(city?{city}:{}),...(state?{state}: {})};
}
export const conversationAddressInstructions='ADDRESS WORDING: Say the street number, street name and unit; add the city only for clarification. Pronounce suffixes as words: Frank St is Frank Street; Oak Ln is Oak Lane; Rd=Road, Dr=Drive, Ave=Avenue, Blvd=Boulevard. Never spell suffix letters. Respect names such as Saint Charles and Doctor Martin Luther King. Say full state names (Texas, not TX); read ZIP codes only on request. Keep exact addresses in records and agreements.';
