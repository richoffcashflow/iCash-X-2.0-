export type LocalTimeParts={date:string;hour:string;minute:string;period:'AM'|'PM'};
export function splitLocalDateTime(value:string):LocalTimeParts{
 const match=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
 if(!match||Number(match[2])>23||Number(match[3])>59)return {date:'',hour:'12',minute:'00',period:'PM'};
 const hour=Number(match[2]);
 return {date:match[1],hour:String(hour%12||12),minute:match[3],period:hour<12?'AM':'PM'};
}
export function joinLocalDateTime(parts:LocalTimeParts){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(parts.date)||!/^([1-9]|1[0-2])$/.test(parts.hour)||!/^([0-5][0-9])$/.test(parts.minute))return '';
 const hour=Number(parts.hour)%12+(parts.period==='PM'?12:0);
 return `${parts.date}T${String(hour).padStart(2,'0')}:${parts.minute}`;
}
