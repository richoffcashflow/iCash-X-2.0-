/** Existing-customer launch. This is independent of the retired webinar reminders. */
export const launchSlug = 'icash-x-2-existing-customers';
export const launchSender = 'CashFlowKey';
export const launchInstagram = '@cashflwokeyy';
export const launchInstagramUrl = 'https://www.instagram.com/cashflwokeyy/';
export type LaunchStep = {id:string;day:number;hour:number;channel:'email'|'sms';subject:string;body:string;repeatDays?:number};
const details = 'iCash X 1.0 still works for now, but it will be discontinued in the future. If you are still using 1.0, now is a good time to switch to 2.0. Your old account, leads and settings do not transfer. 2.0 is a separate subscription: $50/month, billed monthly until you cancel.';
const email = (id:string,day:number,subject:string,body:string,repeatDays?:number):LaunchStep => ({id,day,hour:0,channel:'email',subject,body:`Hey {{first_name}},\n\n${body}\n\n${details}\n\nJoin iCash X 2.0: {{join_url}}\nWatch my private walkthrough: {{watch_url}}\n\nCashFlowKey\nWant help? DM me LIVE on Instagram: ${launchInstagramUrl}`,repeatDays});
const sms = (id:string,day:number,body:string,hour=0):LaunchStep => ({id,day,hour,channel:'sms',subject:'',body:`CashFlowKey here. ${body}\n\nWatch: {{watch_url}}\nJoin 2.0 ($50/month): {{join_url}}\nDM me LIVE on Instagram: ${launchInstagramUrl}\nReply STOP to opt out.`});
export const launchSteps:LaunchStep[] = [
 email('drop',0,'iCash X 2.0 is LIVE 🎉',"It's CashFlowKey. The new iCash X 2.0 is live 🎉\n\nNo A2P setup for you. No ads you need to run.\n\nThe AI helps find properties, contact sellers and follow up, with a simpler workspace to keep your deals moving.\n\nYou bought from me before, so I've prepared your personal signup link. Join for $50/month, or watch my private walkthrough first and see how it works."),
 sms('drop-text',0,'iCash X 2.0 is LIVE 🎉 No A2P setup for you. No ads to run. A simpler way to find and work deals. 1.0 works for now but will be discontinued in the future. Switch to 2.0 below.',4),
 email('tour',1,'Let me show you the new iCash X',"The best way to understand 2.0 is to see it.\n\nOpen the private walkthrough and I'll show you the new workspace and how to get started. You can watch before deciding whether to join."),
 sms('tour-text',2,'Want to see iCash X 2.0 in action? Watch my private walkthrough, open your signup link, or DM me LIVE.'),
 email('fresh-start',3,'No A2P setup. No ads to run yourself.',"If the old setup felt like a lot, this is why I want you to see 2.0.\n\nYou do not have to set up A2P yourself or run your own ads to use this workflow. The AI helps with finding properties, contacting sellers and following up.\n\nThe goal is simple: less setup, and an easier way to keep working your deals. Watch me walk through it below."),
 email('old-access',4,'Still using iCash X 1.0? See what is next',"1.0 is still running for now, but it will be discontinued in the future. No shutdown date has been announced.\n\nIf you are still using it, this is a good time to see 2.0 and get familiar with the new workspace.\n\n2.0 starts fresh. Watch the walkthrough or open your personal signup link below."),
 sms('new-version-text',5,'Still using iCash X 1.0? It works for now but will be discontinued in the future. 2.0 starts fresh; your old leads and settings do not transfer. See the new version below.'),
 email('course-buyers',7,'Bought one of my courses? This is for you',"Whether you joined Diamond, Pink Diamond, or another one of my courses, I wanted you to see this new release.\n\niCash X 2.0 is a separate software subscription. Your course purchase does not automatically move you into it.\n\nI've put the private walkthrough below so you can see what you're choosing."),
 sms('week-one-text',9,'Have you seen the new iCash X yet? Less setup. A simpler workspace to keep your deals moving. Choose your next step below.'),
 email('simple-next-step',11,'Your next step is simple',"Watch the walkthrough. See the workspace. Decide if you want it.\n\nYou do not have to move anything out of your old account. Joining 2.0 starts a separate new account for $50/month."),
 sms('questions-text',13,'Still deciding on iCash X 2.0? Watch it first, join when you are ready, or DM me LIVE on Instagram.'),
 email('price',15,'iCash X 2.0: $50 per month',"Here is the offer in plain English: join iCash X 2.0 for $50 per month. It renews monthly until you cancel.\n\nYou choose whether to join. Nothing from your old account transfers automatically.\n\nSee it first, or go straight to signup below."),
 sms('ready-text',18,'Ready for the new iCash X workspace? Your personal signup link is ready. You can also watch the walkthrough or DM me LIVE.'),
 email('walkthrough-again',21,'Your private look at iCash X 2.0',"Keeping this easy: here is your private walkthrough of the new iCash X.\n\nSee the actual workspace and how it works before making your decision. If it fits what you're looking for, you can join from the link below."),
 email('one-place',25,'Take a look at the new workspace',"iCash X 2.0 was built around an easier workspace for your real estate workflow.\n\nIf you have been meaning to check it out, open the walkthrough below. You can see it before starting a new subscription."),
 sms('month-text',28,'Checking back in on iCash X 2.0. No A2P setup for you, and no ads you need to run. See how it works below.'),
 email('new-workspace',22,'See what changed in iCash X 2.0',"Still curious about the new version?\n\nThe private walkthrough shows the workspace so you can decide if you want to start fresh with 2.0. Your personal signup link is below."),
 sms('personal-link',24,'Your personal iCash X 2.0 signup link is ready. Watch the walkthrough, activate 2.0, or DM me LIVE if you want help.'),
 email('personal-invite',27,'Your invite to the new iCash X',"You bought from me before, so I want you to have a clear look at the new release.\n\nWatch the private walkthrough and decide for yourself. If you want to join iCash X 2.0, your personal signup link is right below."),
 email('last-followup',29,'One more look at iCash X 2.0',"This is the last message in this launch follow-up series.\n\nIf you want to see the new workspace, open your private walkthrough. Ready to join? Your personal signup link is below."),
];
export function renderLaunchCopy(step:Pick<LaunchStep,'subject'|'body'>,values:{first_name:string;join_url:string;watch_url:string}) {
 const render=(text:string)=>text.replace(/\{\{(first_name|join_url|watch_url)\}\}/g,(_,key:keyof typeof values)=>values[key]);
 return {subject:render(step.subject),body:render(step.body)};
}
export function parseLaunchCsv(raw:string):Record<string,string>[] {
 if(raw.length>12_000_000)throw Error('Use a CSV smaller than 12 MB.');
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<raw.length;i++){const c=raw[i];if(c==='"'){if(quoted&&raw[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&raw[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw Error('The CSV has an unclosed quote.');row.push(cell);if(row.some(Boolean))rows.push(row);
 const headers=(rows.shift()??[]).map(s=>s.replace(/^\uFEFF/,'').trim());
 if(new Set(headers).size!==headers.length)throw Error('The CSV has duplicate column names.');
 return rows.map((values,index)=>{if(values.length!==headers.length)throw Error(`Row ${index+2} has an unexpected number of columns.`);return Object.fromEntries(headers.map((h,i)=>[h,values[i]??'']));});
}
export type LaunchImport = {email:string|null;phone:string|null;name:string;source:'whop'|'highlevel';sourceIds:string[];products:string[];suppressedReason:string|null;emailPermission:boolean;smsPermission:boolean;lastPurchaseAt:string|null};
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normalizeLaunchPhone(value:string){const trimmed=value.trim();let digits=trimmed.replace(/[^0-9]/g,'');if(!trimmed.startsWith('+')&&digits.length===10)digits='1'+digits;return /^[1-9]\d{7,14}$/.test(digits)?'+'+digits:null;}
export function prepareLaunchImport(rows:Record<string,string>[],source:'whop'|'highlevel') {
 const people=new Map<string,LaunchImport>();let missingContact=0,nonBuyers=0;
 for(const raw of rows){const r=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k.trim().toLowerCase(),v.trim()]));
  const rawEmail=r.email||r['email address']||'',email=emailPattern.test(rawEmail)&&rawEmail.length<=254?rawEmail.toLowerCase():null;
  const phone=normalizeLaunchPhone(r['phone number']||r.phone||r.mobile||'');
  if(!email&&!phone){missingContact++;continue;}
  const statuses=[r.status,r['sub status'],r['dispute status']].filter(Boolean).join(' ').toLowerCase();
  const refunded=Number(r['refunded amount']||0)>0||Number(r['reversed amount']||0)>0||!!r['refunded at']||/refund|disput|chargeback|revers/.test(statuses);
  const optedOut=['dnd','do not disturb','unsubscribed','email opt out','sms opt out'].some(k=>/^(true|yes|1|all)$/i.test(r[k]||''));
  if(source==='whop'&&!refunded&&!/^(paid|succeeded|completed)$/i.test(r.status||'')){nonBuyers++;continue;}
  const purchaseDate=r['paid at']||r['last purchase at']||r['last purchase date']||'';
  const parsedPurchase=/(Z|[+-]\d{2}:?\d{2})$/i.test(purchaseDate)?Date.parse(purchaseDate):NaN;
  const lastPurchaseAt=Number.isFinite(parsedPurchase)?new Date(parsedPurchase).toISOString():null;
  const id=r['customer id']||r['contact id']||r.id||'';
  const key=email?'email:'+email:'phone:'+phone;
  const current=people.get(key),reason=refunded?'Refund, reversal or dispute in source':optedOut?'Opted out in source':null;
  const explicit=(field:string)=>/^(true|yes|1|subscribed|opted in)$/i.test(r[field]||'');
  const next:LaunchImport={email,phone,name:(r['customer name']||r.name||[r['first name'],r['last name']].filter(Boolean).join(' ')).slice(0,160),source,lastPurchaseAt,sourceIds:id?[id.slice(0,150)]:[],products:r.description?[r.description.slice(0,180)]:[],suppressedReason:reason,emailPermission:explicit('email consent')||explicit('email subscribed'),smsPermission:explicit('sms consent')||explicit('sms subscribed')};
  if(current){if(next.lastPurchaseAt&&(!current.lastPurchaseAt||next.lastPurchaseAt>current.lastPurchaseAt))current.lastPurchaseAt=next.lastPurchaseAt;current.suppressedReason||=reason;current.phone||=phone;current.name||=next.name;current.products=[...new Set([...current.products,...next.products])];current.sourceIds=[...new Set([...current.sourceIds,...next.sourceIds])];current.emailPermission||=next.emailPermission;current.smsPermission||=next.smsPermission;}
  else people.set(key,next);
 }
 return {contacts:[...people.values()],rows:rows.length,duplicates:rows.length-missingContact-nonBuyers-people.size,missingContact,nonBuyers};
}
