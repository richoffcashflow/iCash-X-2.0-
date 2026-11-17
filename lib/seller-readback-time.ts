// Calendar dates and durations are not monetary amounts. Keep this removal
// local to readbacks; repair/debt extraction must retain its original numbers.
const cardinals='zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
const number=`(?:${cardinals}|hundred|thousand)(?:[ -]+(?:and[ -]+)?(?:${cardinals}|hundred|thousand))*`;
const ordinal='first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|twenty[ -](?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|thirty[ -]first';
const day=`(?:[12]?\\d|3[01])(?:st|nd|rd|th)?|(?:twenty|thirty)[ -](?:one|two|three|four|five|six|seven|eight|nine)|${ordinal}|${cardinals}`;
const month='January|February|March|April|May|June|July|August|September|October|November|December';
const year=`(?:\\d{4}|(?:one|two|three)[ -]thousand(?:[ -]+(?:and|${cardinals}|hundred))*|(?:nineteen|twenty|twenty-one)(?:[ -]+(?:${cardinals}))*)`;
const datePattern=`(?<![$\\d])\\b(?:\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{4}|(?:(?:${month})(?: the)?[ ,]+(?:${day})|(?:the )?(?:${day})(?: of)?[ ,]+(?:${month}))(?:[ ,]+${year})?)\\b`;
const durationPattern=`(?<![$\\d])\\b(\\d+(?:\\.\\d+)?|${number})[ -]+(?:(?:calendar|business)[ -]+)?(days?|weeks?|months?|years?|hours?|minutes?)\\b`;

export function calendarReadbacks(text:string){return [...text.matchAll(new RegExp(datePattern,'gi'))].map(match=>match[0]);}
export function durationReadbacks(text:string){return [...text.matchAll(new RegExp(durationPattern,'gi'))].map(match=>({text:match[0],number:match[1],unit:match[2].toLowerCase()}));}
export function withoutReadbackTiming(text:string){return text.replace(new RegExp(datePattern,'gi'),' ').replace(new RegExp(durationPattern,'gi'),' ');}
