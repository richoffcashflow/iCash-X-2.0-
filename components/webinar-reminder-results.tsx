import type {ReminderResults} from '@/lib/webinar-reminder-policy';
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(cents/100);
const number=(value:number)=>new Intl.NumberFormat('en-US').format(value);
export function WebinarReminderResults({results}:{results:ReminderResults|null}){
 if(!results)return <p role="status">Reminder results are temporarily unavailable. Refresh to try again.</p>;
 const m=results.overall,date=new Date(results.trackingSince).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short',hour12:true});
 const cards=[['Delivered',number(m.deliveredMessages),`${number(m.deliveredPeople)} recipients`],['Clicked',number(m.clickedPeople),'Recipients who loaded the link'],['Watched again',number(m.returnedPeople),'Recipients who resumed playback'],['Checkout loaded',number(m.checkoutPeople),'Recipients who opened payment'],['Purchases',number(m.purchases),`${number(m.membershipPurchases)} memberships · ${number(m.vipPurchases)} VIP upgrades`],['Sales',money(m.revenueCents),'Verified payments after a click']];
 return <section className="ms-reminder-results" aria-label="Webinar reminder results"><h3>Are reminders working?</h3>
  <dl className="ms-reminder-cards">{cards.map(([label,value,detail])=><div key={label}><dt>{label}</dt><dd>{value}</dd><small>{detail}</small></div>)}</dl>
  <p>{number(m.queuedMessages)} messages scheduled or being sent. Delivery totals include earlier messages. Click and purchase tracking started {date}; earlier clicks are unknown.</p>
  <div className="ms-reminder-table"><table><caption>Results by message channel</caption><thead><tr><th>Channel</th><th>Delivered</th><th>Clicked</th><th>Watched again</th><th>Purchases</th><th>Sales</th></tr></thead><tbody>{results.channels.map(c=><tr key={c.channel}><th>{c.channel==='sms'?'Text':'Email'}</th><td>{number(c.deliveredMessages)}</td><td>{number(c.clickedPeople)}</td><td>{number(c.returnedPeople)}</td><td>{number(c.purchases)}</td><td>{money(c.revenueCents)}</td></tr>)}</tbody></table></div>
  <details><summary>How results are counted</summary><p>Clicked means the link opened a visible page, after filtering common automated previews. Repeat visits count once per recipient. Watched again requires playback. A purchase is credited to the last confirmed reminder attached to that checkout within seven days. Renewals, work credits, test payments and payments under refund or dispute review are excluded. This measures the path to a purchase, not proof the reminder caused it.</p><p>{number(m.linkOpens)} total link opens, including unconfirmed visits. One recipient can appear in both channel rows; the overall recipient counts are deduplicated.</p></details>
 </section>;
}
