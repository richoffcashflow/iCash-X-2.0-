/** Date-only contract terms are calendar dates, never timestamps in the server's local timezone. */
export function validCalendarDate(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000-'))return false;
 const date=new Date(value+'T12:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function calendarDaysAfter(value:string,days:number){
 if(!validCalendarDate(value)||!Number.isSafeInteger(days)||days<0)throw Error('Enter a valid contract date.');
 const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);
 const result=date.toISOString().slice(0,10);
 if(!validCalendarDate(result))throw Error('Contract deadline is outside the supported calendar.');
 return result;
}
/** No contract timezone is stored. Do not silently choose UTC for a potentially same-day deadline. */
export function deadlineDateStatus(value:string,now=Date.now()){
 if(!validCalendarDate(value)||!Number.isFinite(now))throw Error('Enter a valid contract date.');
 const earliestToday=new Date(now-12*3600000).toISOString().slice(0,10);
 const latestToday=new Date(now+14*3600000).toISOString().slice(0,10);
 if(value<earliestToday)return 'past' as const;
 if(value<latestToday)return 'timezone_review' as const;
 return 'current_or_future' as const;
}
