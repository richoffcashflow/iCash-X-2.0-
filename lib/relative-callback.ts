type Turn={role:string;message:string;seconds:number};
const zones:Record<string,string>={central:'America/Chicago',eastern:'America/New_York',mountain:'America/Denver',pacific:'America/Los_Angeles'};
const words:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
function parts(stamp:number,zone:string){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(stamp)).map(p=>[p.type,p.value]));}
/** Conservative US practice-call fallback. Never uses the summary or processing date.
 * Requires a complete agent readback immediately followed by an unqualified yes.
 * Unsupported language, later changes, missing source time and DST ambiguity fail closed.
 */
export function relativeCallback(turns:Turn[],startSeconds:number|undefined,now:number){
 if(!Number.isFinite(startSeconds)||!startSeconds||startSeconds*1000>now)return null;
 let candidate:{dueAt:string;timezone:string;quote:string;readback:string}|null=null;
 for(let i=0;i<turns.length;i++){
  const t=turns[i];
  if(t.role==='user'&&/\b(?:don't|do not|stop|cancel|never|actually|instead|reschedule|wait|not tomorrow|not today)\b/i.test(t.message))return null;
  if(t.role!=='agent')continue;
  const text=t.message.toLowerCase();
  const days=[...text.matchAll(/\b(today|tomorrow)\b/g)];
  const times=[...text.matchAll(/\b(1[0-2]|[1-9]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/g)];
  const zoneMatches=[...text.matchAll(/\b(central|eastern|mountain|pacific)\b/g)];
  if(days.length!==1||times.length!==1||zoneMatches.length!==1)continue;
  if(!/\b(confirm|does that|is that|would that|will that|work for you|sound good|sound right)\b/.test(text)&&! /^(today|tomorrow) at [^?.!]+\?$/.test(text.trim()))continue;
  if(/\b(or|between|maybe|around)\b/.test(text)){candidate=null;continue;}
  // A fully specified but unanswered or rejected readback supersedes an earlier one.
  candidate=null;
  const next=turns[i+1];
  if(!next||next.role!=='user'||!/^\s*(yes|yeah|yep|correct|that's right|that works|yes that works)[.!\s]*$/i.test(next.message))continue;
  if(!Number.isFinite(t.seconds)||t.seconds<0||t.seconds>900)return null;
  const zone=zones[zoneMatches[0][1]];const p=parts(startSeconds*1000+t.seconds*1000,zone);
  const day=new Date(Date.UTC(+p.year,+p.month-1,+p.day+(days[0][1]==='tomorrow'?1:0)));
  const tm=times[0];const hour=(words[tm[1]]??+tm[1])%12+(tm[3].startsWith('p')?12:0);const minute=+(tm[2]??0);
  const wall=Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),hour,minute);
  const wanted=`${day.toISOString().slice(0,10)}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
  const matches:number[]=[];
  for(let offset=-14*60;offset<=14*60;offset+=15){const stamp=wall+offset*60000;const x=parts(stamp,zone);if(`${x.year}-${x.month}-${x.day}T${x.hour}:${x.minute}`===wanted)matches.push(stamp);}
  if(matches.length!==1||matches[0]<=now||matches[0]>now+90*86400000)return null;
  candidate={dueAt:new Date(matches[0]).toISOString(),timezone:zone,quote:next.message,readback:t.message};
  // Any later seller scheduling change needs a new validation, never reuse an old yes.
  if(turns.slice(i+2).some(x=>x.role==='user'&&/\b(call|callback|today|tomorrow|am|pm|time|central|eastern|mountain|pacific)\b/i.test(x.message)))candidate=null;
 }
 return candidate;
}
