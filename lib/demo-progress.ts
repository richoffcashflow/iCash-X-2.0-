export const DEMO_PROGRESS_KEY = 'icash-simulation-v4';
export type DemoProgress = { version:4;scope:string;count:number;limitConfirmed:boolean;savedAt:number };
export function readDemoProgress(scope:string):DemoProgress|null{
 try{const d=JSON.parse(localStorage.getItem(`${DEMO_PROGRESS_KEY}:${scope}`)??'null');if(d?.version!==4||d.scope!==scope||!Number.isInteger(d.count)||d.count<1||d.count>5||typeof d.limitConfirmed!=='boolean'||!Number.isFinite(d.savedAt)||d.savedAt>Date.now()||Date.now()-d.savedAt>30*86400000||d.count===5&&!d.limitConfirmed)return null;return d;}catch{return null;}
}
export function saveDemoProgress(scope:string,count:number,limitConfirmed:boolean){try{localStorage.setItem(`${DEMO_PROGRESS_KEY}:${scope}`,JSON.stringify({version:4,scope,count,limitConfirmed,savedAt:Date.now()}));}catch{}}
