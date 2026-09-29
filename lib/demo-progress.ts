export const DEMO_PROGRESS_KEY = 'icash-test-v3';
export type DemoProgress = { version:3;count:number;limitConfirmed:boolean;savedAt:number };
export function readDemoProgress():DemoProgress|null{
 try{const d=JSON.parse(localStorage.getItem(DEMO_PROGRESS_KEY)??'null');if(d?.version!==3||!Number.isInteger(d.count)||d.count<1||d.count>5||typeof d.limitConfirmed!=='boolean'||!Number.isFinite(d.savedAt)||d.savedAt>Date.now()||Date.now()-d.savedAt>30*86400000||d.count===5&&!d.limitConfirmed)return null;return d;}catch{return null;}
}
export function saveDemoProgress(count:number,limitConfirmed:boolean){try{localStorage.setItem(DEMO_PROGRESS_KEY,JSON.stringify({version:3,count,limitConfirmed,savedAt:Date.now()}));}catch{}}
