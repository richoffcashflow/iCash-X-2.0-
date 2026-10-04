import {chatCueSchema,type ChatCue} from './webinar-policy.ts';
export function parseChatTime(value:string){const parts=value.trim().split(':').map(Number);if(parts.some(n=>!Number.isFinite(n)||n<0)||parts.length>3)throw Error('Use seconds or mm:ss for chat times.');return Math.round(parts.reduce((total,n)=>total*60+n,0));}
export function importWebinarChat(raw:string):ChatCue[]{
 if(raw.length>750000)throw Error('Use a chat file smaller than 750 KB.');
 if(raw.trim().startsWith('['))return chatCueSchema.array().max(500).parse(JSON.parse(raw));
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<raw.length;i++){const c=raw[i];if(c==='"'){if(quoted&&raw[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&raw[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw Error('The CSV has an unclosed quote.');row.push(cell);if(row.some(Boolean))rows.push(row);
 const header=rows.shift()?.map(c=>c.trim().toLowerCase())??[];const at=header.findIndex(k=>['at','time','timestamp'].includes(k)),name=header.findIndex(k=>['name','username'].includes(k)),text=header.findIndex(k=>['text','message'].includes(k)),kind=header.indexOf('kind'),minutes=header.indexOf('minutes'),seconds=header.indexOf('seconds');
 if((at<0&&(minutes<0||seconds<0))||name<0||text<0)throw Error('CSV needs time, name and message columns, or username, message, minutes and seconds.');
 return chatCueSchema.array().max(500).parse(rows.map((r,n)=>({id:`import-${n}`,at:at>=0?parseChatTime(r[at]??''):parseChatTime(`${r[minutes]||0}:${r[seconds]||0}`),name:r[name]?.trim(),text:r[text]?.trim(),kind:r[kind]?.trim()||(header[name]==='username'?'ai':'host')})));
}
