export type MessagePhase='resume'|'next'|'checkout';
const clean=(value:string,length:number)=>value.replace(/[\r\n\t]+/g,' ').trim().slice(0,length);
export function campaignCopy({name,brand,host,phase,title,step,reply=false}:{name:string;brand:string;host:string;phase:MessagePhase;title:string;step:number;reply?:boolean}){
 const first=clean(name,80).split(/\s+/)[0]||'there';
 const variants: [string,string,string][]=phase==='checkout'?[
  ['Your next step 👇','Review the current plan, price and terms. After payment, you can name your bot and set up your workspace.','Ready to get started? Review your access here 👇'],
 ]:phase==='next'?[
  ['Your next webinar is ready 🎬','There is another session ready for you. Open it, see the wholesale real estate workflow, and bring your questions to chat.','Your next webinar is ready 🎬 Tap to join:'],
  ['Take another look 👀','Want a closer look before deciding? This webinar walks through the software. Tap below to join the room.','Take another look at the software 👀 Join your webinar:'],
  ['Jump into your session 👇','Open your next session and see how the research, outreach and follow-up fit together.','Your session is ready 👇 Jump into the room:'],
 ]:[
  ['Jump back in 👇','Your webinar is ready. Tap below to get back into the room and continue the walkthrough.','Your webinar is ready 👇 Tap to jump back in:'],
  ['Finish what you started 🎬','Come back to the walkthrough and see how the wholesale real estate tools fit together. Your link is below.','Come see the rest of the walkthrough 🎬 Jump back in:'],
  ['See the bot workflow 👀','Still thinking about it? Open your webinar for a closer look at the tools before you decide.','See the bot workflow 👀 Your webinar link is here:'],
  ['Your next step is in the room 👇','Bring your questions to the session chat. Start with the walkthrough, then review the offer when you are ready.','Bring your questions to the webinar chat 👇 Join here:'],
  ['Make time for the walkthrough 🎬','Research, outreach and follow-up: see the workflow in your session. Tap below and take a closer look.','Ready for the walkthrough? 🎬 Open your session:'],
  ['Still want to see how it works? 👀','Your webinar is available whenever you are ready to take another look. Jump into the room below.','Still want to see how it works? 👀 Jump into your webinar:'],
 ];
 const index=Math.abs(step>=1000?step-1000:step>=200?step-200:step-100)%variants.length;
 const [subject,message,sms]=reply?['Here is your webinar link 👇','Thanks for getting back to us. Jump into your webinar below to continue the walkthrough and use the session chat.','Here is your webinar link 👇 Jump back into the room:']:variants[index];
 const cta=phase==='checkout'?`Get ${brand} access`:phase==='next'?'Join my next webinar':'Join my webinar';
 return {subject:clean(subject,150),body:`Hey ${first},\n\n${message}${phase==='next'&&title?`\n\nSession: ${clean(title,160)}`:''}\n\n${cta}:`,signature:`— ${host}`,sms:`Hey ${first}, ${brand} here. ${sms}`};
}
export function campaignReason(step:number,reply=false){return reply?'A session request received a return link.':step>=1000?'Weekly follow-up for an opted-in lead who has not purchased.':step>=200&&step<221?'First-week reminder to return and watch the webinar.':step>=200?'Follow-up to bring a non-buyer back into a webinar.':'Original campaign reminder for an earlier signup.';}
