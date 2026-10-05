/** Budget tiers describe spending capacity, never guaranteed leads or better AI. */
export function dailyBudgetTier(cents:number){
 if(cents>=10000)return {name:'Scale',detail:'More room for lead matching and ongoing deal work.',color:'#6d28d9'};
 if(cents>=5000)return {name:'Growth',detail:'Support more research and follow-up in your market.',color:'#2459d3'};
 if(cents>=2500)return {name:'Momentum',detail:'Give your bot more room to work opportunities.',color:'#047857'};
 if(cents>=1000)return {name:'Builder',detail:'Build a steady research and follow-up rhythm.',color:'#0f766e'};
 return {name:'Starter',detail:'Start small and see your bot’s work in one place.',color:'#18181b'};
}
export const minimumDailyBudgetCents=1000;
export const maximumDailyBudgetCents=100000;
export function validDailyBudget(cents:unknown):cents is number{return typeof cents==='number'&&Number.isSafeInteger(cents)&&cents>=minimumDailyBudgetCents&&cents<=maximumDailyBudgetCents;}
