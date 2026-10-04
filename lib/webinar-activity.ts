import {z} from 'zod';

export const activitySchema=z.object({id:z.string().regex(/^[a-f0-9]{32}$/),kind:z.enum(['funding','daily','membership']),amountCents:z.number().int().positive().max(1000000000),occurredAt:z.string().datetime({offset:true}),region:z.string().max(80).nullable()});
export type WebinarActivity=z.infer<typeof activitySchema>;
export const activityWindowMs=15*60*1000;
export function recentActivity(events:WebinarActivity[],now:number){return events.filter(e=>{const age=now-Date.parse(e.occurredAt);return age>=0&&age<activityWindowMs;}).sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt));}
export function activityMessage(event:WebinarActivity){
 const subject=event.region?`A viewer in ${event.region}`:'A viewer';
 const amount=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:event.amountCents%100?2:0,maximumFractionDigits:2}).format(event.amountCents/100);
 if(event.kind==='daily')return `${subject} started a ${amount}/day bot budget`;
 if(event.kind==='membership')return `${subject} got software access`;
 return `${subject} added ${amount} to their bot`;
}
export function activityAge(occurredAt:string,now:number){const seconds=Math.max(0,Math.floor((now-Date.parse(occurredAt))/1000));return seconds<60?'Less than a minute ago':`${Math.floor(seconds/60)} min ago`;}

const states:Record<string,string>={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'Washington, DC',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};
/** Only pass hosting-provider headers. No city, address, raw IP or visitor-entered location. */
export function approximateRegion(country:string|null,region:string|null):string|null{
 if(!country||!/^[A-Z]{2}$/.test(country)||country==='ZZ')return null;
 if(country==='US')return region&&Object.hasOwn(states,region)?states[region]:'the United States';
 try{return new Intl.DisplayNames(['en'],{type:'region',fallback:'none'}).of(country)??null;}catch{return null;}
}
